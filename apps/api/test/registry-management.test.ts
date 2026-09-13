import { describe, expect, it } from "vitest";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  CHANNEL_E,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedRun,
  setChannelState,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
} from "./helpers";

/**
 * A: approved, two available and one failed episode, two runs plus the seed run its episodes name.
 * B: approved with one unavailable-feed run. C: approved with no run (never started). D: requested.
 * E: approved but paused by the owner (counts only as paused).
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
    await seedApprovedChannel(channelId, title);
  }
  // Approval pauses a channel nobody follows yet (Ruling R4); only E stays paused here.
  for (const channelId of [CHANNEL_A, CHANNEL_B, CHANNEL_C, CHANNEL_D]) {
    await stub.resumeChannel(channelId);
  }
  await setChannelState(CHANNEL_D, { status: "requested" });
  await stub.pauseChannel(CHANNEL_E);

  await seedEpisode(VIDEO_A, CHANNEL_A, { publishedAt: 2 });
  await seedEpisode(VIDEO_B, CHANNEL_A, { publishedAt: 3 });
  await seedEpisode(VIDEO_C, CHANNEL_A, { status: "failed", publishedAt: 4 });
  await seedRun(CHANNEL_A, {
    kind: "scheduled",
    feedStatus: "read",
    discoveredCount: 1,
    createdAt: 100,
    finishedAt: 150,
  });
  await seedRun(CHANNEL_A, {
    kind: "initial",
    feedStatus: "read",
    discoveredCount: 2,
    episodeLimit: 5,
    createdAt: 50,
    finishedAt: 60,
  });
  await seedRun(CHANNEL_B, { feedStatus: "unavailable", createdAt: 200 });

  return stub;
}

describe("registry catalog summary and management", () => {
  it("summarizes the catalog", async () => {
    const stub = await seedCatalog();

    expect(await stub.getCatalogSummary()).toEqual({
      channels: { requested: 1, approved: 3, paused: 1, declined: 0 },
      episodes: { available: 2, pending: 0, failed: 1, skipped: 0 },
      // The newest first availability anywhere: VIDEO_B was processed at 3.
      lastSuccessfulIngestionAt: 3,
      // One failed episode (VIDEO_C on A). Approved with no run row: C, and E (paused channels
      // keep channels.status = 'approved'). `requested` reuses the `channels.requested` total.
      attention: { failedEpisodes: 1, neverStarted: 2, requested: 1 },
    });
  });

  it("is empty-safe before anything exists", async () => {
    expect(await registry().getCatalogSummary()).toEqual({
      channels: { requested: 0, approved: 0, paused: 0, declined: 0 },
      episodes: { available: 0, pending: 0, failed: 0, skipped: 0 },
      lastSuccessfulIngestionAt: null,
      attention: { failedEpisodes: 0, neverStarted: 0, requested: 0 },
    });
  });

  it("joins channels to their management facts", async () => {
    const stub = await seedCatalog();

    const rows = await stub.listChannelManagement();
    expect(rows.map((r) => r.channel.channelId)).toHaveLength(5);
    const byId = new Map(rows.map((r) => [r.channel.channelId, r]));

    expect(byId.get(CHANNEL_A)).toMatchObject({
      episodes: { available: 2, failed: 1, pending: 0 },
      lastIngestedAt: 3,
      latestRun: {
        kind: "scheduled",
        feedStatus: "read",
        discoveredCount: 1,
        finishedAt: 150,
      },
      neverStarted: false,
    });
    expect(byId.get(CHANNEL_B)).toMatchObject({
      lastIngestedAt: null,
      latestRun: { feedStatus: "unavailable", discoveredCount: 0 },
      neverStarted: false,
    });
    // Approved with no run row at all.
    expect(byId.get(CHANNEL_C)).toMatchObject({
      episodes: { available: 0 },
      lastIngestedAt: null,
      latestRun: null,
      neverStarted: true,
    });
    // A channel that is not approved is never "never started".
    expect(byId.get(CHANNEL_D)).toMatchObject({
      channel: { status: "requested" },
      latestRun: null,
      neverStarted: false,
    });
    expect(byId.get(CHANNEL_E)).toMatchObject({
      channel: { pausedBy: "owner", pausedAt: expect.any(Number) },
    });

    const some = await stub.listChannelManagement([CHANNEL_C, CHANNEL_A]);
    expect(some.map((r) => r.channel.channelId).sort()).toEqual(
      [CHANNEL_A, CHANNEL_C].sort(),
    );
  });

  it("lists channels by id in any status and ignores unknown ids", async () => {
    const stub = await seedCatalog();
    const found = await stub.listChannelsByIds([
      CHANNEL_E,
      CHANNEL_A,
      "UCZZZZZZZZZZZZZZZZZZZZZZ",
    ]);
    expect(found.map((c) => c.channelId)).toEqual([CHANNEL_A, CHANNEL_E]);
    expect(found[1]?.pausedBy).toBe("owner");
    await expectDomainError(stub.listChannelsByIds(["bad"]), "INVALID_INPUT");
  });
});
