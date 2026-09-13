import {
  type AttemptOutcomeCode,
  AttemptOutcomeCodeSchema,
  type AttemptStatus,
  type AttemptTrigger,
  type EpisodeIngestionAttempt,
  type ProcessingIntent,
} from "@media-digest/shared";
import { chunk, placeholders } from "../../lib/sql";

/**
 * The episode attempt ledger (docs/PRD.md §4.2 rules 6–9): one row per execution, first processing,
 * scheduled recovery, or owner Retry, plus one finished `blocked` row per start that pre-flight
 * refused. The latest attempt is where an episode's reason lives, and a running one is what Retry
 * refuses. Row-level reads and writes only; the state machine that composes them with the episode
 * row is `processing.ts`.
 */

export type AttemptRow = {
  attempt_id: string;
  video_id: string;
  trigger: string;
  intent: string;
  generation_id: string | null;
  staged_chunk_count: number | null;
  workflow_id: string | null;
  requested_by_email: string | null;
  status: string;
  outcome_code: string | null;
  failure_detail: string | null;
  started_at: number;
  finished_at: number | null;
};

const ATTEMPT_COLUMNS = `attempt_id, video_id, trigger, intent, generation_id, staged_chunk_count, workflow_id,
  requested_by_email, status, outcome_code, failure_detail, started_at, finished_at`;

/** The latest attempt per episode (newest created_at, then attempt_id). Episodes with none are absent. */
export function latestByVideo(
  sql: SqlStorage,
  videoIds: readonly string[],
): Record<string, EpisodeIngestionAttempt> {
  const latest: Record<string, EpisodeIngestionAttempt> = {};
  for (const batch of chunk(videoIds)) {
    for (const row of sql.exec<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM (
         SELECT ${ATTEMPT_COLUMNS},
           ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY created_at DESC, attempt_id DESC) AS rn
         FROM episode_ingestion_attempts
         WHERE video_id IN (${placeholders(batch.length)})
       ) WHERE rn = 1`,
      ...batch,
    )) {
      latest[row.video_id] = toAttempt(row);
    }
  }
  return latest;
}

/** Whether the episode has an attempt still running; Retry is refused while one does. */
export function hasRunning(sql: SqlStorage, videoId: string): boolean {
  return runningFor(sql, videoId) !== null;
}

/** The episode's running attempt, if any (there is at most one: `beginAttempt` refuses a second). */
export function runningFor(
  sql: SqlStorage,
  videoId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
         WHERE video_id = ? AND status = 'running'
         ORDER BY created_at DESC, attempt_id DESC LIMIT 1`,
        videoId,
      )
      .toArray()[0] ?? null
  );
}

export function getAttempt(
  sql: SqlStorage,
  attemptId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts WHERE attempt_id = ?`,
        attemptId,
      )
      .toArray()[0] ?? null
  );
}

/** The episode's newest attempt that minted a generation (a `blocked` row never does). */
export function latestWithGeneration(
  sql: SqlStorage,
  videoId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
         WHERE video_id = ? AND generation_id IS NOT NULL
         ORDER BY created_at DESC, attempt_id DESC LIMIT 1`,
        videoId,
      )
      .toArray()[0] ?? null
  );
}

