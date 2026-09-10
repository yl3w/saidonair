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

  const episodes = {
    available: 0,
    pending: 0,
    waiting: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of sql.exec<{ status: string; waiting: number; n: number }>(
    `SELECT status, (waiting_code IS NOT NULL) AS waiting, COUNT(*) AS n FROM episodes GROUP BY status, waiting`,
  )) {
    if (row.status === "available") episodes.available += row.n;
    else if (row.status === "pending") episodes.pending += row.n;
    else if (row.status === "failed") episodes.failed += row.n;
    else if (row.status === "skipped") episodes.skipped += row.n;
    if (row.waiting) episodes.waiting += row.n;
  }

  return {
    channels,
    episodes,
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
