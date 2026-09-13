import type {
  FeedStatus,
  IngestionRun,
  IngestionRunKind,
} from "@media-digest/shared";
import { chunk, placeholders } from "../../lib/sql";

/**
 * Discovery runs are completed RSS feed history (docs/PRD.md §4.2 rules 1–4): what a feed check
 * found, never what happened to the episodes afterwards. Reads only until M3 writes them.
 */

type RunRow = {
  run_id: string;
  channel_id: string;
  kind: string;
  feed_status: string;
  discovered_count: number;
  episode_limit: number | null;
  started_at: number;
  finished_at: number;
};

const RUN_COLUMNS = `run_id, channel_id, kind, feed_status, discovered_count, episode_limit,
  started_at, finished_at`;

/** The newest run per channel, for catalog rows. Channels without runs are absent. */
export function latestByChannel(
  sql: SqlStorage,
  channelIds: readonly string[],
): Record<string, IngestionRun> {
  const latest: Record<string, IngestionRun> = {};
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
      latest[row.channel_id] = toRun(row);
    }
  }
  return latest;
}

/** Every run of one channel, newest first. */
export function listByChannel(
  sql: SqlStorage,
  channelId: string,
): IngestionRun[] {
  return sql
    .exec<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ingestion_runs
       WHERE channel_id = ? ORDER BY created_at DESC, run_id DESC`,
      channelId,
    )
    .toArray()
    .map(toRun);
}

function toRun(row: RunRow): IngestionRun {
  return {
    runId: row.run_id,
    channelId: row.channel_id,
    kind: toKind(row.kind),
    feedStatus: toFeedStatus(row.feed_status),
    discoveredCount: row.discovered_count,
    episodeLimit: row.episode_limit,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toKind(value: string): IngestionRunKind {
  if (value === "initial" || value === "scheduled") return value;
  throw new Error(`unexpected ingestion_runs.kind: ${value}`);
}

function toFeedStatus(value: string): FeedStatus {
  if (value === "read" || value === "unavailable") return value;
  throw new Error(`unexpected ingestion_runs.feed_status: ${value}`);
}
