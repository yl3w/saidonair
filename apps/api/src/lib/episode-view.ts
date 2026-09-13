import type { Episode } from "@media-digest/shared";
import type { EpisodeRecord } from "../do/registry/types";

export type EpisodeView = {
  /**
   * The caller's receipt state before this response, when the route recorded one. Receipts exist
   * only for eligible callers, an active follower of an approved channel (docs/PRD.md §4.4).
   */
  wasUnread?: boolean;
};

/**
 * The one projection from the Registry's episode onto the shared `Episode`. Every caller receives
 * the summary, the related titles, and the `processing` block: the API enforces no authorization
 * (docs/PRD.md §7, §9). The related titles arrive already filtered to the caller's eligible channels.
 */
export function toEpisode(
  record: EpisodeRecord,
  view: EpisodeView = {},
): Episode {
  const episode: Episode = {
    videoId: record.videoId,
    channelId: record.channelId,
    channelTitle: record.channelTitle,
    title: record.title,
    publishedAt: record.publishedAt,
    status: record.status,
    skipReason: record.processing.skipReason,
    summary: record.summary,
    related: record.related,
    processing: record.processing,
  };
  if (view.wasUnread !== undefined) episode.wasUnread = view.wasUnread;
  return episode;
}
