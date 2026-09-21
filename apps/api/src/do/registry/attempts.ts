import {
  type AttemptOutcomeCode,
  AttemptOutcomeCodeSchema,
  type AttemptStatus,
  type AttemptTrigger,
  type EpisodeIngestionAttempt,
  type ProcessingIntent,
} from "@media-digest/shared";
import { chunk, placeholders } from "../../lib/sql";
import * as users from "./users";

/**
 * The episode attempt ledger (docs/PRD.md §4.2 rules 6–9): one row per execution, first processing,
 * scheduled recovery, or owner Retry, plus one finished `blocked` row per start that pre-flight
 * refused. The latest attempt is where an episode's reason lives, and a running one is what Retry
 * refuses. Row-level reads and writes only; the state machine that composes them with the episode
 * row is `processing.ts`.
 */

export type AttemptRow = {
  attempt_id: string;
  episode_id: string;
  trigger: string;
  intent: string;
  generation_id: string | null;
  staged_chunk_count: number | null;
  workflow_id: string | null;
  requested_by_user_id: string | null;
  status: string;
  outcome_code: string | null;
  failure_detail: string | null;
  started_at: number;
  finished_at: number | null;
};

const ATTEMPT_COLUMNS = `attempt_id, episode_id, trigger, intent, generation_id, staged_chunk_count, workflow_id,
  requested_by_user_id, status, outcome_code, failure_detail, started_at, finished_at`;

/** The latest attempt per episode (newest created_at, then attempt_id). Episodes with none are absent. */
export function latestByEpisode(
  sql: SqlStorage,
  episodeIds: readonly string[],
): Record<string, EpisodeIngestionAttempt> {
  const latest: Record<string, EpisodeIngestionAttempt> = {};
  const rows: AttemptRow[] = [];
  for (const batch of chunk(episodeIds)) {
    for (const row of sql.exec<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM (
         SELECT ${ATTEMPT_COLUMNS},
           ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY created_at DESC, attempt_id DESC) AS rn
         FROM episode_ingestion_attempts
         WHERE episode_id IN (${placeholders(batch.length)})
       ) WHERE rn = 1`,
      ...batch,
    )) {
      rows.push(row);
    }
  }
  const resolved = users.emailsByIds(
    sql,
    rows
      .map((row) => row.requested_by_user_id)
      .filter((id): id is string => id !== null),
  );
  for (const row of rows)
    latest[row.episode_id] = toAttempt(sql, row, resolved);
  return latest;
}

/** One requester's address: from a precomputed map when a list built one, else a single lookup. */
function requesterEmail(
  sql: SqlStorage,
  userId: string | null,
  resolved?: Record<string, string>,
): string | null {
  if (userId === null) return null;
  if (resolved) return resolved[userId] ?? null;
  return users.emailsByIds(sql, [userId])[userId] ?? null;
}

/** Whether the episode has an attempt still running; Retry is refused while one does. */
export function hasRunning(sql: SqlStorage, episodeId: string): boolean {
  return runningFor(sql, episodeId) !== null;
}

/** The episode's running attempt, if any (there is at most one: `beginAttempt` refuses a second). */
export function runningFor(
  sql: SqlStorage,
  episodeId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
         WHERE episode_id = ? AND status = 'running'
         ORDER BY created_at DESC, attempt_id DESC LIMIT 1`,
        episodeId,
      )
      .toArray()[0] ?? null
  );
}

/** Running attempts that started before `cutoff`, oldest first: reconciliation's candidates (rule 15). */
export function listRunningStartedBefore(
  sql: SqlStorage,
  cutoff: number,
): AttemptRow[] {
  return sql
    .exec<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
       WHERE status = 'running' AND started_at < ?
       ORDER BY started_at, attempt_id`,
      cutoff,
    )
    .toArray();
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
  episodeId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
         WHERE episode_id = ? AND generation_id IS NOT NULL
         ORDER BY created_at DESC, attempt_id DESC LIMIT 1`,
        episodeId,
      )
      .toArray()[0] ?? null
  );
}

