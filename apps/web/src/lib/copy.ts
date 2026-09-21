// The user-facing phrases from docs/specs/channel-simplification.md §4 and §7, in one place so
// screens never invent their own wording.

import type {
  AttemptOutcomeCode,
  Channel,
  ChannelDeclinedResponse,
  ChannelFeed,
  ChannelStatus,
  Episode,
  EpisodeCounts,
  EpisodeIngestionAttempt,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeWaitReason,
  IngestionRun,
  ProcessingIntent,
} from "@media-digest/shared";
import { ApiError } from "../api";
import type { ReadingOrigin } from "./reading-origin";
import type { ReadingFont, ReadingSize, ReadingTheme } from "./settings";
import { absoluteTime, HOUR, MINUTE, relativeTime } from "./time";

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

/**
 * A channel's state **where it is worth saying**, for a page that is already about this one channel:
 * silence means approved and running, which is the case a reader is looking at almost every time and
 * which the page's own existence already implies (owner decision 2026-09-15, docs/PRD.md §9). The
 * exceptions still speak, because those are what a reader cannot infer — awaiting approval, paused,
 * declined, withdrawn.
 *
 * A *list* of channels is a different matter and keeps `channelStateCopy`: there the word tells one
 * row from the next.
 */
export function channelExceptionCopy(channel: Channel): string | null {
  if (channel.status === "declined")
    return channel.approvedAt === null ? "Declined" : "Withdrawn";
  if (channel.status === "requested") return CHANNEL_STATUS_COPY.requested;
  return channel.paused ? "Paused" : null;
}

/** What a channel holds: everything discovered, and how much of it can actually be read. */
export function episodeCountCopy(counts: EpisodeCounts): string {
  const total =
    counts.available + counts.pending + counts.failed + counts.skipped;
  return `${total} ${total === 1 ? "episode" : "episodes"}`;
}

