import { describe, expect, it } from "vitest";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  expectDomainError,
  OWNER,
  registry,
  seedEpisode,
  seedRun,
  VIDEO_A,
  VIDEO_B,
} from "./helpers";

describe("registry ingestion runs", () => {
  it("lists a channel's runs newest first with their per-episode outcomes, owner only", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A" });
    await stub.createChannel(OWNER, { channelId: CHANNEL_B, title: "B" });
    await seedEpisode(VIDEO_A, CHANNEL_A);
    await seedEpisode(VIDEO_B, CHANNEL_A, { status: "no_transcript" });

    const first = await seedRun(CHANNEL_A, {
      kind: "initial",
      status: "failed",
      failureCode: "INITIAL_IMPORT_FAILED",
      createdAt: 1_000,
      startedAt: 1_000,
      finishedAt: 1_500,
      episodeLimit: 5,
      episodes: [
        { videoId: VIDEO_A, status: "failed", failureCode: "FETCH_FAILED" },
        { videoId: VIDEO_B, status: "no_transcript" },
      ],
    });
    const second = await seedRun(CHANNEL_A, {
      kind: "owner_retry",
      status: "completed",
      createdAt: 2_000,
      startedAt: 2_000,
      finishedAt: 2_500,
      lifecycleVersion: 2,
      episodes: [
        { videoId: VIDEO_A, status: "processed" },
        { videoId: VIDEO_B, status: "skipped" },
      ],
    });
    await seedRun(CHANNEL_B, { status: "queued", createdAt: 3_000 });

    const runs = await stub.listRuns(OWNER, CHANNEL_A);
    expect(runs.map((r) => r.runId)).toEqual([second, first]);
    expect(runs[0]).toMatchObject({
      channelId: CHANNEL_A,
      kind: "owner_retry",
      status: "completed",
      lifecycleVersion: 2,
      finishedAt: 2_500,
      episodes: [
        { videoId: VIDEO_A, status: "processed", failureCode: null },
        { videoId: VIDEO_B, status: "skipped" },
      ],
    });
    // The earlier run keeps its historical outcomes even though the retry changed the episode.
    expect(runs[1]?.episodes).toEqual([
      expect.objectContaining({
        videoId: VIDEO_A,
        status: "failed",
        failureCode: "FETCH_FAILED",
      }),
      expect.objectContaining({ videoId: VIDEO_B, status: "no_transcript" }),
    ]);

    expect(await stub.listRuns(OWNER, CHANNEL_B)).toEqual([
      expect.objectContaining({ status: "queued", episodes: [] }),
    ]);
    await expectDomainError(stub.listRuns(ALICE, CHANNEL_A), "NOT_OWNER");
    await expectDomainError(
      stub.listRuns(OWNER, "UCZZZZZZZZZZZZZZZZZZZZZZ"),
      "NOT_FOUND",
    );
  });
});
