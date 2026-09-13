import type {
  AttemptTrigger,
  EpisodeIngestionAttempt,
} from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import * as attempts from "./attempts";
import * as episodes from "./episodes";
import { relatedFromCandidates, upsertSummary } from "./summaries";
import {
  type AttemptOutcome,
  type AttemptResult,
  type AttemptStart,
  type BlockReason,
  DETERMINISTIC_SKIP_CODES,
  type EpisodeRecord,
  type EpisodeSummaryInput,
  type PublicationResult,
  type StagedGeneration,
  TECHNICAL_CODES,
  WAITING_CODES,
} from "./types";

/**
 * The attempt state machine (docs/PRD.md §4.2 rules 5–18, 24–26; docs/specs/m3-2-attempt-ledger.md
 * §3): how one execution moves the ledger and the episode's window together. Every write here is
 * gated by the attempt itself, never by channel state: an attempt is current while it is `running`
 * and its generation is the one the episode is staging. The universal recovery rule lives in one
 * place, `settleUnfinished`. Callers wrap each function in one Registry transaction.
 */

const TRIGGERS: ReadonlySet<string> = new Set([
  "channel_ingestion",
  "scheduled_recovery",
  "owner_retry",
]);
const BLOCK_REASONS: ReadonlySet<string> = new Set([
  "PROVIDER_AUTH",
  "PROVIDER_LIMIT",
]);
/** Codes that came from the transcript step, so the provider has answered about the video. */
const TRANSCRIPT_STEP_CODES: ReadonlySet<string> = new Set([
  ...WAITING_CODES.filter((code) => code !== "PROVIDER_LIMIT"),
  ...DETERMINISTIC_SKIP_CODES,
]);

/**
 * Starts an attempt: one running row with a fresh generation, and the launch counted on the
 * episode. Answers `running` instead of throwing when one is already running, so Retry can
 * reconcile it (rule 17). Requires an open window and never reads channel status or pause.
 */
export function beginAttempt(
  sql: SqlStorage,
  videoId: string,
  trigger: AttemptTrigger,
  requestedByEmail: string | null,
  now: number,
): AttemptStart {
  const episode = episodes.requireState(sql, videoId);
  const requester = requireRequester(trigger, requestedByEmail);
  const running = attempts.runningFor(sql, videoId);
  if (running) return { kind: "running", attempt: attempts.toAttempt(running) };
  if (episode.intent === null) {
    throw new DomainError(
      "INVALID_STATE",
      "no processing window is open for this episode",
    );
  }
  const abandoned = abandonedGeneration(sql, episode);
  const generationId = crypto.randomUUID();
  const row = attempts.insertRunning(sql, {
    attemptId: crypto.randomUUID(),
    videoId,
    trigger,
    intent: episode.intent,
    generationId,
    requestedByEmail: requester,
    now,
  });
  episodes.openStaged(sql, videoId, generationId, now);
  return {
    kind: "started",
    attempt: attempts.toAttempt(row),
    abandonedGeneration: abandoned,
  };
}

/** Records how many vectors the current attempt is about to write, before the first upsert (rule 24). */
export function markStaged(
  sql: SqlStorage,
  attemptId: string,
  chunkCount: number,
  now: number,
): EpisodeIngestionAttempt {
  const { attempt, episode } = requireCurrent(sql, attemptId);
  requireCount(chunkCount, "chunkCount");
  attempts.setStagedChunkCount(sql, attempt.attempt_id, chunkCount);
  episodes.markTranscriptChecked(sql, episode.videoId, now);
  return attempts.toAttempt(requireAttempt(sql, attemptId));
}

/**
 * Ends the current attempt without publishing. A deterministic result skips a publication and
 * leaves a replacement's content alone (rule 12); every other result keeps the window and
 * schedules the next attempt, or settles it at the deadline (rules 13–14).
 */
export function finishAttempt(
  sql: SqlStorage,
  attemptId: string,
  outcome: AttemptOutcome,
  now: number,
): AttemptResult {
  const { attempt, episode } = requireCurrent(sql, attemptId);
  const checked = requireOutcome(outcome);
  const row = attempts.finish(
    sql,
    attempt.attempt_id,
    checked.status,
    checked.code,
    checked.status === "failed" ? (checked.detail ?? null) : null,
    now,
  );
  if (TRANSCRIPT_STEP_CODES.has(checked.code)) {
    episodes.markTranscriptChecked(sql, episode.videoId, now);
  }
  if (checked.status === "skipped") {
    if (episode.intent === "publish") {
      episodes.markSkipped(sql, episode.videoId, checked.code, now);
    } else {
      episodes.closeWindow(sql, episode.videoId, now);
    }
  } else {
    settleUnfinished(sql, episode, checked.code, now);
  }
  return {
    attempt: attempts.toAttempt(row),
    episode: requireRecord(sql, episode.videoId),
  };
}

