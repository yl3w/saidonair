import type { Channel, Episode } from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_HEAD, headFor, headTags } from "../../src/server/head";

const ORIGIN = "https://example.test";

function channel(over: Partial<Channel> = {}): Channel {
  return {
    channelId: "UC1",
    title: "CBC Ideas",
    canonicalUrl: "https://youtube.com/channel/UC1",
    status: "approved",
    paused: false,
    approvedAt: 1,
    reviewedAt: 1,
    reviewNote: null,
    lastIngestedAt: 2,
    episodes: { available: 18, pending: 0, failed: 0, skipped: 0 },
    following: false,
    followerCount: 0,
    ...over,
  };
}

function episode(over: Partial<Episode> = {}): Episode {
  return {
    episodeId: "abc123",
    channelId: "UC1",
    channelTitle: "CBC Ideas",
    title: "How cities forget",
    publishedAt: 1,
    status: "available",
    skipReason: null,
    waitReason: null,
    summaryAvailableAt: 2,
    summary: {
      format: "structured",
      executiveSummary: "Three things the interview settles.",
      takeaways: [],
      topicTags: [],
    },
    related: [],
    ...over,
  };
}

describe("headFor", () => {
  it("names an episode by its title and its channel, and describes it with the summary", () => {
    const head = headFor({ route: "episode", episode: episode() }, ORIGIN);
    expect(head.title).toBe("How cities forget · CBC Ideas");
    expect(head.description).toBe("Three things the interview settles.");
    expect(head.canonical).toBe(`${ORIGIN}/read/abc123`);
    expect(head.type).toBe("article");
  });

  it("cuts a long summary at a word, not mid-word", () => {
    const long = `${"alpha ".repeat(60)}omega`;
    const head = headFor(
      {
        route: "episode",
        episode: episode({
          summary: {
            format: "structured",
            executiveSummary: long,
            takeaways: [],
            topicTags: [],
          },
        }),
      },
      ORIGIN,
    );
    expect(head.description.length).toBeLessThanOrEqual(201);
    expect(head.description.endsWith("…")).toBe(true);
    expect(head.description).not.toMatch(/alph…$/);
  });

  it("says something honest about an episode with no summary yet", () => {
    const head = headFor(
      {
        route: "episode",
        episode: episode({ summary: null, status: "pending" }),
      },
      ORIGIN,
    );
    expect(head.description).toContain("CBC Ideas");
    expect(head.description).not.toContain("null");
  });

  it("counts a channel's episodes, and does not say zero", () => {
    const many = headFor(
      { route: "channel", channel: channel(), episodes: [] },
      ORIGIN,
    );
    expect(many.description).toContain("18 episodes");
    const none = headFor(
      {
        route: "channel",
        channel: channel({
          episodes: { available: 0, pending: 0, failed: 0, skipped: 0 },
        }),
        episodes: [],
      },
      ORIGIN,
    );
    expect(none.description).not.toContain("0 ");
  });

  it("gives every route its own canonical URL", () => {
    expect(headFor({ route: "landing", channels: [] }, ORIGIN).canonical).toBe(
      ORIGIN,
    );
    expect(
      headFor({ route: "channel", channel: channel(), episodes: [] }, ORIGIN)
        .canonical,
    ).toBe(`${ORIGIN}/sources/UC1`);
  });
});

describe("headTags", () => {
  it("escapes the four characters an attribute cannot carry", () => {
    const tags = headTags({
      ...DEFAULT_HEAD,
      title: 'A & B <script> "quoted"',
    });
    expect(tags).toContain("A &amp; B &lt;script&gt; &quot;quoted&quot;");
    expect(tags).not.toContain("<script>");
  });

  it("emits one title and the tags an unfurl reads", () => {
    const tags = headTags(DEFAULT_HEAD);
    expect(tags.match(/<title>/g)).toHaveLength(1);
    for (const needle of [
      'name="description"',
      'property="og:title"',
      'property="og:description"',
      'property="og:url"',
      'rel="canonical"',
    ]) {
      expect(tags).toContain(needle);
    }
  });
});
