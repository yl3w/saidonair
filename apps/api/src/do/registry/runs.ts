import type {
  IngestionRunEpisodeStatus,
  IngestionRunKind,
  IngestionRunStatus,
  IngestionRunSummary,
} from "@media-digest/shared";
import { chunk, placeholders } from "../../lib/sql";
import type { IngestionRunEpisodeRecord, IngestionRunRecord } from "./types";

type RunRow = {
  run_id: string;
  channel_id: string;
  kind: string;
  status: string;
  lifecycle_version: number;
  episode_limit: number | null;
  started_at: number | null;
  finished_at: number | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: number;
};

type RunEpisodeRow = {
  run_id: string;
  video_id: string;
  status: string;
  failure_code: string | null;
  started_at: number | null;
  finished_at: number | null;
};

const RUN_COLUMNS = `run_id, channel_id, kind, status, lifecycle_version, episode_limit, started_at,
  finished_at, failure_code, failure_detail, created_at`;

/** The newest run per channel, for catalog rows. Channels without runs are absent. */
export function latestByChannel(
  sql: SqlStorage,
  channelIds: readonly string[],
): Record<string, IngestionRunSummary> {
  const latest: Record<string, IngestionRunSummary> = {};
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM (
         SELECT ${RUN_COLUMNS},
           ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY created_at DESC, run_id DESC) AS rn
         FROM ingestion_runs
         WHERE channel_id IN (${placeholders(batch.length)})
       ) WHERE rn = 1`,
      ...batch,
    )) {
      latest[row.channel_id] = {
        runId: row.run_id,
        kind: toKind(row.kind),
        status: toStatus(row.status),
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        failureCode: row.failure_code,
      };
    }
  }
  return latest;
}

/** Every run of one channel, newest first, each with its historical per-episode outcomes. */
export function listByChannel(
  sql: SqlStorage,
  channelId: string,
): IngestionRunRecord[] {
  const rows = sql
    .exec<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ingestion_runs
       WHERE channel_id = ? ORDER BY created_at DESC, run_id DESC`,
      channelId,
    )
    .toArray();
  const episodes = listRunEpisodes(
    sql,
    rows.map((row) => row.run_id),
  );
  return rows.map((row) => ({
    runId: row.run_id,
    channelId: row.channel_id,
    kind: toKind(row.kind),
    status: toStatus(row.status),
    lifecycleVersion: row.lifecycle_version,
    episodeLimit: row.episode_limit,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    createdAt: row.created_at,
    episodes: episodes.get(row.run_id) ?? [],
  }));
}

export function countActive(sql: SqlStorage): number {
  return sql
    .exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM ingestion_runs WHERE status IN ('queued', 'running')",
    )
    .one().n;
}

export function channelIdsWithActiveRun(sql: SqlStorage): string[] {
  return sql
    .exec<{ channel_id: string }>(
      `SELECT DISTINCT channel_id FROM ingestion_runs
       WHERE status IN ('queued', 'running') ORDER BY channel_id`,
    )
    .toArray()
    .map((row) => row.channel_id);
}

/** When the catalog last finished a run successfully; null before any run completes. */
export function lastCompletedFinishedAt(sql: SqlStorage): number | null {
  return sql
    .exec<{ at: number | null }>(
      "SELECT MAX(finished_at) AS at FROM ingestion_runs WHERE status = 'completed'",
    )
    .one().at;
}

function listRunEpisodes(
  sql: SqlStorage,
  runIds: readonly string[],
): Map<string, IngestionRunEpisodeRecord[]> {
  const byRun = new Map<string, IngestionRunEpisodeRecord[]>();
  for (const batch of chunk(runIds)) {
    for (const row of sql.exec<RunEpisodeRow>(
      `SELECT run_id, video_id, status, failure_code, started_at, finished_at
       FROM ingestion_run_episodes
       WHERE run_id IN (${placeholders(batch.length)})
       ORDER BY run_id, started_at, video_id`,
      ...batch,
    )) {
      const list = byRun.get(row.run_id) ?? [];
      list.push({
        videoId: row.video_id,
        status: toEpisodeStatus(row.status),
        failureCode: row.failure_code,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      });
      byRun.set(row.run_id, list);
    }
  }
  return byRun;
}

function toKind(value: string): IngestionRunKind {
  switch (value) {
    case "initial":
    case "scheduled":
    case "owner_retry":
      return value;
    default:
      throw new Error(`unexpected ingestion_runs.kind: ${value}`);
  }
}

function toStatus(value: string): IngestionRunStatus {
  switch (value) {
    case "queued":
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
      return value;
    default:
      throw new Error(`unexpected ingestion_runs.status: ${value}`);
  }
}

function toEpisodeStatus(value: string): IngestionRunEpisodeStatus {
  switch (value) {
    case "pending":
    case "processing":
    case "processed":
    case "no_transcript":
    case "failed":
    case "skipped":
      return value;
    default:
      throw new Error(`unexpected ingestion_run_episodes.status: ${value}`);
  }
}
