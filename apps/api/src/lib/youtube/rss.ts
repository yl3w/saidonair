// YouTube's public channel feed: https://www.youtube.com/feeds/videos.xml?channel_id=UC…
// Atom with `yt:` and `media:` extensions; about the 15 newest uploads, newest first. Verified
// against a live feed on 2026-09-07. Quirks this parser accounts for:
// - the feed-level <yt:channelId> omits the "UC" prefix; the alternate link and every <entry>
//   carry the full id, so the channel id comes from those;
// - an unknown channel id returns a 404 HTML page, not an empty feed;
// - workerd has no DOMParser, so this is a small tag scanner over <entry> blocks. It only
//   reads element text, never attributes beyond the alternate link's href.
import { DomainError } from "../errors";
import { requireChannelId, requireVideoId } from "./ids";

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

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

type FakeFeed =
  | string
  | null
  | {
      title: string;
      entries: { videoId: string; title: string; publishedAt: number }[];
    };

/**
 * The fetch the routes hand to `fetchChannelFeed`. Real `fetch` unless the test-only
 * `YOUTUBE_FEEDS_FAKE` binding is set (vitest.config.ts, from test/fixtures/feeds.ts): a JSON object
 * of channel id → a feed title (no entries), null for "YouTube has no such channel", or
 * `{ title, entries }` rendered as an Atom document so the parser path is production's. Ids outside
 * the map answer 500 so a test that forgot to register one fails loudly (502) instead of reaching the
 * network. Same pattern as the fakes for Workers AI and Vectorize (AGENTS.md → Testing); never set
 * in `.dev.vars` or deployed.
 */
export function feedFetcher(env: { YOUTUBE_FEEDS_FAKE?: string }): FetchLike {
  if (env.YOUTUBE_FEEDS_FAKE === undefined) {
    return (input, init) => fetch(input, init);
  }
  const canned = JSON.parse(env.YOUTUBE_FEEDS_FAKE) as Record<string, FakeFeed>;
  return async (input) => {
    const channelId = new URL(input).searchParams.get("channel_id") ?? "";
    if (!(channelId in canned))
      return new Response("unregistered", { status: 500 });
    const feed = canned[channelId];
    if (feed === null || feed === undefined) {
      return new Response("<html>Error 404</html>", { status: 404 });
    }
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
  return `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <yt:channelId>${channelId.slice(2)}</yt:channelId>
 <title>${escapeXml(title)}</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${channelId}"/>${items}
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
 * Fetches and parses a channel's feed. `null` means YouTube has no channel with that id (404).
 * Anything else that is not a usable feed throws `UPSTREAM_UNAVAILABLE`, so routes report "YouTube
 * did not answer" (502) rather than blaming the user's input.
 */
export async function fetchChannelFeed(
  channelId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<ChannelFeed | null> {
  const id = requireChannelId(channelId);
  let response: Response;
  try {
    response = await fetchImpl(feedUrl(id), {
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
  if (feed.channelId !== id) {
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

  const title = textOf(head, "title");
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

function parseEntry(block: string): FeedEntry | null {
  const videoId = textOf(block, "yt:videoId");
  const published = textOf(block, "published");
  if (videoId === null || published === null) return null;
  const publishedAt = Date.parse(published);
  if (Number.isNaN(publishedAt)) return null;
  try {
    return {
      videoId: requireVideoId(videoId),
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
  // Fall back to the prefix-less feed-level id.
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
