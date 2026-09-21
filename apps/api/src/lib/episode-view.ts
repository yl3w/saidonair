import {
  type Episode,
  type EpisodeIngestionAttempt,
  type EpisodeStatus,
  type EpisodeWaitReason,
  EpisodeWaitReasonSchema,
} from "@media-digest/shared";
import type { EpisodeRecord } from "../do/registry/types";

export type EpisodeView = {
  /**
   * Whether the caller has a read receipt for this summary. Receipts exist only for eligible
   * callers, an active follower of an approved channel, and only an explicit write records one
   * (docs/PRD.md §4.4); omitted for everyone else.
   */
  read?: boolean;
};

/**
 * The one projection from the Registry's episode onto the shared `Episode`. Every caller receives
 * the summary, the related titles, and the `processing` block: reading is open to every caller
 * (docs/PRD.md §7, §9). The related titles arrive already filtered to the caller's eligible channels.
 */
export function toEpisode(
  record: EpisodeRecord,
  view: EpisodeView = {},
): Episode {
  const episode: Episode = {
    episodeId: record.episodeId,
    channelId: record.channelId,
    channelTitle: record.channelTitle,
    title: record.title,
    publishedAt: record.publishedAt,
    status: record.status,
    skipReason: record.skipReason,
    waitReason: waitReasonOf(record.status, record.processing.latestAttempt),
    summaryAvailableAt: record.summaryAvailableAt,
    summary: record.summary,
    related: record.related,
    processing: record.processing,
  };
  if (view.read !== undefined) episode.read = view.read;
  return episode;
}

const WAIT_REASONS: ReadonlySet<string> = new Set(
  EpisodeWaitReasonSchema.options,
);

/**
 * The reader-safe wait reason of a pending episode, from its latest attempt (owner decision
 * 2026-09-12, docs/PRD.md §4.2 rule 11): a `waiting` attempt gives its code; a `blocked` attempt
 * with `PROVIDER_LIMIT` reads as the same wait as the in-flight provider reason; a running attempt,
 * a technical failure, a `PROVIDER_AUTH` block, no attempt, or any status other than `pending` gives
 * null, which the web phrases as "Not summarised yet". Pure, so the rule is testable on its own.
 */
export function waitReasonOf(
  status: EpisodeStatus,
  latest: EpisodeIngestionAttempt | null,
): EpisodeWaitReason | null {
  if (status !== "pending" || latest === null) return null;
  if (latest.status === "waiting") return asWaitReason(latest.outcomeCode);
  if (latest.status === "blocked" && latest.outcomeCode === "PROVIDER_LIMIT") {
    return "PROVIDER_LIMIT";
  }
  return null;
}

function asWaitReason(code: string | null): EpisodeWaitReason | null {
  return code !== null && WAIT_REASONS.has(code)
    ? (code as EpisodeWaitReason)
    : null;
}
