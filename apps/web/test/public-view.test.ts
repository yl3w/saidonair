import type { Channel, Episode, EpisodeStatus } from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { publicChannels, publicEpisodes } from "../src/lib/public-view";

function channel(over: Partial<Channel> = {}): Channel {
  return {
    channelId: "UC1",
    title: "A channel",
    canonicalUrl: "https://youtube.com/channel/UC1",
    status: "approved",
    paused: false,
    approvedAt: 1,
    reviewedAt: 1,
    reviewNote: null,
    lastIngestedAt: 2,
    episodes: { available: 3, pending: 0, failed: 0, skipped: 0 },
    following: false,
    followerCount: 0,
    ...over,
  };
}

describe("publicChannels", () => {
  it("keeps an approved channel", () => {
    expect(publicChannels([channel()])).toHaveLength(1);
  });

  it("keeps a paused channel — pause is a boolean, not a status", () => {
    // The archive is still readable; only scheduled discovery stops. A filter written as
    // `status === "approved" && !paused` would drop it, which is why this row is here.
    expect(publicChannels([channel({ paused: true })])).toHaveLength(1);
  });

  it("keeps an approved channel that has published nothing yet", () => {
    const empty = channel({
      episodes: { available: 0, pending: 0, failed: 0, skipped: 0 },
      lastIngestedAt: null,
    });
    expect(publicChannels([empty])).toHaveLength(1);
  });

  it("drops a requested channel and a declined one", () => {
    const rows = [
      channel({ channelId: "UC2", status: "requested", approvedAt: null }),
      channel({
        channelId: "UC3",
        status: "declined",
        reviewNote: "Not a fit",
      }),
    ];
    expect(publicChannels(rows)).toEqual([]);
  });

  it("preserves the order it was given", () => {
    const rows = [
      channel({ channelId: "UC1", title: "First" }),
      channel({ channelId: "UC2", status: "declined" }),
      channel({ channelId: "UC3", title: "Third" }),
    ];
    expect(publicChannels(rows).map((c) => c.title)).toEqual([
      "First",
      "Third",
    ]);
  });
});

function episode(status: EpisodeStatus, over: Partial<Episode> = {}): Episode {
  return {
    episodeId: `e-${status}`,
    channelId: "UC1",
    channelTitle: "A channel",
    title: `An ${status} episode`,
    publishedAt: 1,
    status,
    skipReason: null,
    waitReason: null,
    summaryAvailableAt: null,
    summary: null,
    related: [],
    ...over,
  };
}

describe("publicEpisodes", () => {
  it("keeps what can be read and what is being worked on", () => {
    const rows = publicEpisodes([episode("available"), episode("pending")]);
    expect(rows.map((e) => e.status)).toEqual(["available", "pending"]);
  });

  it("drops failed and skipped", () => {
    // `failed` advertises a failure rate to strangers and `skipped` is a row that will never be
    // readable (docs/specs/public-reading.md §3, decision 7).
    const rows = publicEpisodes([
      episode("failed"),
      episode("skipped"),
      episode("available"),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("keeps a pending episode's waitReason, which is the reason the row is shown at all", () => {
    const waiting = episode("pending", { waitReason: "CAPTIONS" });
    expect(publicEpisodes([waiting])[0]?.waitReason).toBe("CAPTIONS");
  });

  it("preserves the order it was given", () => {
    const rows = publicEpisodes([
      episode("available", { episodeId: "first" }),
      episode("failed"),
      episode("available", { episodeId: "third" }),
    ]);
    expect(rows.map((e) => e.episodeId)).toEqual(["first", "third"]);
  });
});
