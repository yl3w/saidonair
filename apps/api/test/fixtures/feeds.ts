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

/** Its channel feed verifies at add time; its long-form feed 404s, so discovery is unavailable. */
export const CHANNEL_G = "UCGGGGGGGGGGGGGGGGGGGGGG";

/**
 * A channel whose newest uploads are mostly Shorts: six in the channel feed, two of them long-form.
 * The long-form feed is an exact subset of the channel feed, which is what `GET /channels/feed`
 * counts the overlap of.
 */
export const CHANNEL_H = "UCHHHHHHHHHHHHHHHHHHHHHH";

const FEED_H_ENTRIES: FakeFeedEntry[] = Array.from({ length: 6 }, (_, i) => ({
  videoId: `feedH${String(i).padStart(6, "0")}`,
  title: `Feed H upload ${i}`,
  publishedAt: FEED_F_NEWEST_AT - i * DAY,
}));
/** The two long-form ones: the newest, and the fourth. */
export const FEED_H_LONG_FORM = [FEED_H_ENTRIES[0], FEED_H_ENTRIES[3]].filter(
  (entry): entry is FakeFeedEntry => entry !== undefined,
);

export const FAKE_FEEDS: Record<string, FakeFeed> = {
  UCAAAAAAAAAAAAAAAAAAAAAA: "Feed A",
  UCBBBBBBBBBBBBBBBBBBBBBB: "Feed B",
  UCCCCCCCCCCCCCCCCCCCCCCC: "Feed C",
  UCDDDDDDDDDDDDDDDDDDDDDD: "Feed D",
  UCEEEEEEEEEEEEEEEEEEEEEE: null,
  // F's entries sit under the long-form key alone, and its channel feed is title-only: a discovery
  // run that read `channel_id=` would find nothing, so every count below proves which feed was read.
  [CHANNEL_F]: "Feed F",
  [longFormKey(CHANNEL_F)]: { title: "Feed F", entries: FEED_F_ENTRIES },
  [CHANNEL_G]: "Feed G",
  [longFormKey(CHANNEL_G)]: null,
  [CHANNEL_H]: { title: "Feed H", entries: FEED_H_ENTRIES },
  [longFormKey(CHANNEL_H)]: { title: "Feed H", entries: FEED_H_LONG_FORM },
};
