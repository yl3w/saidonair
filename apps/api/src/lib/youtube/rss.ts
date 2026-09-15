// YouTube's two public feeds, both of them https://www.youtube.com/feeds/videos.xml with one query
// parameter different (docs/specs/discovery-long-form-feed.md): `channel_id=UC…` answers "does this
// channel exist" and carries its name (the add flow), `playlist_id=UULF…` — the auto-generated
// long-form uploads playlist — is what every discovery run reads, so Shorts and live streams never
// become episodes. Atom with `yt:` and `media:` extensions; about the 15 newest uploads, newest
// first. Verified against live feeds on 2026-09-07 and 2026-09-14. Quirks this parser accounts for:
// - the *channel* feed's feed-level <yt:channelId> omits the "UC" prefix and the *playlist* feed's
//   carries it; the channel feed's alternate link and every <entry> carry the full id, and the
//   playlist feed's head has no alternate link at all;
// - the playlist feed's <title> is literally "Videos", so the title comes from <author><name>,
//   which is the channel's name in both shapes;
// - an id with no feed returns a 404 HTML page, not an empty feed: an unknown channel for
//   `channel_id=`, an empty bucket for `playlist_id=`;
// - workerd has no DOMParser, so this is a small tag scanner over <entry> blocks. It only
//   reads element text, never attributes beyond the alternate link's href.
import { DomainError } from "../errors";
import { requireChannelId, requireEpisodeId } from "./ids";

/**
 * One entry of YouTube's feed, in YouTube's own vocabulary: `videoId` is the element the feed
 * carries. Discovery is the boundary where a video of theirs becomes an episode of ours
 * (`do/registry/episodes.ts` → `insertDiscovered`).
 */
export type FeedEntry = {
  videoId: string;
  title: string;
  /** Unix ms of <published>. */
  publishedAt: number;
};

export type ChannelFeed = {
  channelId: string;
  title: string;
  /** Feed order, newest first. Entries missing an id or date are skipped, not fatal. */
  entries: FeedEntry[];
};

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const FEED_ENDPOINT = "https://www.youtube.com/feeds/videos.xml";
/** Replaces `UC` in the channel id to name its long-form uploads playlist. */
const LONG_FORM_PREFIX = "UULF";

export function channelFeedUrl(channelId: string): string {
  return `${FEED_ENDPOINT}?channel_id=${channelId}`;
}

/**
 * The channel's long-form uploads playlist feed. Validates the id itself: `slice` on a malformed
 * one would build a plausible-looking wrong URL rather than throwing.
 */
export function longFormFeedUrl(channelId: string): string {
  const id = requireChannelId(channelId);
  return `${FEED_ENDPOINT}?playlist_id=${LONG_FORM_PREFIX}${id.slice(2)}`;
}

type FakeFeed =
  | string
  | null
  | {
      title: string;
      entries: { videoId: string; title: string; publishedAt: number }[];
    };

/**
 * The fetch the routes hand to the two fetchers. Real `fetch` unless the test-only
 * `YOUTUBE_FEEDS_FAKE` binding is set (vitest.config.ts, from test/fixtures/feeds.ts): a JSON object
 * of id → a feed title (no entries), null for "YouTube has no such feed", or `{ title, entries }`
 * rendered as an Atom document so the parser path is production's. A key may be a `UC…` channel id,
 * which serves both URL shapes, or a full `UULF…` playlist id, which wins over the `UC…` key and so
 * overrides just the long-form read (a `null` there is "this channel's long-form feed 404s"). Ids in
 * neither form answer 500 so a test that forgot to register one fails loudly (502) instead of
 * reaching the network. Same pattern as the fakes for Workers AI and Vectorize (AGENTS.md →
 * Testing); never set in `.dev.vars` or deployed.
 */
