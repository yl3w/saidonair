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
  seedEpisode,
  seedRun,
  setChannelState,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
} from "./helpers";

/**
 * A: approved, two available and one failed episode, a completed run.
 * B: approved with a queued run. C: approved with no run (never started). D: requested.
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
    await stub.createChannel(OWNER, {
      channelId,
      title,
      status: "approved",
    });
  }
  await setChannelState(CHANNEL_D, { status: "requested" });
  await stub.pauseChannel(OWNER, CHANNEL_E);

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

  return stub;
}

describe("registry catalog summary and management", () => {
  it("summarizes the catalog for the owner", async () => {
    const stub = await seedCatalog();

    expect(await stub.getCatalogSummary(OWNER)).toEqual({
      channels: { requested: 1, approved: 3, paused: 1, declined: 0 },
      episodes: { available: 2, pending: 0, waiting: 0, failed: 1, skipped: 0 },
      runs: { active: 1 },
      lastSuccessfulIngestionAt: 150,
    });
    await expectDomainError(stub.getCatalogSummary(ALICE), "NOT_OWNER");
  });

  it("is empty-safe before anything exists", async () => {
    expect(await registry().getCatalogSummary(OWNER)).toEqual({
      channels: { requested: 0, approved: 0, paused: 0, declined: 0 },
      episodes: { available: 0, pending: 0, waiting: 0, failed: 0, skipped: 0 },
      runs: { active: 0 },
      lastSuccessfulIngestionAt: null,
    });
  });

  it("joins channels to their management facts", async () => {
    const stub = await seedCatalog();

    const rows = await stub.listChannelManagement(OWNER);
    expect(rows.map((r) => r.channel.channelId)).toHaveLength(5);
    const byId = new Map(rows.map((r) => [r.channel.channelId, r]));

    expect(byId.get(CHANNEL_A)).toMatchObject({
      episodes: { available: 2, failed: 1, pending: 0 },
      latestRun: { kind: "scheduled", status: "completed", finishedAt: 150 },
      neverStarted: false,
    });
    expect(byId.get(CHANNEL_B)).toMatchObject({
      latestRun: { status: "queued" },
      neverStarted: false,
    });
    // Approved with no run row at all.
    expect(byId.get(CHANNEL_C)).toMatchObject({
      episodes: { available: 0 },
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

    const some = await stub.listChannelManagement(OWNER, [
      CHANNEL_C,
      CHANNEL_A,
    ]);
    expect(some.map((r) => r.channel.channelId).sort()).toEqual(
      [CHANNEL_A, CHANNEL_C].sort(),
    );
    await expectDomainError(stub.listChannelManagement(ALICE), "NOT_OWNER");
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
