import type { Catalog } from "@media-digest/shared";
import { countByChannel, zeroCounts } from "./episodes";
import {
  channelIdsWithActiveRun,
  countActive,
  lastCompletedFinishedAt,
  latestByChannel,
} from "./runs";
import type { CatalogChannel, ChannelManagementRecord } from "./types";

/**
 * The catalog's aggregate state for the owner's attention card and health strip. Deleted
 * channels count only as deleted, whatever their processing status.
 */
export function summarize(sql: SqlStorage): Catalog {
  const channels = { available: 0, pending: 0, failed: 0, deleted: 0 };
  for (const row of sql.exec<{ status: string; deleted: number; n: number }>(
    `SELECT status, (deleted_at IS NOT NULL) AS deleted, COUNT(*) AS n
     FROM channels GROUP BY status, deleted`,
  )) {
    if (row.deleted) channels.deleted += row.n;
    else if (row.status === "available") channels.available += row.n;
    else if (row.status === "pending") channels.pending += row.n;
    else if (row.status === "failed") channels.failed += row.n;
  }

  const stuckPending = sql
    .exec<{ n: number }>(
      `SELECT COUNT(*) AS n FROM channels
       WHERE status = 'pending' AND deleted_at IS NULL
         AND channel_id NOT IN (
           SELECT channel_id FROM ingestion_runs WHERE status IN ('queued', 'running')
         )`,
    )
    .one().n;

  const episodes = sql
    .exec<{ processed: number; tracked: number }>(
      `SELECT COALESCE(SUM(status = 'processed'), 0) AS processed, COUNT(*) AS tracked
       FROM episodes`,
    )
    .one();

  return {
    channels: { ...channels, stuckPending },
    episodes: { processed: episodes.processed, tracked: episodes.tracked },
    runs: { active: countActive(sql) },
    lastSuccessfulIngestionAt: lastCompletedFinishedAt(sql),
  };
}

/** Joins channels to the owner-only facts in a handful of grouped queries, never per channel. */
export function withManagement(
  sql: SqlStorage,
  channels: readonly CatalogChannel[],
): ChannelManagementRecord[] {
  const ids = channels.map((channel) => channel.channelId);
  const counts = countByChannel(sql, ids);
  const latest = latestByChannel(sql, ids);
  const active = new Set(channelIdsWithActiveRun(sql));
  return channels.map((channel) => ({
    channel,
    episodes: counts[channel.channelId] ?? zeroCounts(),
    latestRun: latest[channel.channelId] ?? null,
    stuckPending:
      channel.status === "pending" &&
      channel.deletedAt === null &&
      !active.has(channel.channelId),
  }));
}