export function feedFetcher(env: { YOUTUBE_FEEDS_FAKE?: string }): FetchLike {
  if (env.YOUTUBE_FEEDS_FAKE === undefined) {
    return (input, init) => fetch(input, init);
  }
  const canned = JSON.parse(env.YOUTUBE_FEEDS_FAKE) as Record<string, FakeFeed>;
  return async (input) => {
    const params = new URL(input).searchParams;
    const playlistId = params.get("playlist_id");
    // The channel the request is about, whichever shape asked for it.
    const channelId =
      params.get("channel_id") ??
      (playlistId?.startsWith(LONG_FORM_PREFIX)
        ? `UC${playlistId.slice(LONG_FORM_PREFIX.length)}`
        : "");
    const key =
      playlistId !== null && playlistId in canned ? playlistId : channelId;
    if (!(key in canned)) return new Response("unregistered", { status: 500 });
    const feed = canned[key];
    if (feed === null || feed === undefined) {
      return new Response("<html>Error 404</html>", { status: 404 });
    }
    // Always rendered with the `UC…` id, whichever key matched, so the fetchers' channel-id
    // guard sees the channel the caller asked about.
    const xml =
      typeof feed === "string"
        ? fakeFeedXml(channelId, feed, [])
        : fakeFeedXml(channelId, feed.title, feed.entries);
    return new Response(xml, {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  };
}

function fakeFeedXml(
  channelId: string,
  title: string,
  entries: readonly { videoId: string; title: string; publishedAt: number }[],
): string {
  const items = entries
    .map(
      (entry) => `
 <entry>
  <yt:videoId>${entry.videoId}</yt:videoId>
  <title>${escapeXml(entry.title)}</title>
  <published>${new Date(entry.publishedAt).toISOString()}</published>
 </entry>`,
    )
    .join("");
  // <author><name> as well as <title>, so the fake exercises production's title path.
  return `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <yt:channelId>${channelId.slice(2)}</yt:channelId>
 <title>${escapeXml(title)}</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${channelId}"/>
 <author>
  <name>${escapeXml(title)}</name>
  <uri>https://www.youtube.com/channel/${channelId}</uri>
 </author>${items}
</feed>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Fetches and parses the channel's own feed: what the add flow reads for existence and the title.
 * `null` means YouTube has no channel with that id (404).
 */
export async function fetchChannelFeed(
  channelId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<ChannelFeed | null> {
  const id = requireChannelId(channelId);
  return fetchFeed(channelFeedUrl(id), id, fetchImpl);
}

/**
 * Fetches and parses the channel's long-form uploads feed: what every discovery run reads (PRD §4.2
 * rule 1). `null` means that feed 404s — no long-form uploads, or the undocumented prefix stopped
 * working — which discovery records as an unavailable feed. There is deliberately no fallback to the
 * channel feed: it would re-import Shorts and live streams (docs/specs/discovery-long-form-feed.md).
 */
export async function fetchLongFormFeed(
  channelId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<ChannelFeed | null> {
  const id = requireChannelId(channelId);
  return fetchFeed(longFormFeedUrl(id), id, fetchImpl);
}

/**
 * The read both fetchers share, so the two cannot drift: a 404 is `null`, and anything else that is
 * not a usable feed of `expectedChannelId` throws `UPSTREAM_UNAVAILABLE`, so routes report "YouTube
 * did not answer" (502) rather than blaming the user's input.
 */
async function fetchFeed(
  url: string,
  expectedChannelId: string,
  fetchImpl: FetchLike,
): Promise<ChannelFeed | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/atom+xml, application/xml, text/xml" },
    });
  } catch (error) {
    throw new DomainError(
      "UPSTREAM_UNAVAILABLE",
      `feed request failed: ${messageOf(error)}`,
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new DomainError(
      "UPSTREAM_UNAVAILABLE",
      `feed responded ${response.status}`,
    );
  }

  let feed: ChannelFeed;
  try {
    feed = parseFeed(await response.text());
  } catch (error) {
    throw new DomainError(
      "UPSTREAM_UNAVAILABLE",
      `feed could not be parsed: ${messageOf(error)}`,
    );
  }
  if (feed.channelId !== expectedChannelId) {
    throw new DomainError(
      "UPSTREAM_UNAVAILABLE",
      "feed is for a different channel",
    );
  }
  return feed;
}

/** Pure. Throws a plain Error when the document is not a channel feed. */
export function parseFeed(xml: string): ChannelFeed {
  const firstEntry = xml.indexOf("<entry>");
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);

  const title = titleOf(head);
  if (title === null) throw new Error("feed has no title");
  const channelId = channelIdOf(head);
  if (channelId === null) throw new Error("feed has no channel id");

  const entries: FeedEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = parseEntry(match[1] ?? "");
    if (entry) entries.push(entry);
  }
  return { channelId, title, entries };
}

/**
 * `<author><name>` first: it is the channel's name in both feed shapes, where the playlist feed's
 * `<title>` is literally "Videos". `<title>` is the fallback, and "feed has no title" needs both to
 * be absent. Scoped to the `<author>` block so it cannot pick up some other `<name>`.
 */
function titleOf(head: string): string | null {
  const author = /<author>([\s\S]*?)<\/author>/.exec(head)?.[1];
  const name = author === undefined ? null : textOf(author, "name");
  if (name) return name;
  return textOf(head, "title");
}

function parseEntry(block: string): FeedEntry | null {
  const videoId = textOf(block, "yt:videoId");
  const published = textOf(block, "published");
  if (videoId === null || published === null) return null;
  const publishedAt = Date.parse(published);
  if (Number.isNaN(publishedAt)) return null;
  try {
    return {
      videoId: requireEpisodeId(videoId),
      title: textOf(block, "title") ?? "(untitled)",
      publishedAt,
    };
  } catch {
    return null;
  }
}

function channelIdOf(head: string): string | null {
  const link =
    /<link[^>]*rel="alternate"[^>]*href="[^"]*\/channel\/(UC[A-Za-z0-9_-]{22})"/.exec(
      head,
    );
  if (link?.[1]) return link[1];
  // The playlist feed's head has no alternate link, so it always lands here; its feed-level id
  // carries the "UC" prefix where the channel feed's strips it, and both are accepted.
  const bare = textOf(head, "yt:channelId");
  if (bare === null) return null;
  const candidate = bare.startsWith("UC") ? bare : `UC${bare}`;
  return /^UC[A-Za-z0-9_-]{22}$/.test(candidate) ? candidate : null;
}

/** Text of the first `<tag>` element in `xml`, CDATA unwrapped and entities decoded. */
function textOf(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(
    xml,
  );
  if (!match) return null;
  const raw = (match[1] ?? "").replace(
    /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,
    "$1",
  );
  return decodeEntities(raw).trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return NAMED_ENTITIES[body] ?? whole;
    },
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
