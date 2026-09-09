import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  CHANNEL_E,
  expectDomainError,
  OWNER,
  registry,
  seedEpisode,
  seedRun,
  setChannelState,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
} from "./helpers";

/**
 * A: available, two processed and one failed episode, a completed run.
 * B: pending with a queued run (not stuck). C: pending with no run (stuck).
 * D: failed. E: available but deleted (counts only as deleted).
 * Requests: two pending for C, one approved for A, one rejected for D.
 */
async function seedCatalog() {
  const stub = registry();
  for (const [channelId, title] of [
    [CHANNEL_A, "A"],
    [CHANNEL_B, "B"],
    [CHANNEL_C, "C"],
    [CHANNEL_D, "D"],
    [CHANNEL_E, "E"],
  ] as const) {
    await stub.createChannel(OWNER, { channelId, title });
  }
  await setChannelState(CHANNEL_A, { status: "available", availableAt: 10 });
  await setChannelState(CHANNEL_D, {
    status: "failed",
    failureCode: "NO_EPISODES",
  });
  await setChannelState(CHANNEL_E, { status: "available", availableAt: 10 });
  await stub.deleteChannel(OWNER, CHANNEL_E);

  await seedEpisode(VIDEO_A, CHANNEL_A, { publishedAt: 2 });
  await seedEpisode(VIDEO_B, CHANNEL_A, { publishedAt: 3 });
  await seedEpisode(VIDEO_C, CHANNEL_A, { status: "failed", publishedAt: 4 });
  await seedRun(CHANNEL_A, {
    kind: "scheduled",
    status: "completed",
    createdAt: 100,
    finishedAt: 150,
  });
  await seedRun(CHANNEL_A, {
    kind: "initial",
    status: "completed",
    createdAt: 50,
    finishedAt: 60,
  });
  await seedRun(CHANNEL_B, { status: "queued", createdAt: 200 });

  const url = (id: string) => `https://www.youtube.com/channel/${id}`;
  await stub.submitRequest(ALICE, {
    youtubeChannelId: CHANNEL_C,
    submittedUrl: url(CHANNEL_C),
  });
  await stub.submitRequest(BOB, {
    youtubeChannelId: CHANNEL_C,
    submittedUrl: url(CHANNEL_C),
  });
  const forA = await stub.submitRequest(ALICE, {
    youtubeChannelId: CHANNEL_A,
    submittedUrl: url(CHANNEL_A),
  });
  await stub.approveRequest(OWNER, forA.requestId);
  const forD = await stub.submitRequest(BOB, {
    youtubeChannelId: CHANNEL_D,
    submittedUrl: url(CHANNEL_D),
  });
  await stub.rejectRequest(OWNER, forD.requestId);
  return stub;
}

describe("registry catalog summary and management", () => {
  it("summarizes the catalog for the owner", async () => {
    const stub = await seedCatalog();

    expect(await stub.getCatalogSummary(OWNER)).toEqual({
      channels: {
        available: 1,
        pending: 2,
        failed: 1,
        deleted: 1,
        stuckPending: 1,
      },
      episodes: { processed: 2, tracked: 3 },
      runs: { active: 1 },
      requests: { pending: 2 },
      lastSuccessfulIngestionAt: 150,
    });
    await expectDomainError(stub.getCatalogSummary(ALICE), "NOT_OWNER");
  });

  it("is empty-safe before anything exists", async () => {
    expect(await registry().getCatalogSummary(OWNER)).toEqual({
      channels: {
        available: 0,
        pending: 0,
        failed: 0,
        deleted: 0,
        stuckPending: 0,
      },
      episodes: { processed: 0, tracked: 0 },
      runs: { active: 0 },
      requests: { pending: 0 },
      lastSuccessfulIngestionAt: null,
    });
  });

  it("joins channels to their management facts", async () => {
    const stub = await seedCatalog();

    const rows = await stub.listChannelManagement(OWNER);
    expect(rows.map((r) => r.channel.channelId)).toHaveLength(5);
    const byId = new Map(rows.map((r) => [r.channel.channelId, r]));

    expect(byId.get(CHANNEL_A)).toMatchObject({
      episodes: { processed: 2, failed: 1, pending: 0 },
      latestRun: { kind: "scheduled", status: "completed", finishedAt: 150 },
      requesterCount: 1,
      stuckPending: false,
    });
    expect(byId.get(CHANNEL_B)).toMatchObject({
      latestRun: { status: "queued" },
      requesterCount: 0,
      stuckPending: false,
    });
    expect(byId.get(CHANNEL_C)).toMatchObject({
      episodes: { processed: 0 },
      latestRun: null,
      requesterCount: 2,
      stuckPending: true,
    });
    // A rejected request is not a requester; a deleted channel is never "stuck".
    expect(byId.get(CHANNEL_D)?.requesterCount).toBe(0);
    expect(byId.get(CHANNEL_E)).toMatchObject({
      channel: { deletedAt: expect.any(Number) },
      stuckPending: false,
    });

    const some = await stub.listChannelManagement(OWNER, [
      CHANNEL_C,
      CHANNEL_A,
    ]);
    expect(some.map((r) => r.channel.channelId).sort()).toEqual(
      [CHANNEL_A, CHANNEL_C].sort(),
    );
    await expectDomainError(stub.listChannelManagement(ALICE), "NOT_OWNER");
  });

  it("lists channels by id in any state and ignores unknown ids", async () => {
    const stub = await seedCatalog();
    const found = await stub.listChannelsByIds([
      CHANNEL_E,
      CHANNEL_A,
      "UCZZZZZZZZZZZZZZZZZZZZZZ",
    ]);
    expect(found.map((c) => c.channelId)).toEqual([CHANNEL_A, CHANNEL_E]);
    expect(found[1]?.deletedAt).not.toBeNull();
    await expectDomainError(stub.listChannelsByIds(["bad"]), "INVALID_INPUT");
  });
});
