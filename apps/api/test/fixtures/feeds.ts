/**
 * The canned YouTube feeds for tests: what `YOUTUBE_FEEDS_FAKE` carries (vitest.config.ts). A string
 * is a title-only feed with no entries, null is YouTube's 404 for an unknown id, and an object is a
 * feed with entries, rendered as Atom by `lib/youtube/rss.ts` so the parser path is production's. No
 * `cloudflare:test` import here so vitest.config.ts can load it in Node.
 *
 * A key is either a `UC…` channel id, which serves both feed URL shapes, or a `UULF…` playlist id
 * (`longFormKey`), which overrides just the long-form read that discovery makes.
 */

export type FakeFeedEntry = {
  videoId: string;
  title: string;
  publishedAt: number;
};
export type FakeFeed =
  | string
  | null
  | { title: string; entries: FakeFeedEntry[] };

/** The long-form playlist id of a channel: the fake's key for the feed discovery reads. */
export function longFormKey(channelId: string): string {
  return `UULF${channelId.slice(2)}`;
}

/** The discovery fixture channel: fifteen entries across two months before 2026-09-13. */
export const CHANNEL_F = "UCFFFFFFFFFFFFFFFFFFFFFF";

const DAY = 24 * 60 * 60 * 1000;
/** 2026-09-12T12:00:00Z, the newest entry; older ones are four days apart. */
export const FEED_F_NEWEST_AT = Date.UTC(2026, 8, 12, 12);

export const FEED_F_ENTRIES: FakeFeedEntry[] = Array.from(
  { length: 15 },
  (_, i) => ({
    videoId: `feedF${String(i).padStart(6, "0")}`,
    title: `Feed F episode ${i}`,
    publishedAt: FEED_F_NEWEST_AT - i * 4 * DAY,
  }),
);

export const FAKE_FEEDS: Record<string, FakeFeed> = {
  UCAAAAAAAAAAAAAAAAAAAAAA: "Feed A",
  UCBBBBBBBBBBBBBBBBBBBBBB: "Feed B",
  UCCCCCCCCCCCCCCCCCCCCCCC: "Feed C",
  UCDDDDDDDDDDDDDDDDDDDDDD: "Feed D",
  UCEEEEEEEEEEEEEEEEEEEEEE: null,
  [CHANNEL_F]: { title: "Feed F", entries: FEED_F_ENTRIES },
};
