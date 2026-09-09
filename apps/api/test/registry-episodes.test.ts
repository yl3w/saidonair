import { describe, expect, it } from "vitest";
import {
  CHANNEL_A,
  CHANNEL_B,
  channelIds,
  expectDomainError,
  OWNER,
  registry,
  seedEpisode,
  seedSummary,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
  videoIds,
} from "./helpers";

async function twoChannels() {
  const stub = registry();
  await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A" });
  await stub.createChannel(OWNER, { channelId: CHANNEL_B, title: "B" });
  return stub;
}

describe("registry episodes", () => {
  it("lists the digest newest first, in the window, with summaries, for the given channels only", async () => {
    const stub = await twoChannels();
    await seedEpisode(VIDEO_A, CHANNEL_A, { publishedAt: 3_000 });
    await seedSummary(VIDEO_A, {
      takeaways: ["one", "two"],
      relatedVideoIds: [VIDEO_B, VIDEO_C, VIDEO_A],
    });
    await seedEpisode(VIDEO_B, CHANNEL_A, { publishedAt: 2_000 });
    await seedSummary(VIDEO_B, { format: "raw_fallback", rawText: "raw" });
    await seedEpisode(VIDEO_C, CHANNEL_B, { publishedAt: 2_500 });
    await seedSummary(VIDEO_C);
    await seedEpisode("old00000000", CHANNEL_A, { publishedAt: 500 });
    await seedSummary("old00000000");
    await seedEpisode("nosummary00", CHANNEL_A, { publishedAt: 4_000 });
    await seedEpisode("pending0000", CHANNEL_A, {
      publishedAt: 5_000,
      status: "pending",
    });

    const digest = await stub.listDigest([CHANNEL_A], 1_000);

    expect(digest.map((e) => e.videoId)).toEqual([VIDEO_A, VIDEO_B]);
    expect(digest[0]).toMatchObject({
      channelTitle: "A",
      status: "processed",
      summary: {
        format: "structured",
        takeaways: ["one", "two"],
        topicTags: ["tag"],
      },
      // VIDEO_C belongs to channel B, outside the scope; the episode never relates to itself.
      related: [{ videoId: VIDEO_B, title: `Episode ${VIDEO_B}` }],
    });
    expect(digest[1]?.summary).toEqual({
      format: "raw_fallback",
      rawText: "raw",
    });

    const both = await stub.listDigest([CHANNEL_A, CHANNEL_B], 1_000);
    expect(both.map((e) => e.videoId)).toEqual([VIDEO_A, VIDEO_C, VIDEO_B]);
    expect(both[0]?.related.map((r) => r.videoId)).toEqual([VIDEO_B, VIDEO_C]);

    expect(await stub.listDigest([], 0)).toEqual([]);
    await expectDomainError(stub.listDigest([CHANNEL_A], -1), "INVALID_INPUT");
    await expectDomainError(stub.listDigest(["nope"], 0), "INVALID_INPUT");
  });

  it("counts by status and lists processed ids across more than one parameter batch", async () => {
    const stub = await twoChannels();
    const ids = videoIds(120);
    for (const [i, videoId] of ids.entries()) {
      await seedEpisode(videoId, CHANNEL_A, {
        publishedAt: i,
        status: i < 110 ? "processed" : "no_transcript",
      });
    }
    await seedEpisode(VIDEO_A, CHANNEL_B, { status: "failed" });

    // 1,000 channel ids, most of them absent: the IN lists are chunked under the 100-binding cap.
    const many = [...channelIds(998), CHANNEL_A, CHANNEL_B];
    const processed = await stub.listProcessedVideoIds(many);
    expect(processed).toHaveLength(110);
    expect(new Set(processed.map((p) => p.channelId))).toEqual(
      new Set([CHANNEL_A]),
    );

    const counts = await stub.countEpisodesByChannel(many);
    expect(counts[CHANNEL_A]).toEqual({
      processed: 110,
      pending: 0,
      processing: 0,
      noTranscript: 10,
      failed: 0,
    });
    expect(counts[CHANNEL_B]).toMatchObject({ processed: 0, failed: 1 });
    expect(counts[many[0] ?? ""]).toMatchObject({ processed: 0 });
    expect(Object.keys(counts)).toHaveLength(1000);
  });

  it("lists one channel's episodes in every status with processing detail and a limit", async () => {
    const stub = await twoChannels();
    await seedEpisode(VIDEO_A, CHANNEL_A, {
      publishedAt: 3_000,
      chunkCount: 7,
    });
    await seedSummary(VIDEO_A, { relatedVideoIds: [VIDEO_C] });
    await seedEpisode(VIDEO_B, CHANNEL_A, {
      publishedAt: 2_000,
      status: "failed",
      failureCode: "FETCH_FAILED",
      attemptCount: 3,
    });
    await seedEpisode(VIDEO_C, CHANNEL_B, { publishedAt: 1_000 });
    await seedSummary(VIDEO_C);

    const all = await stub.listEpisodes(CHANNEL_A, {
      relatedScope: [CHANNEL_B],
    });
    expect(all.map((e) => e.videoId)).toEqual([VIDEO_A, VIDEO_B]);
    expect(all[0]).toMatchObject({
      summary: { format: "structured" },
      related: [{ videoId: VIDEO_C }],
      processing: { chunkCount: 7, attemptCount: 1 },
    });
    expect(all[1]).toMatchObject({
      status: "failed",
      summary: null,
      related: [],
      processing: {
        failureCode: "FETCH_FAILED",
        attemptCount: 3,
        chunkCount: null,
      },
    });

    // Related titles outside the scope are dropped, not exposed.
    const narrow = await stub.listEpisodes(CHANNEL_A, { relatedScope: [] });
    expect(narrow[0]?.related).toEqual([]);

    const one = await stub.listEpisodes(CHANNEL_A, {
      limit: 1,
      relatedScope: [],
    });
    expect(one.map((e) => e.videoId)).toEqual([VIDEO_A]);

    await expectDomainError(
      stub.listEpisodes(CHANNEL_A, { limit: 0, relatedScope: [] }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.listEpisodes(CHANNEL_A, { limit: 201, relatedScope: [] }),
      "INVALID_INPUT",
    );
    expect(
      await stub.listEpisodes(CHANNEL_B, { relatedScope: [] }),
    ).toHaveLength(1);
  });
});
