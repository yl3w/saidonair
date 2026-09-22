import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ALICE,
  approveAs,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  declineAs,
  EPISODE_A,
  EPISODE_B,
  expectDomainError,
  identityOf,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedRun,
} from "./helpers";

describe("registry channels", () => {
  it("every add creates a requested channel, whoever asks, never twice", async () => {
    const stub = registry();
    const requested = await stub.createChannel({
      channelId: CHANNEL_A,
      title: "A",
    });
    expect(requested).toMatchObject({
      status: "requested",
      approvedAt: null,
      reviewedAt: null,
      pausedBy: null,
    });
    // The owner's add is no shortcut either (owner decision 2026-09-12): approval is a separate call.
    const byOwner = await stub.createChannel({
      channelId: CHANNEL_B,
      title: "B",
    });
    expect(byOwner).toMatchObject({ status: "requested", approvedAt: null });
    await expectDomainError(
      stub.createChannel({ channelId: CHANNEL_A, title: "A" }),
      "INVALID_STATE",
    );
  });

  it("approve sets approved_at once, records whoever approved, and reports whether the import should start", async () => {
    const stub = registry();
    const owner = await identityOf(OWNER);
    const alice = await identityOf(ALICE);
    await stub.createChannel({ channelId: CHANNEL_A, title: "A" });
    const first = await approveAs(OWNER, CHANNEL_A, {
      title: "Better",
      explanation: "ok",
    });
    expect(first.importStarts).toBe(true);
    expect(first.channel).toMatchObject({
      status: "approved",
      title: "Better",
      reviewNote: "ok",
      reviewedByUserId: owner,
    });
    await expectDomainError(approveAs(OWNER, CHANNEL_A), "INVALID_STATE");

    const declined = await declineAs(OWNER, CHANNEL_A, {
      explanation: "withdrawn",
    });
    expect(declined).toMatchObject({
      status: "declined",
      reviewNote: "withdrawn",
      pausedBy: null,
    });
    // No role is checked: any identity may approve and is recorded as the reviewer (PRD §9).
    const again = await approveAs(ALICE, CHANNEL_A);
    expect(again.importStarts).toBe(false);
    expect(again.channel.approvedAt).toBe(first.channel.approvedAt);
    expect(again.channel.reviewedByUserId).toBe(alice);
  });

  it("decline from requested records the note; request again reopens and keeps it", async () => {
    const stub = registry();
    const owner = await identityOf(OWNER);
    await stub.createChannel({ channelId: CHANNEL_A, title: "A" });
    const declined = await declineAs(OWNER, CHANNEL_A, {
      explanation: "no",
    });
    expect(declined).toMatchObject({
      status: "declined",
      reviewNote: "no",
    });
    await expectDomainError(declineAs(OWNER, CHANNEL_A), "INVALID_STATE");
    const reopened = await stub.requestChannel(CHANNEL_A);
    expect(reopened).toMatchObject({
      status: "requested",
      reviewNote: "no",
      reviewedByUserId: owner,
    });
    await expectDomainError(stub.requestChannel(CHANNEL_A), "INVALID_STATE");
  });

  it("pause and resume apply to approved channels only, idempotently", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
    const paused = await stub.pauseChannel(CHANNEL_A);
    expect(paused.pausedBy).toBe("owner");
    expect(paused.pausedAt).not.toBeNull();
    expect(await stub.pauseChannel(CHANNEL_A)).toEqual(paused);
    expect((await stub.resumeChannel(CHANNEL_A)).pausedBy).toBeNull();
    await expectDomainError(stub.pauseChannel(CHANNEL_B), "INVALID_STATE");
  });

  it("lists requested and approved publicly; declined only by id or in the full list", async () => {
    const stub = registry();
    await stub.createChannel({ channelId: CHANNEL_A, title: "A" });
    await seedApprovedChannel(CHANNEL_B, "B");
    await stub.createChannel({ channelId: CHANNEL_C, title: "C" });
    await declineAs(OWNER, CHANNEL_C);
    expect((await stub.listCatalogChannels()).map((c) => c.channelId)).toEqual([
      CHANNEL_A,
      CHANNEL_B,
    ]);
    expect((await stub.listChannels()).map((c) => c.channelId).sort()).toEqual([
      CHANNEL_A,
      CHANNEL_B,
      CHANNEL_C,
    ]);
    expect((await stub.getChannel(CHANNEL_C))?.status).toBe("declined");
  });

  /**
   * PRD §8 bullet 6: "Declining an approved channel changes no run or episode row." The M6 sweep
   * (docs/specs/m6-hardening.md §6, G2) found this asserted nowhere — decline was tested for what
   * it *changes* and never for what it leaves. A criterion claiming an absence needs a test that
   * looks at the absence, so this one snapshots both tables and compares them whole rather than
   * checking a column somebody thought of.
   *
   * It matters because declining is a catalog decision and not an ingestion one: recovery keeps
   * running for a declined channel (rule 15), its summaries stay readable to its followers, and
   * approving it again restores them. All three break if decline reaches the episode rows.
   */
  it("declining is a catalog decision: not one run or episode row moves", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedRun(CHANNEL_A, { kind: "initial", discoveredCount: 2 });
    await seedEpisode(EPISODE_A, CHANNEL_A, { status: "available" });
    await seedEpisode(EPISODE_B, CHANNEL_A, { status: "pending" });

    const snapshot = async () =>
      runInDurableObject(stub, (_, ctx) => ({
        runs: ctx.storage.sql
          .exec("SELECT * FROM ingestion_runs ORDER BY run_id")
          .toArray(),
        episodes: ctx.storage.sql
          .exec("SELECT * FROM episodes ORDER BY episode_id")
          .toArray(),
      }));

    const before = await snapshot();
    expect(before.runs.length).toBe(2); // the seeded run, plus the one every episode needs
    expect(before.episodes.length).toBe(2);

    const declined = await declineAs(OWNER, CHANNEL_A, {
      explanation: "withdrawn",
    });
    expect(declined.status).toBe("declined");

    expect(await snapshot()).toEqual(before);
  });

  it("validates configuration input", async () => {
    const stub = registry();
    await expectDomainError(
      stub.createChannel({ channelId: "not-a-channel", title: "x" }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.createChannel({ channelId: CHANNEL_A, title: "   " }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.createChannel({
        channelId: CHANNEL_A,
        title: "A",
        initialImportCount: 0,
      }),
      "INVALID_INPUT",
    );
    await expectDomainError(approveAs(OWNER, CHANNEL_B), "NOT_FOUND");
    // An actor must be a registered identity before they can act, and the address is validated
    // when it is registered rather than when it reviews. That a review by an unknown id is refused
    // is the foreign key's job, asserted once in registry-migrations.test.ts.
    await expectDomainError(identityOf("not an email"), "INVALID_INPUT");
  });
});
