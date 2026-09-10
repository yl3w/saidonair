// The user-facing phrases from docs/specs/channel-simplification.md §4 and §7, in one place so
// screens never invent their own wording.
import type {
  Channel,
  ChannelDeclinedResponse,
  ChannelStatus,
  Episode,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeWaitingCode,
} from "@media-digest/shared";
import { ApiError } from "../api";
import { absoluteTime } from "./time";

export const CHANNEL_STATUS_COPY: Record<ChannelStatus, string> = {
  requested: "Awaiting owner approval",
  approved: "Approved",
  declined: "Declined",
};

/** One phrase for a channel row. A declined channel that had been approved reads "Withdrawn". */
export function channelStateCopy(channel: Channel): string {
  if (channel.status === "declined")
    return channel.approvedAt === null ? "Declined" : "Withdrawn";
  if (channel.status === "approved" && channel.paused)
    return "Approved · paused";
  return CHANNEL_STATUS_COPY[channel.status];
}

/** The owner's latest decision with its note, for declined channels and re-requests. */
export function reviewCopy(channel: Channel): string | null {
  if (channel.status !== "declined" || channel.reviewedAt === null) return null;
  const verb = channel.approvedAt === null ? "Declined" : "Withdrawn";
  const note = channel.reviewNote ? `: “${channel.reviewNote}”` : "";
  return `${verb} on ${absoluteTime(channel.reviewedAt)}${note}`;
}

export const EPISODE_STATUS_COPY: Record<EpisodeStatus, string> = {
  pending: "Not summarised yet",
  available: "Summarised",
  failed: "Summary failed; the owner has been notified",
  skipped: "No summary",
};

export const SKIP_REASON_COPY: Record<EpisodeSkipReason, string> = {
  SHORT: "under three minutes",
  NON_ENGLISH: "no English captions",
  NO_CAPTIONS: "no captions",
  LIVE_OR_UPCOMING: "live or upcoming",
  UNPLAYABLE: "video unavailable",
  OWNER: "skipped by the owner",
};

export const WAITING_CODE_COPY: Record<EpisodeWaitingCode, string> = {
  CAPTIONS: "waiting for captions",
  LIVE_OR_UPCOMING: "waiting for the stream to end",
  PROVIDER_LIMIT: "waiting for transcript credits",
};

/** The phrase under an episode title when there is no summary to show; null for an available one. */
export function episodePhrase(episode: Episode): string | null {
  if (episode.status === "available") return null;
  const waiting = episode.processing?.waitingCode;
  if (episode.status === "pending" && waiting)
    return WAITING_CODE_COPY[waiting];
  const reason = episode.processing?.skipReason;
  if (episode.status === "skipped" && reason)
    return `No summary: ${SKIP_REASON_COPY[reason]}`;
  return EPISODE_STATUS_COPY[episode.status];
}

export const CHANNEL_ID_HELP =
  "On the channel's page open About, then Share channel, then Copy channel ID.";

/** The 409 body for a declined channel, from `POST /channels` or `PUT /follows/:id`. */
export function isDeclinedResponse(
  error: unknown,
): error is ApiError & { body: ChannelDeclinedResponse } {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const body = error.body as Partial<ChannelDeclinedResponse> | null;
  return body?.status === "declined" && typeof body.channelId === "string";
}
