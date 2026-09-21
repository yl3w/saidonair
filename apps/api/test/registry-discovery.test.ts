import { describe, expect, it } from "vitest";
import type { ChannelFeed, FeedEntry } from "../src/lib/youtube/rss";
import {
  approveAs,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  declineAs,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
} from "./helpers";

const HOUR = 60 * 60 * 1000;
const WINDOW = 48 * HOUR;

/** `count` entries newest first, one hour apart, ending at `newestAt`; ids are eleven characters. */
function entries(
  count: number,
  newestAt: number,
  prefix = "feed",
): FeedEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    videoId: `${prefix}${String(i).padStart(11 - prefix.length, "0")}`,
    title: `Video ${i}`,
    publishedAt: newestAt - i * HOUR,
  }));
}

const feedOf = (channelId: string, list: FeedEntry[]): ChannelFeed => ({
  channelId,
  title: "Feed",
  entries: list,
});

describe("recordDiscovery", () => {
  it("records an initial run that creates the newest entries with their windows open, then a scheduled run with nothing new", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_A, "A");
    expect(channel.pausedBy).toBe("system"); // nobody follows: discovery ignores the pause
    const approvedAt = channel.approvedAt ?? 0;
    // Fifteen entries, all older than the approval: the initial import takes the newest five anyway.
    const feed = feedOf(CHANNEL_A, entries(15, approvedAt - 24 * HOUR));
    const before = Date.now();

    const { run, created } = await stub.recordDiscovery(CHANNEL_A, feed);

    expect(run).toMatchObject({
      channelId: CHANNEL_A,
      kind: "initial",
      feedStatus: "read",
      discoveredCount: 5,
      episodeLimit: 5,
    });
    expect(run.finishedAt).toBeGreaterThanOrEqual(run.startedAt);
    expect(created.map((e) => e.episodeId)).toEqual(
      feed.entries.slice(0, 5).map((e) => e.videoId),
    );
    for (const episode of created) {
      expect(episode).toMatchObject({
        channelId: CHANNEL_A,
        status: "pending",
        skipReason: null,
        summary: null,
        related: [],
        summaryAvailableAt: null,
      });
      const p = episode.processing;
      expect(p.discoveredByRunId).toBe(run.runId);
      expect(p.intent).toBe("publish");
      expect(p.windowStartedAt).toBeGreaterThanOrEqual(before);
      expect(p.windowDeadlineAt).toBe((p.windowStartedAt ?? 0) + WINDOW);
      expect(p.nextAttemptAt).toBe(p.windowStartedAt);
      expect(p.attemptCount).toBe(0);
      expect(p.latestAttempt).toBeNull();
      expect(p.failureCode).toBeNull();
    }
    // The other ten exist nowhere.
    expect(
      await stub.listEpisodes(CHANNEL_A, { relatedScope: [], limit: 200 }),
    ).toHaveLength(5);
    // A successful read moves last_checked_at and nothing else on the channel.
    const after = await stub.getChannel(CHANNEL_A);
    expect(after?.lastCheckedAt).toBeGreaterThanOrEqual(before);
    const { lastCheckedAt: _a, updatedAt: _b, ...restBefore } = channel;
    const { lastCheckedAt: _c, updatedAt: _d, ...restAfter } = after ?? channel;
    expect(restAfter).toEqual(restBefore);

    const second = await stub.recordDiscovery(CHANNEL_A, feed);
    expect(second.run).toMatchObject({
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 0,
      episodeLimit: null,
    });
    expect(second.created).toEqual([]);
    expect((await stub.listRuns(CHANNEL_A)).map((r) => r.runId)).toEqual([
      second.run.runId,
      run.runId,
    ]);
    expect(
      await stub.listEpisodes(CHANNEL_A, { relatedScope: [], limit: 200 }),
    ).toHaveLength(5);
  });

  it("selects only untracked entries published after the first approval on a scheduled run", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_B, "B", {
      initialImportCount: 2,
    });
    const approvedAt = channel.approvedAt ?? 0;
    const old = entries(6, approvedAt - HOUR, "old0");
    const initial = await stub.recordDiscovery(
      CHANNEL_B,
      feedOf(CHANNEL_B, old),
    );
    expect(initial.run).toMatchObject({
      kind: "initial",
      discoveredCount: 2,
      episodeLimit: 2,
    });

    const newUpload: FeedEntry = {
      videoId: "newupload01",
      title: "New",
      publishedAt: approvedAt + 1,
    };
    const atApproval: FeedEntry = {
      videoId: "atapproval1",
      title: "Same ms",
      publishedAt: approvedAt,
    };
    const { run, created } = await stub.recordDiscovery(
      CHANNEL_B,
      feedOf(CHANNEL_B, [newUpload, atApproval, ...old]),
    );
    expect(run).toMatchObject({
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 1,
      episodeLimit: null,
    });
    expect(created.map((e) => e.episodeId)).toEqual(["newupload01"]);
    // The four old untracked entries and the one published at the approval instant are never created.
    const all = await stub.listEpisodes(CHANNEL_B, {
      relatedScope: [],
      limit: 200,
    });
    expect(all.map((e) => e.episodeId).sort()).toEqual([
      "newupload01",
      "old00000000",
      "old00000001",
    ]);
  });

  it("records an unavailable or empty read as history that leaves the channel untouched and keeps the next read initial", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_C, "C");

    const unavailable = await stub.recordDiscovery(CHANNEL_C, null);
    expect(unavailable.run).toMatchObject({
      kind: "initial",
      feedStatus: "unavailable",
      discoveredCount: 0,
      episodeLimit: null,
    });
    expect(unavailable.created).toEqual([]);
    expect((await stub.getChannel(CHANNEL_C))?.lastCheckedAt).toBeNull();

    const empty = await stub.recordDiscovery(CHANNEL_C, feedOf(CHANNEL_C, []));
    expect(empty.run).toMatchObject({
      kind: "initial",
      feedStatus: "read",
      discoveredCount: 0,
    });
    expect((await stub.getChannel(CHANNEL_C))?.lastCheckedAt).not.toBeNull();

    const read = await stub.recordDiscovery(
      CHANNEL_C,
      feedOf(CHANNEL_C, entries(3, (channel.approvedAt ?? 0) - HOUR)),
    );
    expect(read.run).toMatchObject({
      kind: "initial",
      discoveredCount: 3,
      episodeLimit: 5,
    });
    expect((await stub.listRuns(CHANNEL_C)).map((r) => r.feedStatus)).toEqual([
      "read",
      "read",
      "unavailable",
    ]);
  });

  it("dedupes ids within one feed and orders the created episodes newest first", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_A, "A");
    const at = channel.approvedAt ?? 0;
    const { run, created } = await stub.recordDiscovery(
      CHANNEL_A,
      feedOf(CHANNEL_A, [
        {
          videoId: "dupe0000001",
          title: "older copy",
          publishedAt: at - 3 * HOUR,
        },
        { videoId: "middle00001", title: "middle", publishedAt: at - 2 * HOUR },
        { videoId: "dupe0000001", title: "newer copy", publishedAt: at - HOUR },
        { videoId: "newest00001", title: "newest", publishedAt: at },
      ]),
    );
    expect(run.discoveredCount).toBe(3);
    expect(created.map((e) => e.episodeId)).toEqual([
      "newest00001",
      "dupe0000001",
      "middle00001",
    ]);
    expect(created[1]?.title).toBe("newer copy");
  });

  it("refuses unknown, requested, and declined channels and a feed for another channel", async () => {
    const stub = registry();
    const feed = feedOf(CHANNEL_A, entries(2, 1_000));
    await expectDomainError(stub.recordDiscovery(CHANNEL_A, feed), "NOT_FOUND");
    await stub.createChannel({ channelId: CHANNEL_A, title: "A" });
    await expectDomainError(
      stub.recordDiscovery(CHANNEL_A, feed),
      "INVALID_STATE",
    );
    await approveAs(OWNER, CHANNEL_A);
    await expectDomainError(
      stub.recordDiscovery(CHANNEL_A, feedOf(CHANNEL_B, feed.entries)),
      "INVALID_INPUT",
    );
    await declineAs(OWNER, CHANNEL_A);
    await expectDomainError(
      stub.recordDiscovery(CHANNEL_A, feed),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.recordDiscovery(CHANNEL_A, null),
      "INVALID_STATE",
    );
    expect(await stub.listRuns(CHANNEL_A)).toEqual([]);
  });
});