/**
 * A start pre-flight refused (rule 9): one finished `blocked` row, never a launch, never a count.
 * An automatic block moves the episode's next attempt, or settles the window at the deadline; an
 * owner's block leaves the episode exactly as it was.
 */
export function recordBlockedAttempt(
  sql: SqlStorage,
  videoId: string,
  trigger: AttemptTrigger,
  reason: BlockReason,
  requestedByEmail: string | null,
  now: number,
): AttemptResult {
  const episode = episodes.requireState(sql, videoId);
  const requester = requireRequester(trigger, requestedByEmail);
  if (!BLOCK_REASONS.has(reason)) {
    throw new DomainError(
      "INVALID_INPUT",
      "reason must be PROVIDER_AUTH or PROVIDER_LIMIT",
    );
  }
  if (attempts.runningFor(sql, videoId)) {
    throw new DomainError(
      "INVALID_STATE",
      "an attempt is running for this episode",
    );
  }
  const automatic = trigger !== "owner_retry";
  if (automatic && episode.intent === null) {
    throw new DomainError(
      "INVALID_STATE",
      "no processing window is open for this episode",
    );
  }
  const row = attempts.insertBlocked(sql, {
    attemptId: crypto.randomUUID(),
    videoId,
    trigger,
    intent:
      episode.intent ??
      (episode.status === "available" ? "replace" : "publish"),
    reason,
    requestedByEmail: requester,
    now,
  });
  if (automatic) settleUnfinished(sql, episode, reason, now);
  return {
    attempt: attempts.toAttempt(row),
    episode: requireRecord(sql, videoId),
  };
}

/**
 * Publication (rules 25–26), one transaction: the summary row, the episode's content columns, the
 * staged generation made active, the window closed, the attempt `available`. Returns the
 * generation that was active before so the instance can delete it.
 */
export function completeAttempt(
  sql: SqlStorage,
  attemptId: string,
  chunkCount: number,
  summary: EpisodeSummaryInput,
  relatedCandidates: readonly string[],
  now: number,
): PublicationResult {
  const { attempt, episode } = requireCurrent(sql, attemptId);
  requireCount(chunkCount, "chunkCount");
  if (!Array.isArray(relatedCandidates)) {
    throw new DomainError(
      "INVALID_INPUT",
      "relatedCandidates must be an array of video ids",
    );
  }
  const previous: StagedGeneration | null = episode.activeVectorGeneration
    ? {
        generationId: episode.activeVectorGeneration,
        chunkCount: episode.chunkCount ?? 0,
      }
    : null;
  const related = relatedFromCandidates(
    sql,
    episode.videoId,
    relatedCandidates,
  );
  upsertSummary(sql, episode.videoId, summary, related, now);
  episodes.publish(sql, episode.videoId, chunkCount, now);
  const row = attempts.finish(
    sql,
    attempt.attempt_id,
    "available",
    null,
    null,
    now,
  );
  return {
    attempt: attempts.toAttempt(row),
    episode: requireRecord(sql, episode.videoId),
    previousGeneration: previous,
  };
}

/**
 * The universal recovery rule (rules 13–14), the one implementation: before the deadline the
 * episode is due six hours later, capped at the deadline; at or after it, a publication fails
 * `INGESTION_TIMEOUT` with the reason as detail and a replacement closes its window with the
 * current content untouched.
 */
export function settleUnfinished(
  sql: SqlStorage,
  episode: episodes.EpisodeState,
  code: string,
  now: number,
): void {
  if (episode.intent === null || episode.windowDeadlineAt === null) {
    throw new DomainError(
      "INVALID_STATE",
      "no processing window is open for this episode",
    );
  }
  if (now >= episode.windowDeadlineAt) {
    if (episode.intent === "publish") {
      episodes.markTimedOut(sql, episode.videoId, code, now);
    } else {
      episodes.closeWindow(sql, episode.videoId, now);
    }
    return;
  }
  episodes.scheduleNextAttempt(
    sql,
    episode.videoId,
    Math.min(now + episodes.RETRY_INTERVAL_MS, episode.windowDeadlineAt),
    now,
  );
}

/** A non-empty attempt id; the ids are UUIDs the Registry minted, so no other shape is expected. */
export function requireAttemptId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 128
  ) {
    throw new DomainError("INVALID_INPUT", "attemptId is required");
  }
  return value;
}