/** The episode's newest attempt that minted a generation other than the one named: what a running attempt may find abandoned. */
export function previousWithGeneration(
  sql: SqlStorage,
  videoId: string,
  excludingAttemptId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
         WHERE video_id = ? AND generation_id IS NOT NULL AND attempt_id <> ?
         ORDER BY created_at DESC, attempt_id DESC LIMIT 1`,
        videoId,
        excludingAttemptId,
      )
      .toArray()[0] ?? null
  );
}

export type RunningInsert = {
  attemptId: string;
  videoId: string;
  trigger: AttemptTrigger;
  intent: ProcessingIntent;
  generationId: string;
  requestedByEmail: string | null;
  now: number;
};

/** A running attempt: its Workflow instance id is its own id (docs/specs/m3-ingestion.md §3). */
export function insertRunning(
  sql: SqlStorage,
  input: RunningInsert,
): AttemptRow {
  sql.exec(
    `INSERT INTO episode_ingestion_attempts
       (attempt_id, video_id, trigger, intent, generation_id, staged_chunk_count, workflow_id,
        requested_by_email, status, outcome_code, failure_detail, started_at, finished_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'running', NULL, NULL, ?, NULL, ?)`,
    input.attemptId,
    input.videoId,
    input.trigger,
    input.intent,
    input.generationId,
    input.attemptId,
    input.requestedByEmail,
    input.now,
    input.now,
  );
  return requireRow(sql, input.attemptId);
}

export type BlockedInsert = {
  attemptId: string;
  videoId: string;
  trigger: AttemptTrigger;
  intent: ProcessingIntent;
  reason: "PROVIDER_AUTH" | "PROVIDER_LIMIT";
  requestedByEmail: string | null;
  now: number;
};

/** A start pre-flight refused: finished at once, no instance, no generation (docs/PRD.md §4.2 rule 9). */
export function insertBlocked(
  sql: SqlStorage,
  input: BlockedInsert,
): AttemptRow {
  sql.exec(
    `INSERT INTO episode_ingestion_attempts
       (attempt_id, video_id, trigger, intent, generation_id, staged_chunk_count, workflow_id,
        requested_by_email, status, outcome_code, failure_detail, started_at, finished_at, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 'blocked', ?, NULL, ?, ?, ?)`,
    input.attemptId,
    input.videoId,
    input.trigger,
    input.intent,
    input.requestedByEmail,
    input.reason,
    input.now,
    input.now,
    input.now,
  );
  return requireRow(sql, input.attemptId);
}

/** Recorded when embedding begins, so the next attempt can delete an abandoned generation. */
export function setStagedChunkCount(
  sql: SqlStorage,
  attemptId: string,
  chunkCount: number,
): void {
  sql.exec(
    "UPDATE episode_ingestion_attempts SET staged_chunk_count = ? WHERE attempt_id = ?",
    chunkCount,
    attemptId,
  );
}

/** Ends a running attempt with its status, reason, and detail. */
export function finish(
  sql: SqlStorage,
  attemptId: string,
  status: Exclude<AttemptStatus, "running" | "blocked">,
  outcomeCode: AttemptOutcomeCode | null,
  failureDetail: string | null,
  now: number,
): AttemptRow {
  sql.exec(
    `UPDATE episode_ingestion_attempts
       SET status = ?, outcome_code = ?, failure_detail = ?, finished_at = ?
     WHERE attempt_id = ?`,
    status,
    outcomeCode,
    failureDetail,
    now,
    attemptId,
  );
  return requireRow(sql, attemptId);
}

function requireRow(sql: SqlStorage, attemptId: string): AttemptRow {
  const row = getAttempt(sql, attemptId);
  if (!row)
    throw new Error(`attempt ${attemptId} vanished inside its own transaction`);
  return row;
}

export function toAttempt(row: AttemptRow): EpisodeIngestionAttempt {
  return {
    attemptId: row.attempt_id,
    videoId: row.video_id,
    trigger: toTrigger(row.trigger),
    requestedByEmail: row.requested_by_email,
    intent: toIntent(row.intent),
    status: toStatus(row.status),
    outcomeCode: toOutcomeCode(row.outcome_code),
    failureDetail: row.failure_detail,
    workflowId: row.workflow_id,
    stagedChunkCount: row.staged_chunk_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function toTrigger(value: string): AttemptTrigger {
  switch (value) {
    case "channel_ingestion":
    case "scheduled_recovery":
    case "owner_retry":
      return value;
    default:
      throw new Error(
        `unexpected episode_ingestion_attempts.trigger: ${value}`,
      );
  }
}

export function toIntent(value: string): ProcessingIntent {
  if (value === "publish" || value === "replace") return value;
  throw new Error(`unexpected episode_ingestion_attempts.intent: ${value}`);
}

function toStatus(value: string): AttemptStatus {
  switch (value) {
    case "running":
    case "available":
    case "waiting":
    case "failed":
    case "skipped":
    case "blocked":
      return value;
    default:
      throw new Error(`unexpected episode_ingestion_attempts.status: ${value}`);
  }
}

const OUTCOME_CODES: ReadonlySet<string> = new Set(
  AttemptOutcomeCodeSchema.options,
);

/** The column has no CHECK until the end of M3, so the contract's enum is applied on read. */
function toOutcomeCode(value: string | null): AttemptOutcomeCode | null {
  if (value === null) return null;
  if (OUTCOME_CODES.has(value)) return value as AttemptOutcomeCode;
  throw new Error(
    `unexpected episode_ingestion_attempts.outcome_code: ${value}`,
  );
}
