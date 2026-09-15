import type { TranscriptProviderHealth } from "@media-digest/shared";
import { downsubSource } from "./downsub";
import {
  TRANSCRIPT_FAILURES,
  TranscriptError,
  type TranscriptFailure,
  type TranscriptResult,
  type TranscriptSource,
} from "./types";

/**
 * `transcriptSource(env)`: the test-only `TRANSCRIPTS_FAKE` binding wins (canned results or a failure
 * reason per episode id, and the provider's health, the `YOUTUBE_FEEDS_FAKE` pattern); otherwise the
 * DownSub adapter. Tests never reach the network: the pinned pool has no `fetchMock`, so a binding is
 * the one seam that works end to end (AGENTS.md → Testing).
 */

export type TranscriptEnv = {
  DOWNSUB_API_KEY?: string;
  TRANSCRIPTS_FAKE?: string;
};

type FakeEntry = TranscriptResult | { failure: TranscriptFailure };

type FakeTranscripts = {
  status?: TranscriptProviderHealth;
  episodes: Record<string, FakeEntry>;
};

export function transcriptSource(env: TranscriptEnv): TranscriptSource {
  if (env.TRANSCRIPTS_FAKE !== undefined) {
    return fakeSource(parseFake(env.TRANSCRIPTS_FAKE));
  }
  return downsubSource(env.DOWNSUB_API_KEY);
}

/** The fake's provider health, or null when the fake is not in use. */
export function fakeProviderHealth(
  env: TranscriptEnv,
): TranscriptProviderHealth | null {
  if (env.TRANSCRIPTS_FAKE === undefined) return null;
  return (
    parseFake(env.TRANSCRIPTS_FAKE).status ?? {
      remainingCredits: null,
      status: "unreachable",
    }
  );
}

function fakeSource(fake: FakeTranscripts): TranscriptSource {
  return {
    async fetch(episodeId) {
      const entry = fake.episodes[episodeId];
      if (entry === undefined) {
        // Like the feed fake's 500: a test that forgot to register a video fails loudly.
        throw new TranscriptError(
          "PROVIDER_HTTP",
          `unregistered fake episode ${episodeId}`,
        );
      }
      if ("failure" in entry) {
        throw new TranscriptError(entry.failure, "canned failure");
      }
      return entry;
    },
  };
}

// Parsed once per distinct binding value: a test may reassign the binding, so the key is the text.
let parsed: { raw: string; fake: FakeTranscripts } | null = null;

function parseFake(raw: string): FakeTranscripts {
  if (parsed && parsed.raw === raw) return parsed.fake;
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || !("episodes" in value)) {
    throw new Error("TRANSCRIPTS_FAKE must be an object with `episodes`");
  }
  const fake = value as FakeTranscripts;
  for (const [episodeId, entry] of Object.entries(fake.episodes)) {
    if (
      "failure" in entry &&
      !TRANSCRIPT_FAILURES.includes(entry.failure as TranscriptFailure)
    ) {
      throw new Error(
        `TRANSCRIPTS_FAKE: unknown failure ${String(entry.failure)} for ${episodeId}`,
      );
    }
  }
  parsed = { raw, fake };
  return fake;
}