export function requireTrigger(value: unknown): AttemptTrigger {
  if (typeof value !== "string" || !TRIGGERS.has(value)) {
    throw new DomainError(
      "INVALID_INPUT",
      "trigger must be channel_ingestion, scheduled_recovery, or owner_retry",
    );
  }
  return value as AttemptTrigger;
}

/**
 * The attempt gate (parent spec §2 "Attempt gate"): running, and staging the generation the episode
 * names. A stale instance, reconciled or superseded, cannot write.
 */
function requireCurrent(
  sql: SqlStorage,
  attemptId: string,
): { attempt: attempts.AttemptRow; episode: episodes.EpisodeState } {
  const attempt = requireAttempt(sql, attemptId);
  if (attempt.status !== "running") {
    throw new DomainError(
      "INVALID_STATE",
      `attempt is not running (status: ${attempt.status})`,
    );
  }
  const episode = episodes.requireState(sql, attempt.video_id);
  if (
    attempt.generation_id === null ||
    episode.stagedVectorGeneration !== attempt.generation_id
  ) {
    throw new DomainError(
      "INVALID_STATE",
      "attempt is not the episode's current attempt",
    );
  }
  return { attempt, episode };
}

function requireAttempt(
  sql: SqlStorage,
  attemptId: string,
): attempts.AttemptRow {
  const row = attempts.getAttempt(sql, attemptId);
  if (!row) throw new DomainError("NOT_FOUND", "attempt not found");
  return row;
}

/**
 * The previous attempt's staged generation when it never became active: recorded chunk count and
 * all, so the next attempt can delete it before staging its own (rule 26). A `blocked` row minted
 * nothing, so the newest attempt with a generation is the one that matters.
 */
function abandonedGeneration(
  sql: SqlStorage,
  episode: episodes.EpisodeState,
): StagedGeneration | null {
  const previous = attempts.latestWithGeneration(sql, episode.videoId);
  if (
    !previous ||
    previous.generation_id === null ||
    previous.staged_chunk_count === null ||
    previous.status === "available" ||
    previous.generation_id === episode.activeVectorGeneration
  ) {
    return null;
  }
  return {
    generationId: previous.generation_id,
    chunkCount: previous.staged_chunk_count,
  };
}

/** Owner Retry names who asked; the automatic triggers name nobody (the ledger's CHECK). */
function requireRequester(
  trigger: AttemptTrigger,
  requestedByEmail: string | null,
): string | null {
  requireTrigger(trigger);
  if (trigger === "owner_retry") {
    if (!requestedByEmail) {
      throw new DomainError(
        "INVALID_INPUT",
        "owner_retry needs requestedByEmail",
      );
    }
    return requestedByEmail;
  }
  return null;
}

function requireOutcome(outcome: unknown): AttemptOutcome {
  const value =
    typeof outcome === "object" && outcome !== null
      ? (outcome as Record<string, unknown>)
      : null;
  const status = value?.status;
  const code = value?.code;
  if (typeof code !== "string") {
    throw new DomainError("INVALID_INPUT", "outcome.code is required");
  }
  if (
    status === "waiting" &&
    (WAITING_CODES as readonly string[]).includes(code)
  ) {
    return { status, code: code as AttemptOutcome["code"] } as AttemptOutcome;
  }
  if (
    status === "skipped" &&
    (DETERMINISTIC_SKIP_CODES as readonly string[]).includes(code)
  ) {
    return { status, code: code as AttemptOutcome["code"] } as AttemptOutcome;
  }
  if (
    status === "failed" &&
    (TECHNICAL_CODES as readonly string[]).includes(code)
  ) {
    const detail = value?.detail;
    if (detail !== undefined && typeof detail !== "string") {
      throw new DomainError("INVALID_INPUT", "outcome.detail must be a string");
    }
    return {
      status,
      code: code as AttemptOutcome["code"],
      ...(detail === undefined ? {} : { detail }),
    } as AttemptOutcome;
  }
  throw new DomainError(
    "INVALID_INPUT",
    `outcome ${String(status)} ${code} is not a waiting, failed, or skipped result`,
  );
}

function requireCount(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${name} must be a positive integer`,
    );
  }
  return value;
}

function requireRecord(sql: SqlStorage, videoId: string): EpisodeRecord {
  const record = episodes.listByVideoIds(sql, [videoId])[0];
  if (!record)
    throw new Error(`episode ${videoId} vanished inside its own transaction`);
  return record;
}
