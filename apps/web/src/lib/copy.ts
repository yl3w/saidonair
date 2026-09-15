// The user-facing phrases from docs/specs/channel-simplification.md §4 and §7, in one place so
// screens never invent their own wording.
import type {
  AttemptOutcomeCode,
  Channel,
  ChannelDeclinedResponse,
  ChannelStatus,
  Episode,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeSummary,
  EpisodeWaitReason,
  IngestionRun,
  ProcessingIntent,
} from "@media-digest/shared";
import { ApiError } from "../api";
import { absoluteTime, HOUR, MINUTE } from "./time";

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

/** The decision word for review history: "Approved", "Declined", or "Withdrawn" (declined after approval). */
export function decisionCopy(channel: Channel): string {
  if (channel.status === "approved") return "Approved";
  return channel.approvedAt === null ? "Declined" : "Withdrawn";
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
  UNPLAYABLE: "video unavailable or live",
  OWNER: "skipped by the owner",
};

/** Why a pending episode is not summarised yet, from `Episode.waitReason` (every caller sees it). */
export const WAIT_REASON_COPY: Record<EpisodeWaitReason, string> = {
  CAPTIONS: "waiting for captions",
  PROVIDER_LIMIT: "waiting for transcript credits",
};

/** The owner's phrase for an attempt's outcome. Exhaustive: a new code is a compile error here first. */
export const OUTCOME_CODE_COPY: Record<AttemptOutcomeCode, string> = {
  CAPTIONS: "no captions yet",
  PROVIDER_LIMIT: "transcript credits exhausted",
  SHORT: "under three minutes",
  NON_ENGLISH: "no English captions",
  UNPLAYABLE: "video unavailable or live",
  PROVIDER_AUTH: "transcript key rejected",
  PROVIDER_RATE_LIMIT: "transcript provider rate-limited",
  PROVIDER_HTTP: "transcript provider error",
  PROVIDER_PARSE: "transcript could not be parsed",
  TRANSCRIPT_TOO_LARGE: "transcript too large",
  EMBEDDING_FAILED: "embedding failed",
  VECTORIZE_INCOMPLETE: "vector store incomplete",
  SUMMARY_FAILED: "summary failed",
  WORKFLOW_LOST: "processing was lost",
};

/** What a discovery run found: the owner's latest-run phrase (PRD §7). */
export function runResultCopy(run: IngestionRun): string {
  if (run.feedStatus === "unavailable") return "feed unavailable";
  if (run.discoveredCount === 0) return "nothing new";
  return `${run.discoveredCount} episode${run.discoveredCount === 1 ? "" : "s"} discovered`;
}

/** The open window's intent on an owner's episode row (PRD §7; docs/specs/m3-7-owner-ux.md §2). */
export function intentCopy(intent: ProcessingIntent): string {
  return intent === "publish"
    ? "publishing"
    : "replacing · current summary stays";
}

/** How long the latest attempt has been running: minutes under an hour, hours after (Retry waits for the hour). */
export function runningForCopy(startedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - startedAt);
  if (elapsed < HOUR)
    return `running for ${Math.max(1, Math.floor(elapsed / MINUTE))} min`;
  return `running for ${Math.floor(elapsed / HOUR)} h`;
}

/** "3 launched attempts": the diagnostic count beside the latest attempt's phrase; blocked starts never count. */
export function attemptCountCopy(count: number): string {
  return `${count} launched attempt${count === 1 ? "" : "s"}`;
}

/** A timed-out episode's `failureDetail` is the latest attempt's code; phrase it when it is one. */
export function failureDetailCopy(detail: string): string {
  return (OUTCOME_CODE_COPY as Record<string, string>)[detail] ?? detail;
}

/** The message a failed owner action shows on its row; YouTube not answering reads "Feed unavailable" (PRD §7). */
export function actionErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "UPSTREAM_UNAVAILABLE")
    return "Feed unavailable";
  return error instanceof Error ? error.message : String(error);
}

/** The phrase under an episode title when there is no summary to show; null for an available one. */
export function episodePhrase(episode: Episode): string | null {
  if (episode.status === "available") return null;
  if (episode.status === "pending" && episode.waitReason)
    return WAIT_REASON_COPY[episode.waitReason];
  const reason = episode.skipReason;
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

/**
 * What each screen the Design phase has not built yet says while its URL still works. Every one but
 * Chats is deleted by the step that builds the screen (docs/specs/design-phase-plan.md).
 */
export const UNBUILT_COPY = {
  queue: "What is waiting for you will be here, grouped by the day it arrived.",
  reading: "A summary reads here, in one column, with its timestamps.",
  history:
    "Everything you have been eligible for, by day, with a calendar to move through it.",
  sources:
    "The channels you follow, the catalog to browse, and the three steps that add one.",
  source:
    "One channel's episodes, newest published first, with the phrase on the ones without a summary.",
  chats:
    "Ask a question and get an answer from what your channels said, with the moments it came from. Built in M4.",
} as const;

/** The owner's line on Account when Curate cannot fit on this screen (docs/design.md §6). */
export function curateWaitingCopy(waiting: number | null): string {
  if (waiting === null || waiting === 0) {
    return "Curate needs a wider screen than this one.";
  }
  return `${waiting} ${waiting === 1 ? "thing needs" : "things need"} you in Curate, which needs a wider screen than this one.`;
}

/** The reading time of a summary, from its own length: the number a reader decides on. */
export function readingMinutes(summary: EpisodeSummary | null): number {
  if (summary === null) return 1;
  const words =
    summary.format === "raw_fallback"
      ? summary.rawText.split(/\s+/).length
      : summary.executiveSummary.split(/\s+/).length +
        summary.takeaways.reduce(
          (total, takeaway) => total + takeaway.text.split(/\s+/).length,
          0,
        );
  return Math.max(1, Math.round(words / 220));
}

/** `1 h 42 m` / `18 m`: an episode's runtime, as the transcript provider reported it. */
export function runtimeCopy(durationSec: number | null): string | null {
  if (durationSec === null || durationSec <= 0) return null;
  const minutes = Math.round(durationSec / 60);
  if (minutes < 60) return `${minutes} m`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

/** `h:mm:ss` or `m:ss` for a takeaway's moment, as it hangs in the reading column's margin. */
export function momentCopy(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(rest).padStart(2, "0")}`;
}

/**
 * The end of the queue, which says what is waiting rather than fading out (docs/specs/design-phase.md
 * §4.4). The History count is switched off with every other count.
 */
export function endOfQueueCopy(inHistory: number | null): string {
  if (inHistory === null || inHistory === 0) {
    return "That is everything waiting.";
  }
  return `That is everything waiting — ${inHistory} ${inHistory === 1 ? "summary sits" : "summaries sit"} in History.`;
}

export const QUEUE_EMPTY_TITLE = "You are through everything";
export const QUEUE_EMPTY_NOTE =
  "Nothing is waiting. What you have already read is in History, by the day it arrived.";
export const QUEUE_NO_FOLLOWS_NOTE =
  "Follow a channel and its summaries will land here as they are written.";
