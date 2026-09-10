import type { Episode } from "@media-digest/shared";
import type { EpisodeRecord } from "../do/registry/types";

export type EpisodeView = {
  /** Followers and the owner see summaries and related titles; others see titles only. */
  includeSummary: boolean;
  /** Owner only. */
  includeProcessing: boolean;
  /** The caller's receipt state before this response, when a summary is being returned. */
  wasUnread?: boolean;
};

/**
 * The one projection from the Registry's episode onto the shared `Episode`. `skipReason` is
 * reader-safe (Ruling R15): every caller sees why an episode was skipped, while the rest of
 * `processing` stays owner-only.
 */
export function toEpisode(record: EpisodeRecord, view: EpisodeView): Episode {
  const episode: Episode = {
    videoId: record.videoId,
    channelId: record.channelId,
    channelTitle: record.channelTitle,
    title: record.title,
    publishedAt: record.publishedAt,
    status: record.status,
    skipReason: record.processing.skipReason,
    summary: view.includeSummary ? record.summary : null,
    related: view.includeSummary ? record.related : [],
  };
  if (view.includeSummary && view.wasUnread !== undefined) {
    episode.wasUnread = view.wasUnread;
  }
  if (view.includeProcessing) episode.processing = record.processing;
  return episode;
}