/** The episode's newest attempt that minted a generation other than the one named: what a running attempt may find abandoned. */
/**
 * Every generation this episode has ever written vectors under, oldest first
 * (docs/specs/vector-generation-cleanup.md §4.1).
 *
 * **`staged_chunk_count IS NOT NULL` is the filter that matters.** The count is written when embedding
 * begins, so an attempt without one never wrote a vector — it is not an orphan that was missed, it is
 * not an orphan at all, and a null count downstream could only become an empty id list or a crash.
 *
 * Ascending, unlike `previousWithGeneration` below, which wants the newest. Different questions: this
 * one is the cleanup's worklist and replays in a stable order.
 */
export function generationsFor(
  sql: SqlStorage,
  episodeId: string,
): { generationId: string; chunkCount: number; running: boolean }[] {
  return sql
    .exec<{
      generation_id: string;
      staged_chunk_count: number;
      status: string;
    }>(
      `SELECT generation_id, staged_chunk_count, status FROM episode_ingestion_attempts
       WHERE episode_id = ? AND generation_id IS NOT NULL AND staged_chunk_count IS NOT NULL
       ORDER BY created_at ASC, attempt_id ASC`,
      episodeId,
    )
    .toArray()
    .map((row) => ({
      generationId: row.generation_id,
      chunkCount: row.staged_chunk_count,
      running: row.status === "running",
    }));
}

export function previousWithGeneration(
  sql: SqlStorage,
  episodeId: string,
  excludingAttemptId: string,
): AttemptRow | null {
  return (
    sql
      .exec<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM episode_ingestion_attempts
         WHERE episode_id = ? AND generation_id IS NOT NULL AND attempt_id <> ?
         ORDER BY created_at DESC, attempt_id DESC LIMIT 1`,
        episodeId,
        excludingAttemptId,
      )
      .toArray()[0] ?? null
  );
}

export type RunningInsert = {
  attemptId: string;
  episodeId: string;
  trigger: AttemptTrigger;
  intent: ProcessingIntent;
  generationId: string;
  requestedByUserId: string | null;
  now: number;
};

/** A running attempt: its Workflow instance id is its own id (docs/specs/m3-ingestion.md §3). */
export function insertRunning(
  sql: SqlStorage,
  input: RunningInsert,
): AttemptRow {
  sql.exec(
    `INSERT INTO episode_ingestion_attempts
       (attempt_id, episode_id, trigger, intent, generation_id, staged_chunk_count, workflow_id,
        requested_by_user_id, status, outcome_code, failure_detail, started_at, finished_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'running', NULL, NULL, ?, NULL, ?)`,
    input.attemptId,
    input.episodeId,
    input.trigger,
    input.intent,
    input.generationId,
    input.attemptId,
    input.requestedByUserId,
    input.now,
    input.now,
  );
  return requireRow(sql, input.attemptId);
}

export type BlockedInsert = {
  attemptId: string;
  episodeId: string;
  trigger: AttemptTrigger;
  intent: ProcessingIntent;
  reason: "PROVIDER_AUTH" | "PROVIDER_LIMIT";
  requestedByUserId: string | null;
  now: number;
};

/** A start pre-flight refused: finished at once, no instance, no generation (docs/PRD.md §4.2 rule 9). */
export function insertBlocked(
  sql: SqlStorage,
  input: BlockedInsert,
): AttemptRow {
  sql.exec(
    `INSERT INTO episode_ingestion_attempts
       (attempt_id, episode_id, trigger, intent, generation_id, staged_chunk_count, workflow_id,
        requested_by_user_id, status, outcome_code, failure_detail, started_at, finished_at, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 'blocked', ?, NULL, ?, ?, ?)`,
    input.attemptId,
    input.episodeId,
    input.trigger,
    input.intent,
    input.requestedByUserId,
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

/**
 * The wire still names the requester by address, because that is what a screen prints; the row
 * holds an id. `resolved` lets a list resolve every address in one grouped query; a single attempt
 * looks up the one it has, and only when it has one, which is owner retries alone.
 */
export function toAttempt(
  sql: SqlStorage,
  row: AttemptRow,
  resolved?: Record<string, string>,
): EpisodeIngestionAttempt {
  return {
    attemptId: row.attempt_id,
    episodeId: row.episode_id,
    trigger: toTrigger(row.trigger),
    requestedByEmail: requesterEmail(sql, row.requested_by_user_id, resolved),
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
