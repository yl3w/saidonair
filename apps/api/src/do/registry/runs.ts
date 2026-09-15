import type {
  FeedStatus,
  IngestionRun,
  IngestionRunKind,
} from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import type { ChannelFeed, FeedEntry } from "../../lib/youtube/rss";
import { markChecked, requireChannel } from "./channels";
import {
  existingEpisodeIds,
  hasAnyEpisode,
  insertDiscovered,
  listByEpisodeIds,
} from "./episodes";
import type { CatalogChannel, DiscoveryResult } from "./types";

/**
 * Discovery runs are completed RSS feed history (docs/PRD.md §4.2 rules 1–4): what a feed check
 * found, never what happened to the episodes afterwards. `recordDiscovery` writes one, with the
 * episodes it creates, in one transaction (docs/specs/m3-2-attempt-ledger.md §3).
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

export function getRun(sql: SqlStorage, runId: string): IngestionRun | null {
  const row = sql
    .exec<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ingestion_runs WHERE run_id = ?`,
      runId,
    )
    .toArray()[0];
  return row ? toRun(row) : null;
}

/**
 * One completed feed check of an approved channel. `feed` is the parsed feed, or null when it could
 * not be read. The Registry decides the kind (`initial` until a run of this channel has created an
 * episode), applies the selection rule, writes the run and the new episodes, and moves
 * `last_checked_at` only on a read. Pause is not consulted: the discovery cron selects unpaused
 * channels, and first approval and Start ignore pause by design (rule 4).
 */
export function recordDiscovery(
  sql: SqlStorage,
  channelId: string,
  feed: ChannelFeed | null,
  now: number,
): DiscoveryResult {
  const channel = requireChannel(sql, channelId);
  if (channel.status !== "approved") {
    throw new DomainError(
      "INVALID_STATE",
      `only an approved channel is discovered (status: ${channel.status})`,
    );
  }
  if (feed && feed.channelId !== channel.channelId) {
    throw new DomainError(
      "INVALID_INPUT",
      "the feed belongs to another channel",
    );
  }
  const kind: IngestionRunKind = hasAnyEpisode(sql, channel.channelId)
    ? "scheduled"
    : "initial";
  const runId = crypto.randomUUID();
  if (feed === null) {
    insertRun(sql, runId, channel.channelId, kind, "unavailable", 0, null, now);
    return { run: requireRun(sql, runId), created: [] };
  }
  const selected = selectEntries(sql, channel, kind, feed.entries);
  insertRun(
    sql,
    runId,
    channel.channelId,
    kind,
    "read",
    selected.length,
    kind === "initial" ? channel.initialImportCount : null,
    now,
  );
  insertDiscovered(sql, channel.channelId, runId, selected, now);
  markChecked(sql, channel.channelId, now);
  return {
    run: requireRun(sql, runId),
    created: listByEpisodeIds(
      sql,
      selected.map((entry) => entry.videoId),
    ),
  };
}

/**
 * The selection rule (docs/PRD.md §4.2 rule 2): newest first, each id once, never an episode that
 * already exists anywhere; an `initial` run takes the newest `initial_import_count` whatever their
 * dates, a `scheduled` run takes what was published after the first approval. Entries outside the
 * selection are not remembered.
 */
function selectEntries(
  sql: SqlStorage,
  channel: CatalogChannel,
  kind: IngestionRunKind,
  entries: readonly FeedEntry[],
): FeedEntry[] {
  const seen = new Set<string>();
  const ordered = [...entries]
    .sort(
      (a, b) =>
        b.publishedAt - a.publishedAt || a.videoId.localeCompare(b.videoId),
    )
    .filter((entry) => {
      if (seen.has(entry.videoId)) return false;
      seen.add(entry.videoId);
      return true;
    });
  const existing = existingEpisodeIds(
    sql,
    ordered.map((entry) => entry.videoId),
  );
  const fresh = ordered.filter((entry) => !existing.has(entry.videoId));
  if (kind === "initial") return fresh.slice(0, channel.initialImportCount);
  const approvedAt = channel.approvedAt ?? 0;
  return fresh.filter((entry) => entry.publishedAt > approvedAt);
}

function insertRun(
  sql: SqlStorage,
  runId: string,
  channelId: string,
  kind: IngestionRunKind,
  feedStatus: FeedStatus,
  discoveredCount: number,
  episodeLimit: number | null,
  now: number,
): void {
  sql.exec(
    `INSERT INTO ingestion_runs (${RUN_COLUMNS}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId,
    channelId,
    kind,
    feedStatus,
    discoveredCount,
    episodeLimit,
    now,
    now,
    now,
  );
}

function requireRun(sql: SqlStorage, runId: string): IngestionRun {
  const run = getRun(sql, runId);
  if (!run) throw new Error(`run ${runId} vanished inside its own transaction`);
  return run;
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
