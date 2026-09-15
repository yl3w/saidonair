/**
 * The canned transcript provider for tests: what `TRANSCRIPTS_FAKE` carries (vitest.config.ts) and
 * the ids tests refer to. No `cloudflare:test` import here so vitest.config.ts can load it in Node.
 * Shape: docs/specs/m3-1-transcripts-chunking.md §2.
 */

export type FakeTranscriptFailure =
  | "UNPLAYABLE"
  | "PROVIDER_AUTH"
  | "PROVIDER_LIMIT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_HTTP"
  | "PROVIDER_PARSE";

export type FakeSegment = {
  text: string;
  startSec: number;
  durationSec: number;
};

export type FakeTranscriptResult = {
  segments: FakeSegment[] | null;
  durationSec: number | null;
  captionStatus: "english" | "none" | "non_english";
};

export type FakeTranscriptEntry =
  | FakeTranscriptResult
  | { failure: FakeTranscriptFailure };

export type FakeTranscripts = {
  status?: {
    remainingCredits: number | null;
    status: "ok" | "auth_failed" | "unreachable";
  };
  episodes: Record<string, FakeTranscriptEntry>;
};

/**
 * Eleven-character ids, so `requireEpisodeId` accepts them. `EPISODE_LIVE` is an `UNPLAYABLE` failure
 * since 2026-09-14: live content is no longer discovered, and the provider's live `error` bodies all
 * throw (docs/specs/discovery-long-form-feed.md).
 */
export const EPISODE_ENGLISH = "english0001";
export const EPISODE_NO_CAPTIONS = "nocaption01";
export const EPISODE_NON_ENGLISH = "nonenglish1";
export const EPISODE_LIVE = "livestream1";
export const EPISODE_SHORT = "shortvideo1";
export const EPISODE_UNPLAYABLE = "unplayable1";
export const EPISODE_AUTH_FAILS = "authfail001";
export const EPISODE_LIMIT_FAILS = "limitfail01";
export const EPISODE_RATE_LIMITED = "ratelimit01";
export const EPISODE_HTTP_FAILS = "httpfail001";
export const EPISODE_PARSE_FAILS = "parsefail01";

const SENTENCES = [
  "Today we look at how a small team keeps a long-lived tool maintainable.",
  "The first rule is to prefer boring, readable modules over clever ones.",
  "Every external call gets its own retry policy and its own timeout.",
  "We store one canonical copy of each transcript and never duplicate it per user.",
  "Chunks overlap by a segment or two so a point on a boundary is still found.",
  "The embedding model truncates silently past five hundred and twelve tokens.",
  "Summaries carry timestamps so a reader can jump to the moment a claim is made.",
  "Nothing publishes until the whole vector generation has been verified.",
  "A replacement keeps the old summary readable until the new one succeeds.",
  "Recovery runs every six hours for two days and then stops with a reason.",
];

/** About ten minutes of English speech: 120 segments of five seconds. */
export function englishSegments(count = 120, secondsEach = 5): FakeSegment[] {
  const segments: FakeSegment[] = [];
  for (let i = 0; i < count; i++) {
    segments.push({
      text: `${SENTENCES[i % SENTENCES.length]} (part ${i + 1})`,
      startSec: i * secondsEach,
      durationSec: secondsEach,
    });
  }
  return segments;
}

export const FAKE_TRANSCRIPTS: FakeTranscripts = {
  status: { remainingCredits: 1000, status: "ok" },
  episodes: {
    [EPISODE_ENGLISH]: {
      segments: englishSegments(),
      durationSec: 600,
      captionStatus: "english",
    },
    [EPISODE_NO_CAPTIONS]: {
      segments: null,
      durationSec: 900,
      captionStatus: "none",
    },
    [EPISODE_NON_ENGLISH]: {
      segments: null,
      durationSec: 1200,
      captionStatus: "non_english",
    },
    [EPISODE_LIVE]: { failure: "UNPLAYABLE" },
    [EPISODE_SHORT]: {
      segments: englishSegments(12),
      durationSec: 60,
      captionStatus: "english",
    },
    [EPISODE_UNPLAYABLE]: { failure: "UNPLAYABLE" },
    [EPISODE_AUTH_FAILS]: { failure: "PROVIDER_AUTH" },
    [EPISODE_LIMIT_FAILS]: { failure: "PROVIDER_LIMIT" },
    [EPISODE_RATE_LIMITED]: { failure: "PROVIDER_RATE_LIMIT" },
    [EPISODE_HTTP_FAILS]: { failure: "PROVIDER_HTTP" },
    [EPISODE_PARSE_FAILS]: { failure: "PROVIDER_PARSE" },
  },
};
