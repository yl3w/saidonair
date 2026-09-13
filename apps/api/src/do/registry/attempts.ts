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
 * The episode attempt ledger, read side (docs/PRD.md §4.2 rules 6–9): the latest attempt is where
 * an episode's reason lives, and a running one is what Retry refuses. The writes (begin, stage,
 * finish, block, complete) arrive with M3.
 */

type AttemptRow = {
  attempt_id: string;
  video_id: string;
  trigger: string;
  intent: string;
  staged_chunk_count: number | null;
  workflow_id: string | null;
  requested_by_email: string | null;
  status: string;
  outcome_code: string | null;
  failure_detail: string | null;
  started_at: number;
  finished_at: number | null;
};

const ATTEMPT_COLUMNS = `attempt_id, video_id, trigger, intent, staged_chunk_count, workflow_id,
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
  return (
    sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM episode_ingestion_attempts WHERE video_id = ? AND status = 'running'",
        videoId,
      )
      .one().n > 0
  );
}

function toAttempt(row: AttemptRow): EpisodeIngestionAttempt {
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

function toTrigger(value: string): AttemptTrigger {
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

function toIntent(value: string): ProcessingIntent {
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
