import { describe, expect, it } from "vitest";
import { domainErrorCode } from "../src/lib/errors";
import {
  type ChannelFeed,
  channelFeedUrl,
  feedFetcher,
  fetchChannelFeed,
  fetchLongFormFeed,
  longFormFeedUrl,
  parseFeed,
} from "../src/lib/youtube/rss";
import { longFormKey } from "./fixtures/feeds";
import { CHANNEL_A, CHANNEL_B, expectDomainError } from "./helpers";

// Trimmed from a live feed on 2026-09-07: the feed-level yt:channelId lacks the "UC" prefix, entries
// carry the full id, titles may hold entities, and media:title must not be mistaken for title.
function feedXml(channelId: string, title = "Channel &amp; Co"): string {
  const bare = channelId.slice(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${channelId}"/>
 <id>yt:channel:${bare}</id>
 <yt:channelId>${bare}</yt:channelId>
 <title>${title}</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${channelId}"/>
 <author>
  <name>${title}</name>
  <uri>https://www.youtube.com/channel/${channelId}</uri>
 </author>
 <published>2010-07-21T07:18:02+00:00</published>
 <entry>
  <id>yt:video:oR94cicO7xM</id>
  <yt:videoId>oR94cicO7xM</yt:videoId>
  <yt:channelId>${channelId}</yt:channelId>
  <title>A Physics Professor Bet Me $10,000 I&#39;m Wrong&#x2026;</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/oR94cicO7xM"/>
  <published>2026-09-06T13:00:26+00:00</published>
  <updated>2026-09-07T21:34:50+00:00</updated>
  <media:group>
   <media:title>A Physics Professor Bet Me $10,000 I'm Wrong…</media:title>
   <media:description>Line one.

Line two &amp; more.</media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:F5_G0AHfYhI</id>
  <yt:videoId>F5_G0AHfYhI</yt:videoId>
  <yt:channelId>${channelId}</yt:channelId>
  <title><![CDATA[Second <b>episode</b>]]></title>
  <published>2026-09-02T13:00:04+00:00</published>
 </entry>
 <entry>
  <id>yt:video:broken</id>
  <yt:videoId>short</yt:videoId>
  <title>Malformed entry is skipped</title>
  <published>2026-09-01T00:00:00+00:00</published>
 </entry>
 <entry>
  <id>yt:video:nodate00000</id>
  <yt:videoId>nodate00000</yt:videoId>
  <title>No published date is skipped</title>
 </entry>
</feed>
`;
}

// Trimmed from a live long-form playlist feed on 2026-09-14: no alternate link, the feed-level
// yt:channelId *carries* the "UC" prefix, and <title> is literally "Videos" — the channel's name is
// in <author><name>. Entries are shaped exactly as the channel feed's.
function playlistFeedXml(channelId: string, title = "Channel & Co"): string {
  const playlistId = longFormKey(channelId);
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}"/>
 <id>yt:playlist:${playlistId}</id>
 <yt:playlistId>${playlistId}</yt:playlistId>
 <yt:channelId>${channelId}</yt:channelId>
 <title>Videos</title>
 <author>
  <name>${title}</name>
  <uri>https://www.youtube.com/channel/${channelId}</uri>
 </author>
 <published>2010-07-21T07:18:02+00:00</published>
 <entry>
  <id>yt:video:oR94cicO7xM</id>
  <yt:videoId>oR94cicO7xM</yt:videoId>
  <yt:channelId>${channelId}</yt:channelId>
  <title>A long-form episode</title>
  <published>2026-09-06T13:00:26+00:00</published>
 </entry>
</feed>
`;
}

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <yt:channelId>${CHANNEL_A.slice(2)}</yt:channelId>
 <title>Quiet</title>
</feed>`;

function respond(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": status === 404 ? "text/html" : "application/xml",
    },
  });
}

describe("youtube rss", () => {
  it("parses the channel title, full channel id, and entries newest first", () => {
    const feed = parseFeed(feedXml(CHANNEL_A));
    expect(feed.channelId).toBe(CHANNEL_A);
    expect(feed.title).toBe("Channel & Co");
    expect(feed.entries).toEqual([
      {
        videoId: "oR94cicO7xM",
        title: "A Physics Professor Bet Me $10,000 I'm Wrong…",
        publishedAt: Date.parse("2026-09-06T13:00:26+00:00"),
      },
      {
        videoId: "F5_G0AHfYhI",
        title: "Second <b>episode</b>",
        publishedAt: Date.parse("2026-09-02T13:00:04+00:00"),
      },
    ]);
  });

  it("builds both feed urls of the one endpoint", () => {
    expect(channelFeedUrl(CHANNEL_A)).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_A}`,
    );
    expect(longFormFeedUrl(CHANNEL_A)).toBe(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${CHANNEL_A.slice(2)}`,
    );
    // The long-form url validates the id itself, so a malformed one throws before any fetch.
    expect(() => longFormFeedUrl("@handle")).toThrow();
  });

  it("parses the playlist head: the author name as title, the prefixed feed id", () => {
    expect(parseFeed(playlistFeedXml(CHANNEL_A))).toEqual<ChannelFeed>({
      channelId: CHANNEL_A,
      title: "Channel & Co",
      entries: [
        {
          videoId: "oR94cicO7xM",
          title: "A long-form episode",
          publishedAt: Date.parse("2026-09-06T13:00:26+00:00"),
        },
      ],
    });
    // Either half of the title rule alone is enough; both absent is the error.
    expect(
      parseFeed(
        `<feed><yt:channelId>${CHANNEL_A}</yt:channelId><author><name></name></author><title>Only a title</title></feed>`,
      ).title,
    ).toBe("Only a title");
    expect(() =>
      parseFeed(`<feed><yt:channelId>${CHANNEL_A}</yt:channelId></feed>`),
    ).toThrow(/title/);
  });

  it("falls back to the prefix-less feed id and tolerates an empty feed", () => {
    expect(parseFeed(EMPTY_FEED)).toEqual<ChannelFeed>({
      channelId: CHANNEL_A,
      title: "Quiet",
      entries: [],
    });
    expect(() => parseFeed("<feed><title>x</title></feed>")).toThrow(
      /channel id/,
    );
    expect(() => parseFeed("<html>not a feed</html>")).toThrow(/title/);
  });

  it("returns null for an unknown channel and throws UPSTREAM_UNAVAILABLE otherwise", async () => {
    const calls: string[] = [];
    const fake = (status: number, body: string) => async (input: string) => {
      calls.push(input);
      return respond(status, body);
    };

    expect(await fetchChannelFeed(CHANNEL_A, fake(404, "<html/>"))).toBeNull();
    expect(calls).toEqual([channelFeedUrl(CHANNEL_A)]);

    const ok = await fetchChannelFeed(CHANNEL_A, fake(200, feedXml(CHANNEL_A)));
    expect(ok?.title).toBe("Channel & Co");
    expect(ok?.entries).toHaveLength(2);

    await expectDomainError(
      fetchChannelFeed(CHANNEL_A, fake(500, "boom")),
      "UPSTREAM_UNAVAILABLE",
    );
    await expectDomainError(
      fetchChannelFeed(CHANNEL_A, fake(200, "<html>captcha</html>")),
      "UPSTREAM_UNAVAILABLE",
    );
    await expectDomainError(
      fetchChannelFeed(CHANNEL_A, fake(200, feedXml(CHANNEL_B))),
      "UPSTREAM_UNAVAILABLE",
    );
    await expectDomainError(
      fetchChannelFeed(CHANNEL_A, async () => {
        throw new TypeError("network down");
      }),
      "UPSTREAM_UNAVAILABLE",
    );
    await expectDomainError(fetchChannelFeed("@handle"), "INVALID_INPUT");

    try {
      await fetchChannelFeed(CHANNEL_A, fake(503, ""));
    } catch (error) {
      expect(domainErrorCode(error)).toBe("UPSTREAM_UNAVAILABLE");
      expect((error as Error).message).toContain("503");
    }
  });
});

describe("the long-form feed", () => {
  it("reads the playlist url and applies the same rules as the channel feed", async () => {
    const calls: string[] = [];
    const fake = (status: number, body: string) => async (input: string) => {
      calls.push(input);
      return respond(status, body);
    };

    const feed = await fetchLongFormFeed(
      CHANNEL_A,
      fake(200, playlistFeedXml(CHANNEL_A)),
    );
    expect(feed?.channelId).toBe(CHANNEL_A);
    expect(feed?.title).toBe("Channel & Co");
    expect(feed?.entries).toHaveLength(1);
    expect(calls).toEqual([longFormFeedUrl(CHANNEL_A)]);

    // An empty bucket 404s, which discovery records as an unavailable feed.
    expect(await fetchLongFormFeed(CHANNEL_A, fake(404, "<html/>"))).toBeNull();
    // The channel-id guard holds for the playlist shape too.
    await expectDomainError(
      fetchLongFormFeed(CHANNEL_A, fake(200, playlistFeedXml(CHANNEL_B))),
      "UPSTREAM_UNAVAILABLE",
    );
    await expectDomainError(
      fetchLongFormFeed(CHANNEL_A, fake(500, "boom")),
      "UPSTREAM_UNAVAILABLE",
    );
    await expectDomainError(fetchLongFormFeed("@handle"), "INVALID_INPUT");
  });
});

describe("the feed fake", () => {
  it("renders a title-only feed, a 404, and a feed with entries the parser reads back", async () => {
    const fetchImpl = feedFetcher({
      YOUTUBE_FEEDS_FAKE: JSON.stringify({
        [CHANNEL_A]: "Only a title",
        [CHANNEL_B]: {
          title: "Tom & Jerry",
          entries: [
            {
              videoId: "aaaaaaaaaaa",
              title: "First <b>one</b>",
              publishedAt: 1_700_000_000_000,
            },
            {
              videoId: "bbbbbbbbbbb",
              title: "Second",
              publishedAt: 1_600_000_000_000,
            },
          ],
        },
        UCCCCCCCCCCCCCCCCCCCCCCC: null,
      }),
    });
    expect(await fetchChannelFeed(CHANNEL_A, fetchImpl)).toEqual({
      channelId: CHANNEL_A,
      title: "Only a title",
      entries: [],
    });
    expect(await fetchChannelFeed(CHANNEL_B, fetchImpl)).toEqual({
      channelId: CHANNEL_B,
      title: "Tom & Jerry",
      entries: [
        {
          videoId: "aaaaaaaaaaa",
          title: "First <b>one</b>",
          publishedAt: 1_700_000_000_000,
        },
        {
          videoId: "bbbbbbbbbbb",
          title: "Second",
          publishedAt: 1_600_000_000_000,
        },
      ],
    });
    expect(
      await fetchChannelFeed("UCCCCCCCCCCCCCCCCCCCCCCC", fetchImpl),
    ).toBeNull();
    // An unregistered id is a 500 from the fake, so a forgotten fixture fails loudly as 502.
    await expectDomainError(
      fetchChannelFeed("UCDDDDDDDDDDDDDDDDDDDDDD", fetchImpl),
      "UPSTREAM_UNAVAILABLE",
    );
  });

  it("serves both url shapes from a UC key, and lets a UULF key override the long-form read", async () => {
    const fetchImpl = feedFetcher({
      YOUTUBE_FEEDS_FAKE: JSON.stringify({
        [CHANNEL_A]: "Both shapes",
        [CHANNEL_B]: "Channel feed only",
        [longFormKey(CHANNEL_B)]: {
          title: "Long-form only",
          entries: [
            {
              videoId: "aaaaaaaaaaa",
              title: "An episode",
              publishedAt: 1_700_000_000_000,
            },
          ],
        },
        [longFormKey("UCCCCCCCCCCCCCCCCCCCCCCC")]: null,
        UCCCCCCCCCCCCCCCCCCCCCCC: "Has no long-form uploads",
      }),
    });

    // One UC key answers both reads, so every existing fixture keeps working.
    expect((await fetchChannelFeed(CHANNEL_A, fetchImpl))?.title).toBe(
      "Both shapes",
    );
    expect((await fetchLongFormFeed(CHANNEL_A, fetchImpl))?.title).toBe(
      "Both shapes",
    );

    // A full playlist-id key wins for the long-form read only.
    expect((await fetchChannelFeed(CHANNEL_B, fetchImpl))?.entries).toEqual([]);
    expect(
      (await fetchLongFormFeed(CHANNEL_B, fetchImpl))?.entries,
    ).toHaveLength(1);

    // `"UULF…": null` is "this channel's long-form feed 404s", the channel itself still verifying.
    expect(
      await fetchLongFormFeed("UCCCCCCCCCCCCCCCCCCCCCCC", fetchImpl),
    ).toBeNull();
    expect(
      (await fetchChannelFeed("UCCCCCCCCCCCCCCCCCCCCCCC", fetchImpl))?.title,
    ).toBe("Has no long-form uploads");

    // A playlist id in neither form is still a loud 500.
    await expectDomainError(
      fetchLongFormFeed("UCDDDDDDDDDDDDDDDDDDDDDD", fetchImpl),
      "UPSTREAM_UNAVAILABLE",
    );
  });
});
