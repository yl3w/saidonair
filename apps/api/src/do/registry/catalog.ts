import {
  countAll,
  countByChannel,
  lastProcessedAt,
  lastProcessedAtByChannel,
  zeroCounts,
} from "./episodes";
import { latestByChannel } from "./runs";
import type {
  CatalogChannel,
  CatalogSummary,
  ChannelManagementRecord,
} from "./types";

/**
 * The catalog's aggregate state for the attention card and health strip. An approved channel counts
 * as `paused` rather than `approved` while a pause is set. Episode counts are a plain group-by on
 * status (no `waiting`: wait reasons live on episode rows), and the last successful ingestion is the
 * newest first availability anywhere (docs/PRD.md §4.2 rule 27).
 */
export function summarize(sql: SqlStorage): CatalogSummary {
  const channels = { requested: 0, approved: 0, paused: 0, declined: 0 };
  for (const row of sql.exec<{ status: string; paused: number; n: number }>(
    `SELECT status, (paused_by IS NOT NULL) AS paused, COUNT(*) AS n FROM channels GROUP BY status, paused`,
  )) {
    if (row.status === "requested") channels.requested += row.n;
    else if (row.status === "declined") channels.declined += row.n;
    else if (row.paused) channels.paused += row.n;
    else channels.approved += row.n;
  }
  const episodes = countAll(sql);
  return {
    channels,
    episodes,
    lastSuccessfulIngestionAt: lastProcessedAt(sql),
    attention: {
      failedEpisodes: episodes.failed,
      neverStarted: sql
        .exec<{ n: number }>(
          `SELECT COUNT(*) AS n FROM channels WHERE status = 'approved'
             AND channel_id NOT IN (SELECT channel_id FROM ingestion_runs)`,
        )
        .one().n,
      requested: channels.requested,
    },
  };
}

/** Joins channels to their management facts in a handful of grouped queries, never per channel. */
export function withManagement(
  sql: SqlStorage,
  channels: readonly CatalogChannel[],
): ChannelManagementRecord[] {
  const ids = channels.map((channel) => channel.channelId);
  const counts = countByChannel(sql, ids);
  const latest = latestByChannel(sql, ids);
  const ingested = lastProcessedAtByChannel(sql, ids);
  return channels.map((channel) => ({
    channel,
    episodes: counts[channel.channelId] ?? zeroCounts(),
    lastIngestedAt: ingested[channel.channelId] ?? null,
    latestRun: latest[channel.channelId] ?? null,
    neverStarted:
      channel.status === "approved" && !(channel.channelId in latest),
  }));
}
