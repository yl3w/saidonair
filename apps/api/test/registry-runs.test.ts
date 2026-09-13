import { describe, expect, it } from "vitest";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedRun,
  VIDEO_A,
  VIDEO_B,
} from "./helpers";

describe("registry ingestion runs", () => {
  it("lists a channel's runs newest first with their per-episode outcomes", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedApprovedChannel(CHANNEL_B, "B");
    await seedEpisode(VIDEO_A, CHANNEL_A);
    await seedEpisode(VIDEO_B, CHANNEL_A, {
      status: "pending",
      waitingCode: "CAPTIONS",
    });

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
        { videoId: VIDEO_B, status: "waiting" },
      ],
    });
    const second = await seedRun(CHANNEL_A, {
      kind: "owner_retry",
      status: "completed",
      createdAt: 2_000,
      startedAt: 2_000,
      finishedAt: 2_500,
      episodes: [
        { videoId: VIDEO_A, status: "available" },
        { videoId: VIDEO_B, status: "skipped" },
      ],
    });
    await seedRun(CHANNEL_B, { status: "queued", createdAt: 3_000 });

    const runs = await stub.listRuns(CHANNEL_A);
    expect(runs.map((r) => r.runId)).toEqual([second, first]);
    expect(runs[0]).toMatchObject({
      channelId: CHANNEL_A,
      kind: "owner_retry",
      status: "completed",
      finishedAt: 2_500,
      episodes: [
        { videoId: VIDEO_A, status: "available", failureCode: null },
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
      expect.objectContaining({ videoId: VIDEO_B, status: "waiting" }),
    ]);

    expect(await stub.listRuns(CHANNEL_B)).toEqual([
      expect.objectContaining({ status: "queued", episodes: [] }),
    ]);
    await expectDomainError(
      stub.listRuns("UCZZZZZZZZZZZZZZZZZZZZZZ"),
      "NOT_FOUND",
    );
  });
});
