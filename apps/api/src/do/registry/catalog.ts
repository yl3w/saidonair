import type { Catalog } from "@media-digest/shared";
import { countByChannel, zeroCounts } from "./episodes";
import { countActive, lastCompletedFinishedAt, latestByChannel } from "./runs";
import type { CatalogChannel, ChannelManagementRecord } from "./types";

/**
 * The catalog's aggregate state for the owner's attention card and health strip. An approved
 * channel counts as `paused` rather than `approved` while a pause is set.
 */
export function summarize(sql: SqlStorage): Catalog {
  const channels = { requested: 0, approved: 0, paused: 0, declined: 0 };
  for (const row of sql.exec<{ status: string; paused: number; n: number }>(
    `SELECT status, (paused_by IS NOT NULL) AS paused, COUNT(*) AS n FROM channels GROUP BY status, paused`,
  )) {
    if (row.status === "requested") channels.requested += row.n;
    else if (row.status === "declined") channels.declined += row.n;
    else if (row.paused) channels.paused += row.n;
    else channels.approved += row.n;
  }

  const episodes = sql
    .exec<{ processed: number; tracked: number }>(
      `SELECT COALESCE(SUM(status = 'processed'), 0) AS processed, COUNT(*) AS tracked
       FROM episodes`,
    )
    .one();

  return {
    channels,
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
  return channels.map((channel) => ({
    channel,
    episodes: counts[channel.channelId] ?? zeroCounts(),
    latestRun: latest[channel.channelId] ?? null,
    neverStarted:
      channel.status === "approved" && !(channel.channelId in latest),
  }));
}