export function summaryCountCopy(counts: EpisodeCounts): string {
  const n = counts.available;
  // "Nothing yet" rather than "0 summaries": an approved channel that has published nothing is
  // listed on purpose (docs/specs/public-reading.md §3, decision 3), and a zero there reads as a
  // failure where it is only an absence.
  if (n === 0) return "Nothing yet";
  return `${n} ${n === 1 ? "summary" : "summaries"}`;
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

/**
 * What a row says while an attempt is running, which outranks every settled status above: those
 * describe what the episode last came to rest as, and this describes what is happening to it now
 * (docs/design.md §4 — the in-progress state every screen owes). An episode with a summary is being
 * *re*-processed, and saying so is the difference between a table that looks stuck and one that is
 * visibly working.
 */
export function inProgressCopy(status: EpisodeStatus): string {
  return status === "available" ? "Re-processing" : "Summarising";
}

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

/**
 * A summary that fell back to raw text: the model's JSON never parsed, so a reader is looking at
 * whatever it said rather than an executive summary and takeaways. The one summary fact that
 * changes what a reader sees and what the owner might do about it, so it is promoted out of the
 * diagnostics and onto the episode's state (owner decision 2026-09-15, docs/PRD.md §9).
 */
export const RAW_SUMMARY_COPY = "unformatted";

/** What Retry does to an episode that is already fine: nothing, unless it does it better. */
export const RETRY_AVAILABLE_HINT =
  "Replace this summary. The current one stays readable until a replacement succeeds, and it costs one transcript credit.";

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

/** The way back from a screen that carries its own bar; the browser knows where, so it says no more. */
/** What Curate says when nothing is outstanding, once, in place of three headings and three zeroes. */
export const NEEDS_YOU_CLEAR_COPY = "Nothing needs your attention.";

/**
 * The mark on a catalog row that is also in Needs you. It says only *that* the row is work; why is
 * already in the row's own columns, so nothing is stated twice.
 */
export const NEEDS_YOU_MARK_COPY = "Needs you";

/** An approved channel whose feed has never been read: a dash read as missing data, not as a fault. */
export const NEVER_STARTED_COPY = "never started";

export const BACK_COPY = "Back";

/** The way through from a channel to the screen where its decisions are made. */
export const CURATE_LINK_COPY = "Open in Curate";

/**
 * The way out to the thing itself, named by **what it is in this product** rather than by the verb
 * the destination uses (owner decision 2026-09-15, docs/PRD.md §9). "Watch" was YouTube's word for
 * a screen whose whole argument is that the reader does not have to; "On YouTube" named the
 * destination where the product has a noun for the thing. Both links do the same job from the same
 * place in the same bar, so they are named the same way. Where they go is the external-link glyph's
 * job, and the tooltip's.
 */
/** The two things a scope chip's presence changes, said in words (docs/specs/m4-3-chat-web.md §3.4). */
export const SCOPE_ON_COPY = "Searches this episode only.";
export const SCOPE_OFF_COPY = "Searches every channel you follow.";
export const ASK_PLACEHOLDER_COPY = "Ask another question…";

/**
 * What the source cards under a reply are (docs/specs/chat-relevance-rerank.md §4.6). **"Based on",
 * not "Sources":** the cards are the excerpts the answer was written from, and the model chooses
 * which of them to lean on — a label claiming each one was used would be a claim nothing verifies.
 */
export const SOURCES_LABEL = "Based on";

/** A cut-off answer is kept and trimmed, never failed (docs/PRD.md §9, 2026-09-16). */
export const ANSWER_SHORTENED_COPY = "Answer shortened.";
export const TRY_AGAIN_COPY = "Try again";

/** The scope a question was sent under, or nothing at all when it was global. */
export function chatScopeCopy(
  aboutEpisodeId: string | null,
  episodeTitle: string | null,
): string | null {
  if (aboutEpisodeId === null) return null;
  return episodeTitle === null
    ? "Asked about one episode"
    : `Asked about ${episodeTitle}`;
}

/**
 * Why a reply is not there. The reader is told what happened in their terms, never the code: the
 * codes are `EMBEDDING_FAILED`, `RETRIEVAL_FAILED`, `MODEL_FAILED` and `ANSWER_TIMEOUT`, and the
 * first three are the same event to a reader — the answer did not come back.
 */
export function chatFailureCopy(failureCode: string | null): string {
  return failureCode === "ANSWER_TIMEOUT"
    ? "This answer took too long and was given up on."
    : "This answer could not be produced.";
}

/** Chats are started from a summary, so the empty state points there rather than at a button. */
export const CHATS_EMPTY_COPY =
  "Chats begin on a summary. Open something from your queue and ask about it.";

/** Where a chat began, or that it never had a scope (docs/specs/m4-3-chat-web.md §3.1). */
export function chatOriginCopy(episodeTitle: string | null): string {
  return episodeTitle === null
    ? "Across everything you follow"
    : `Began at ${episodeTitle}`;
}

/** The only way into a chat: a chat begins at a summary and nowhere else (docs/PRD.md §9). */
export const ASK_COPY = "Ask";
export const ASK_HINT_COPY = "Ask a question about this episode";

export const EXTERNAL_EPISODE_COPY = "Episode";
export const EXTERNAL_CHANNEL_COPY = "Channel";
export const EXTERNAL_HINT_COPY = "Opens on YouTube";

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
 * What the owner's channel actions are called, in one place so the same act has one name wherever
 * it is offered — as a glyph in a dense group, as a word in a list with room (owner decision
 * 2026-09-15, docs/PRD.md §9).
 *
 * Two of these were renamed because they did not say what they did. "Start" never said what starts;
 * it checks the feed. And "Withdraw" sat a few pixels from "Unfollow" and reads as the same act to
 * anyone moving quickly — naming what is withdrawn, the approval, separates them, and is true: a
 * withdrawal is the owner's decision about the catalog, an unfollow is one reader's own.
 */
export const CHANNEL_ACTION_COPY = {
  approve: "Approve",
  checkFeed: "Check feed",
  /** The glyph's accessible name and tooltip: it has room to say what the word cannot. */
  checkFeedHint: "Check the feed now, paused or not",
  pause: "Pause ingestion",
  resume: "Resume ingestion",
  decline: "Decline",
  withdraw: "Withdraw approval",
} as const;

/**
 * A reader's own act on a channel, named with the channel: the control is a glyph, so this is what
 * assistive technology and a resting pointer are told, and a list of twenty-five must not answer
 * "Follow" twenty-five times.
 */
export const FOLLOW_COPY = { follow: "Follow", unfollow: "Unfollow" } as const;

export function followActionCopy(following: boolean, title: string): string {
  return `${following ? FOLLOW_COPY.unfollow : FOLLOW_COPY.follow} ${title}`;
}

/** How many readers a catalog decision reaches, beside the controls rather than only in the dialog. */
export function followerCountCopy(count: number): string {
  if (count === 0) return "No followers";
  return `${count} ${count === 1 ? "follower" : "followers"}`;
}

/** The owner's line on Account when Curate cannot fit on this screen (docs/design.md §6). */
export function curateWaitingCopy(waiting: number | null): string {
  if (waiting === null || waiting === 0) {
    return "Curate needs a wider screen than this one.";
  }
  return `${waiting} ${waiting === 1 ? "thing needs" : "things need"} you in Curate, which needs a wider screen than this one.`;
}

// There is no reading-time estimate. The takeaway budget (docs/PRD.md §4.4) bounds a summary at
// about 220 to 540 words, so the number could only ever say one, two or three minutes, and said two
// on nearly every row — a constant with a unit, and the one guess on a line of measured facts
// (owner decision 2026-09-15, docs/PRD.md §9). The takeaway count answers how much is in here.

/**
 * The reading column's sections, each named above its own rule. The lede is the opening and carries
 * no heading; everything after it does, because a reader should not have to infer that three
 * flowing sentences have become a timestamped list, or that a row of words is a set of topics
 * (owner decision 2026-09-15, docs/PRD.md §9). "Takeaways" is the word the queue row already used.
 */
export const TAKEAWAYS_HEADING = "Takeaways";
export const TOPICS_HEADING = "Topics";
export const RELATED_HEADING = "Related";

/**
 * How the reader's type, size and theme are labelled, wherever they are offered — the reading
 * column's `Aa` and Account both. One set of words, so the same control cannot be named two ways.
 */
export const FONT_LABELS: Record<ReadingFont, string> = {
  serif: "Serif",
  sans: "Sans",
};

export const SIZE_LABELS: Record<ReadingSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export const THEME_LABELS: Record<ReadingTheme, string> = {
  light: "Light",
  sepia: "Sepia",
  dark: "Dark",
};

export const READING_PANEL_TITLE = "Type, size and theme";

/**
 * The phone sheet's closing button. Not "Done", which on this screen is the receipt and takes the
 * reader out of the article — two buttons an inch apart, one of them irreversible from here. Not
 * "Cancel" either: the choices have already applied, so there is nothing to abandon, only somewhere
 * to go back to.
 */
export const READING_PANEL_CLOSE = "Back to reading";

/** `1 h 42 m` / `18 m`: an episode's runtime, as the transcript provider reported it. */
export function runtimeCopy(durationSec: number | null): string | null {
  if (durationSec === null || durationSec <= 0) return null;
  const minutes = Math.round(durationSec / 60);
  if (minutes < 60) return `${minutes} m`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
}

/**
 * Where the reading column's arrow goes, said in words rather than left to a guess. A summary has
 * one URL and three ways in, so the arrow names the list the reader actually came from; with no
 * origin — a cold deep link, a pasted URL — the queue is the reader's home and is never wrong.
 */
export function backToCopy(origin: ReadingOrigin | null): string {
  if (origin === null || origin.kind === "queue") return "Back to the queue";
  if (origin.kind === "history") return "Back to History";
  return origin.label === null
    ? "Back to the channel"
    : `Back to ${origin.label}`;
}

/** Whether a summary has been dealt with, in the same word the row it came from used. */
export function readStateCopy(read: boolean): string {
  return read ? "Read" : "Unread";
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
 * §4.4). **It counts what is here**, not what is elsewhere: the line used to end "— 5 summaries sit
 * in History", where 5 was every summary the reader is eligible for, the four above it included.
 * Read quickly that is five *more*, somewhere else, which is the opposite of true (owner decision
 * 2026-09-15, docs/PRD.md §9). Counts are switched off with every other count.
 */
export function endOfQueueCopy(waiting: number | null): string {
  if (waiting === null) return "That is everything waiting.";
  return waiting === 1
    ? "That is the one summary waiting."
    : `That is all ${waiting} unread summaries.`;
}

/**
 * The way on from the end of the queue. History holds these *and* everything already read, so its
 * number is named only when it is actually larger — otherwise the two lists are the same set and a
 * second number would invite the same misreading in reverse.
 */
export function browseHistoryCopy(
  inHistory: number | null,
  waiting: number,
): string {
  if (inHistory === null || inHistory <= waiting) return "Browse History";
  return `Browse all ${inHistory} in History`;
}

export const QUEUE_EMPTY_TITLE = "You are through everything";
export const QUEUE_EMPTY_NOTE =
  "Nothing is waiting. What you have already read is in History, by the day it arrived.";
export const QUEUE_NO_FOLLOWS_NOTE =
  "Follow a channel and its summaries will land here as they are written.";

export const HISTORY_EMPTY_NOTE =
  "Nothing has arrived yet for the channels you follow. What does will be here, by the day it arrived.";
export const HISTORY_DAY_EMPTY_NOTE = "Nothing arrived on this day.";
export const HISTORY_NOT_A_DAY_NOTE =
  "That is not a date this product recognises. A day looks like 2026-09-12.";

/** What a day's contents depend on — worth saying once, where a reader can be surprised by it. */
export const HISTORY_SCOPE_NOTE =
  "A day shows the channels you follow now, so following or unfollowing one changes what a past day holds. Your receipts are kept either way.";

/** What a feed reading means for a reader deciding whether to follow (docs/specs/design-phase.md §4.6). */
export function feedVerdict(feed: ChannelFeed): string {
  if (feed.entryCount === 0) {
    return "Its feed carried no uploads at all. It may be new, or it may have stopped.";
  }
  if (feed.longFormCount === 0) {
    return `None of its newest ${feed.entryCount} uploads are long-form, so nothing here would be summarised. Only long-form uploads become episodes — Shorts and live streams do not.`;
  }
  return `${feed.longFormCount} of its newest ${feed.entryCount} uploads are long-form, and those are the ones that become episodes.`;
}

/** When the newest long-form upload landed, or that there is none. */
export function newestUploadCopy(at: number | null): string {
  if (at === null) return "No long-form upload to date.";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "Newest long-form upload: today.";
  if (days === 1) return "Newest long-form upload: yesterday.";
  if (days < 60) return `Newest long-form upload: ${days} days ago.`;
  return `Newest long-form upload: ${Math.floor(days / 30)} months ago.`;
}

export const SOURCES_TABS = {
  following: "Following",
  catalog: "Catalog",
  declined: "Declined",
} as const;

export const SOURCE_SORTS = {
  unread: "Most unread",
  active: "Recently active",
  name: "Name",
  followed: "Longest followed",
} as const;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Whether an attempt is holding this episode, and what the row should say about it.
 *
 * **Rewritten 2026-09-17** after the owner read the old line on a live Retry. It said
 * "<their own email> started this; Retry is available in 60 min", and all three parts were wrong.
 * The email named the reader to themselves — Curate is the owner's screen, so an owner-triggered
 * attempt was started by whoever is reading the line. The hour was `RECONCILE_AFTER_MS`, the point
 * at which Retry force-takes-over an instance the engine appears to have lost (docs/PRD.md §4.2
 * rule 17) — a crash valve, not an estimate. A normal attempt finishes in two or three minutes and
 * frees Retry then, so the line counted down to the wrong event and overstated it twentyfold. And it
 * was computed once at render on a screen that never refetches, so it did not even count down.
 *
 * What a row owes instead is elapsed time, which cannot be wrong, and the takeover only once it is
 * genuinely available. Where an attempt is running now lives in the status column, not in a footnote
 * beside a disabled button (docs/design.md §4).
 */
export function attemptHoldCopy(
  attempt: EpisodeIngestionAttempt | null,
  now = Date.now(),
): string | null {
  if (attempt === null || attempt.status !== "running") return null;
  return now - attempt.startedAt >= HOUR_MS
    ? "Running over an hour — Retry will take it over."
    : null;
}

/** Whether an attempt is running, which is what makes Retry unavailable and the row in progress. */
export function isRunning(attempt: EpisodeIngestionAttempt | null): boolean {
  return attempt?.status === "running";
}

/** The decline confirmation names who loses what, not "are you sure" (docs/design.md §4). */
export function declineQuestion(channel: Channel): string {
  if (channel.status !== "approved") {
    return `Decline ${channel.title}? It will be hidden from the catalog and can be approved or requested again at any time.`;
  }
  const count = channel.followerCount;
  if (count === 0) {
    return `Withdraw ${channel.title}? Nobody follows it, so nobody loses anything; its episodes and summaries are kept, and approving it again brings them back.`;
  }
  return `Withdraw ${channel.title}? ${count} ${count === 1 ? "follower" : "followers"} will stop seeing its summaries — in their queue, in their history, and in what chat can answer from — until it is approved again. Nothing is deleted: their read receipts and its episodes are kept, and approving it again restores all of it.`;
}

/** When a screen is showing numbers it could not refresh (docs/design.md §3, the stale state). */
export function staleCopy(loadedAt: number | null, now = Date.now()): string {
  if (loadedAt === null) return "These numbers could not be refreshed.";
  const minutes = Math.max(1, Math.round((now - loadedAt) / 60_000));
  return `These numbers could not be refreshed. They are from ${minutes} min ago.`;
}

/**
 * The signed-out surface (docs/specs/public-reading.md §4.1, §4.2). The band's line is the whole
 * pitch on every page but the landing one, so it names the three things an account adds rather
 * than saying "sign in" twice.
 */
export const PUBLIC_BAND_COPY =
  "Follow channels · keep a queue · ask about any episode";
export const PUBLIC_BAND_COPY_SHORT = "Follow · queue · ask";
export const PUBLIC_SIGN_IN_COPY = "Sign in";

/** The one name for narrowing a channel list — placeholder and accessible name both. */
export const FIND_CHANNEL_COPY = "Find a channel";
export const NO_CHANNEL_BY_THAT_NAME = "No channel by that name.";

/**
 * The two counts a channel row carries that had no phrase of their own yet. `followerCountCopy`
 * already exists above, and says "No followers" at zero, which a row does not render at all.
 */
export const unreadCountCopy = (n: number): string => `${n} unread`;
export const lastSummaryCopy = (at: number): string =>
  `last summary ${relativeTime(at)}`;

export const LANDING_PROMISE =
  "What was said on the air, in text, with the minute it was said.";
export const LANDING_CHANNELS_HEADING = "Channels";
export const LANDING_EMPTY_COPY =
  "No channels yet. The catalog is where they will appear.";
