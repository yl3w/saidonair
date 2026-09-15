import { describe, expect, it } from "vitest";
import {
  CHANNEL_A,
  CHANNEL_B,
  EPISODE_A,
  expectDomainError,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedRun,
} from "./helpers";

describe("registry discovery runs", () => {
  it("lists a channel's runs newest first as completed feed history", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedApprovedChannel(CHANNEL_B, "B");
    const first = await seedRun(CHANNEL_A, {
      kind: "initial",
      feedStatus: "read",
      discoveredCount: 5,
      episodeLimit: 5,
      createdAt: 1_000,
      startedAt: 1_000,
      finishedAt: 1_500,
    });
    const second = await seedRun(CHANNEL_A, {
      kind: "scheduled",
      feedStatus: "unavailable",
      createdAt: 2_000,
      startedAt: 2_000,
      finishedAt: 2_100,
    });
    const third = await seedRun(CHANNEL_A, {
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 0,
      createdAt: 3_000,
    });

    const runs = await stub.listRuns(CHANNEL_A);
    expect(runs.map((r) => r.runId)).toEqual([third, second, first]);
    expect(runs[2]).toEqual({
      runId: first,
      channelId: CHANNEL_A,
      kind: "initial",
      feedStatus: "read",
      discoveredCount: 5,
      episodeLimit: 5,
      startedAt: 1_000,
      finishedAt: 1_500,
    });
    expect(runs[1]).toMatchObject({
      feedStatus: "unavailable",
      discoveredCount: 0,
      episodeLimit: null,
    });
    // A run carries no episode outcomes; an episode names the run that discovered it instead.
    expect(runs[0]).not.toHaveProperty("episodes");
    expect(runs[0]).not.toHaveProperty("status");
    await seedEpisode(EPISODE_A, CHANNEL_A, { runId: first });
    const [episode] = await stub.listEpisodes(CHANNEL_A, { relatedScope: [] });
    expect(episode?.processing.discoveredByRunId).toBe(first);

    expect(await stub.listRuns(CHANNEL_B)).toEqual([]);
    await expectDomainError(
      stub.listRuns("UCZZZZZZZZZZZZZZZZZZZZZZ"),
      "NOT_FOUND",
    );
  });
});
