import { describe, expect, it } from "vitest";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
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
    await stub.createChannel({ channelId: CHANNEL_A, title: "A" });
    const first = await stub.approveChannel(OWNER, CHANNEL_A, {
      title: "Better",
      explanation: "ok",
    });
    expect(first.importStarts).toBe(true);
    expect(first.channel).toMatchObject({
      status: "approved",
      title: "Better",
      reviewNote: "ok",
      reviewedByEmail: OWNER,
    });
    await expectDomainError(
      stub.approveChannel(OWNER, CHANNEL_A),
      "INVALID_STATE",
    );

    const declined = await stub.declineChannel(OWNER, CHANNEL_A, {
      explanation: "withdrawn",
    });
    expect(declined).toMatchObject({
      status: "declined",
      reviewNote: "withdrawn",
      pausedBy: null,
    });
    // No role is checked: any identity may approve and is recorded as the reviewer (PRD §9).
    const again = await stub.approveChannel(ALICE, CHANNEL_A);
    expect(again.importStarts).toBe(false);
    expect(again.channel.approvedAt).toBe(first.channel.approvedAt);
    expect(again.channel.reviewedByEmail).toBe(ALICE);
  });

  it("decline from requested records the note; request again reopens and keeps it", async () => {
    const stub = registry();
    await stub.createChannel({ channelId: CHANNEL_A, title: "A" });
    const declined = await stub.declineChannel(OWNER, CHANNEL_A, {
      explanation: "no",
    });
    expect(declined).toMatchObject({
      status: "declined",
      reviewNote: "no",
    });
    await expectDomainError(
      stub.declineChannel(OWNER, CHANNEL_A),
      "INVALID_STATE",
    );
    const reopened = await stub.requestChannel(CHANNEL_A);
    expect(reopened).toMatchObject({
      status: "requested",
      reviewNote: "no",
      reviewedByEmail: OWNER,
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
    await stub.declineChannel(OWNER, CHANNEL_C);
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
    await expectDomainError(stub.approveChannel(OWNER, CHANNEL_B), "NOT_FOUND");
    // Whoever acts must at least be an email.
    await expectDomainError(
      stub.approveChannel("not an email", CHANNEL_A),
      "INVALID_INPUT",
    );
  });
});
