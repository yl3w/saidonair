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
  isLive: boolean;
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
  videos: Record<string, FakeTranscriptEntry>;
};

/** Eleven-character ids, so `requireVideoId` accepts them. */
export const VIDEO_ENGLISH = "english0001";
export const VIDEO_NO_CAPTIONS = "nocaption01";
export const VIDEO_NON_ENGLISH = "nonenglish1";
export const VIDEO_LIVE = "livestream1";
export const VIDEO_SHORT = "shortvideo1";
export const VIDEO_UNPLAYABLE = "unplayable1";
export const VIDEO_AUTH_FAILS = "authfail001";
export const VIDEO_LIMIT_FAILS = "limitfail01";
export const VIDEO_RATE_LIMITED = "ratelimit01";
export const VIDEO_HTTP_FAILS = "httpfail001";
export const VIDEO_PARSE_FAILS = "parsefail01";

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
  videos: {
    [VIDEO_ENGLISH]: {
      segments: englishSegments(),
      durationSec: 600,
      isLive: false,
      captionStatus: "english",
    },
    [VIDEO_NO_CAPTIONS]: {
      segments: null,
      durationSec: 900,
      isLive: false,
      captionStatus: "none",
    },
    [VIDEO_NON_ENGLISH]: {
      segments: null,
      durationSec: 1200,
      isLive: false,
      captionStatus: "non_english",
    },
    [VIDEO_LIVE]: {
      segments: null,
      durationSec: null,
      isLive: true,
      captionStatus: "none",
    },
    [VIDEO_SHORT]: {
      segments: englishSegments(12),
      durationSec: 60,
      isLive: false,
      captionStatus: "english",
    },
    [VIDEO_UNPLAYABLE]: { failure: "UNPLAYABLE" },
    [VIDEO_AUTH_FAILS]: { failure: "PROVIDER_AUTH" },
    [VIDEO_LIMIT_FAILS]: { failure: "PROVIDER_LIMIT" },
    [VIDEO_RATE_LIMITED]: { failure: "PROVIDER_RATE_LIMIT" },
    [VIDEO_HTTP_FAILS]: { failure: "PROVIDER_HTTP" },
    [VIDEO_PARSE_FAILS]: { failure: "PROVIDER_PARSE" },
  },
};
