import type {
  EpisodeCounts,
  EpisodeFailureCode,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeSummary,
  RecoveryMode,
  RelatedEpisode,
  Takeaway,
} from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, MAX_BOUND_PARAMS, placeholders } from "../../lib/sql";
import { hasRunning, latestByVideo } from "./attempts";
import { requireChannel } from "./channels";
import type { EpisodeRecord, ListEpisodesOptions } from "./types";

type EpisodeRow = {
  video_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  published_at: number;
  status: string;
  discovered_by_run_id: string;
  recovery_mode: string | null;
  recovery_started_at: number | null;
  recovery_deadline_at: number | null;
  next_attempt_at: number | null;
  attempt_count: number;
  failure_code: string | null;
  failure_detail: string | null;
  skip_reason: string | null;
  skipped_at: number | null;
  skipped_by_email: string | null;
  transcript_checked_at: number | null;
  chunk_count: number | null;
  vectorized_at: number | null;
  processed_at: number | null;
  created_at: number;
  updated_at: number;
  summary_format: string | null;
  executive_summary: string | null;
  takeaways_json: string | null;
  topic_tags_json: string | null;
  raw_text: string | null;
  related_video_ids_json: string | null;
};

const EPISODE_SELECT = `SELECT e.video_id, e.channel_id, c.title AS channel_title, e.title, e.published_at,
    e.status, e.discovered_by_run_id, e.recovery_mode, e.recovery_started_at, e.recovery_deadline_at,
    e.next_attempt_at, e.attempt_count, e.failure_code, e.failure_detail, e.skip_reason, e.skipped_at,
    e.skipped_by_email, e.transcript_checked_at, e.chunk_count, e.vectorized_at, e.processed_at,
    e.created_at, e.updated_at,
    s.format AS summary_format, s.executive_summary, s.takeaways_json, s.topic_tags_json,
    s.raw_text, s.related_video_ids_json
  FROM episodes e
  JOIN channels c ON c.channel_id = e.channel_id
  LEFT JOIN episode_summaries s ON s.video_id = e.video_id`;

export const DEFAULT_EPISODE_LIMIT = 20;
export const MAX_EPISODE_LIMIT = 200;
/** The one recovery window every unfinished, non-deterministic outcome gets (docs/PRD.md §4.2 rule 13). */
export const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Available episodes per channel; callers derive counts and unread state from these. */
export function listAvailableVideoIds(
  sql: SqlStorage,
  channelIds: readonly string[],
): { channelId: string; videoId: string }[] {
  const ids: { channelId: string; videoId: string }[] = [];
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<{ channel_id: string; video_id: string }>(
      `SELECT channel_id, video_id FROM episodes
       WHERE status = 'available' AND channel_id IN (${placeholders(batch.length)})
       ORDER BY channel_id, video_id`,
      ...batch,
    )) {
      ids.push({ channelId: row.channel_id, videoId: row.video_id });
    }
  }
  return ids;
}

/** Episode counts by status, zero-filled for every requested channel. A plain group-by: no `waiting`. */
export function countByChannel(
  sql: SqlStorage,
  channelIds: readonly string[],
): Record<string, EpisodeCounts> {
  const counts: Record<string, EpisodeCounts> = {};
  for (const channelId of channelIds) counts[channelId] = zeroCounts();
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<{
      channel_id: string;
      status: string;
      n: number;
    }>(
      `SELECT channel_id, status, COUNT(*) AS n FROM episodes
       WHERE channel_id IN (${placeholders(batch.length)})
       GROUP BY channel_id, status`,
      ...batch,
    )) {
      const entry = counts[row.channel_id];
      if (entry) addCount(entry, toStatus(row.status), row.n);
    }
  }
  return counts;
}

/** The four episode counts across the whole catalog. */
export function countAll(sql: SqlStorage): EpisodeCounts {
  const counts = zeroCounts();
  for (const row of sql.exec<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM episodes GROUP BY status",
  )) {
    addCount(counts, toStatus(row.status), row.n);
  }
  return counts;
}

/**
 * `MAX(processed_at)` per channel: the API's derived `lastIngestedAt` (docs/PRD.md §4.2 rule 27).
 * Channels with nothing available yet are absent.
 */
export function lastProcessedAtByChannel(
  sql: SqlStorage,
  channelIds: readonly string[],
): Record<string, number> {
  const latest: Record<string, number> = {};
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<{ channel_id: string; at: number | null }>(
      `SELECT channel_id, MAX(processed_at) AS at FROM episodes
       WHERE channel_id IN (${placeholders(batch.length)}) GROUP BY channel_id`,
      ...batch,
    )) {
      if (row.at !== null) latest[row.channel_id] = row.at;
    }
  }
  return latest;
}

/** `MAX(processed_at)` across the Registry: the catalog's `lastSuccessfulIngestionAt`. */
export function lastProcessedAt(sql: SqlStorage): number | null {
  return sql
    .exec<{ at: number | null }>("SELECT MAX(processed_at) AS at FROM episodes")
    .one().at;
}

/**
 * The digest: available episodes with a stored summary, published at or after `sinceMs`, in the
 * given channels, newest first. Publication time is the basis until M3 switches it to first
 * availability (docs/PRD.md §4.4). Related titles are resolved within the same channels.
 */
export function listDigest(
  sql: SqlStorage,
  channelIds: readonly string[],
  sinceMs: number,
): EpisodeRecord[] {
  const rows: EpisodeRow[] = [];
  // One binding is spent on `since`, so batches stay one under the cap.
  for (const batch of chunk(channelIds, MAX_BOUND_PARAMS - 1)) {
    rows.push(
      ...sql
        .exec<EpisodeRow>(
          `${EPISODE_SELECT}
           WHERE e.status = 'available' AND s.video_id IS NOT NULL AND e.published_at >= ?
             AND e.channel_id IN (${placeholders(batch.length)})`,
          sinceMs,
          ...batch,
        )
        .toArray(),
    );
  }
  rows.sort(byNewest);
  return complete(sql, rows, channelIds);
}

/** Every episode of one channel in every status, newest first, with its summary when available. */
export function listByChannel(
  sql: SqlStorage,
  channelId: string,
  options: ListEpisodesOptions,
): EpisodeRecord[] {
  const limit = requireLimit(options.limit);
  const rows = sql
    .exec<EpisodeRow>(
      `${EPISODE_SELECT}
       WHERE e.channel_id = ?
       ORDER BY e.published_at DESC, e.video_id
       LIMIT ?`,
      channelId,
      limit,
    )
    .toArray();
  return complete(sql, rows, options.relatedScope);
}

/** One episode of one channel, with processing detail but no related titles. */
export function getEpisode(
  sql: SqlStorage,
  channelId: string,
  videoId: string,
): EpisodeRecord | null {
  const row = sql
    .exec<EpisodeRow>(
      `${EPISODE_SELECT} WHERE e.channel_id = ? AND e.video_id = ?`,
      channelId,
      videoId,
    )
    .toArray()[0];
  return row ? (complete(sql, [row], [])[0] ?? null) : null;
}

/**
 * Retry re-arms the episode's recovery (docs/PRD.md §4.2 rule 16): a `pending`, `failed`, or
 * `skipped` episode returns to pending publication with a fresh 48-hour window; an `available` one
 * enters replacement recovery with its summary, active generation, and first availability untouched.
 * Refused only while an attempt is running (rule 17). Channel status is never consulted. No attempt
 * is written and nothing launches here: the starter and pre-flight arrive with M3.
 */
export function retryEpisode(
  sql: SqlStorage,
  channelId: string,
  videoId: string,
  now: number,
): EpisodeRecord {
  const episode = requireEpisode(sql, channelId, videoId);
  if (hasRunning(sql, videoId)) {
    throw new DomainError(
      "INVALID_STATE",
      "an attempt is running for this episode",
    );
  }
  const deadline = now + RECOVERY_WINDOW_MS;
  if (episode.status === "available") {
    sql.exec(
      `UPDATE episodes SET recovery_mode = 'replacement', recovery_started_at = ?, recovery_deadline_at = ?,
         next_attempt_at = ?, attempt_count = 0, recovery_vector_generation = NULL, updated_at = ?
       WHERE video_id = ?`,
      now,
      deadline,
      now,
      now,
      videoId,
    );
  } else {
    sql.exec(
      `UPDATE episodes SET status = 'pending', recovery_mode = 'publication', recovery_started_at = ?,
         recovery_deadline_at = ?, next_attempt_at = ?, attempt_count = 0, failure_code = NULL,
         failure_detail = NULL, skip_reason = NULL, skipped_at = NULL, skipped_by_email = NULL,
         recovery_vector_generation = NULL, updated_at = ?
       WHERE video_id = ?`,
      now,
      deadline,
      now,
      now,
      videoId,
    );
  }
  return requireEpisode(sql, channelId, videoId);
}

/** `failed → skipped OWNER`, recording whoever skipped it, in any channel status (docs/PRD.md §4.2 rule 18). */
export function skipEpisode(
  sql: SqlStorage,
  channelId: string,
  videoId: string,
  actorEmail: string,
  now: number,
): EpisodeRecord {
  const episode = requireEpisode(sql, channelId, videoId);
  if (episode.status !== "failed") {
    throw new DomainError(
      "INVALID_STATE",
      `only failed episodes can be skipped (status: ${episode.status})`,
    );
  }
  sql.exec(
    `UPDATE episodes SET status = 'skipped', skip_reason = 'OWNER', skipped_at = ?, skipped_by_email = ?,
       failure_code = NULL, failure_detail = NULL, updated_at = ? WHERE video_id = ?`,
    now,
    actorEmail,
    now,
    videoId,
  );
  return requireEpisode(sql, channelId, videoId);
}

/** An episode that belongs to the named channel; channel status is not consulted. */
function requireEpisode(
  sql: SqlStorage,
  channelId: string,
  videoId: string,
): EpisodeRecord {
  requireChannel(sql, channelId);
  const episode = getEpisode(sql, channelId, videoId);
  if (!episode) throw new DomainError("NOT_FOUND", "episode not found");
  return episode;
}

export function zeroCounts(): EpisodeCounts {
  return { available: 0, pending: 0, failed: 0, skipped: 0 };
}

function addCount(counts: EpisodeCounts, status: EpisodeStatus, n: number) {
  switch (status) {
    case "available":
      counts.available += n;
      break;
    case "pending":
      counts.pending += n;
      break;
    case "failed":
      counts.failed += n;
      break;
    case "skipped":
      counts.skipped += n;
      break;
  }
}

function requireLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_EPISODE_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_EPISODE_LIMIT) {
    throw new DomainError(
      "INVALID_INPUT",
      `limit must be an integer between 1 and ${MAX_EPISODE_LIMIT}`,
    );
  }
  return value;
}

function byNewest(a: EpisodeRow, b: EpisodeRow): number {
  return (
    b.published_at - a.published_at || a.video_id.localeCompare(b.video_id)
  );
}

/**
 * Turns rows into records: resolves each row's related video ids to titles, keeping only available
 * episodes whose channel is in `scope` and never the episode itself (docs/PRD.md §4.4), and attaches
 * each episode's latest attempt, where its reason lives.
 */
function complete(
  sql: SqlStorage,
  rows: EpisodeRow[],
  scope: readonly string[],
): EpisodeRecord[] {
  const relatedIds = new Map<string, string[]>();
  const wanted = new Set<string>();
  for (const row of rows) {
    const ids = parseStringArray(
      row.related_video_ids_json,
      "related_video_ids_json",
    );
    relatedIds.set(row.video_id, ids);
    for (const id of ids) wanted.add(id);
  }

  const titles = new Map<string, string>();
  if (wanted.size > 0 && scope.length > 0) {
    const inScope = new Set(scope);
    for (const batch of chunk([...wanted])) {
      for (const row of sql.exec<{
        video_id: string;
        channel_id: string;
        title: string;
      }>(
        `SELECT video_id, channel_id, title FROM episodes
         WHERE status = 'available' AND video_id IN (${placeholders(batch.length)})`,
        ...batch,
      )) {
        if (inScope.has(row.channel_id)) titles.set(row.video_id, row.title);
      }
    }
  }

  const latest = latestByVideo(
    sql,
    rows.map((row) => row.video_id),
  );

  return rows.map((row) => {
    const related: RelatedEpisode[] = [];
    for (const videoId of relatedIds.get(row.video_id) ?? []) {
      const title = titles.get(videoId);
      if (videoId !== row.video_id && title !== undefined) {
        related.push({ videoId, title });
      }
    }
    return toRecord(row, related, latest[row.video_id] ?? null);
  });
}

function toRecord(
  row: EpisodeRow,
  related: RelatedEpisode[],
  latestAttempt: EpisodeRecord["processing"]["latestAttempt"],
): EpisodeRecord {
  const status = toStatus(row.status);
  return {
    videoId: row.video_id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    title: row.title,
    publishedAt: row.published_at,
    status,
    skipReason: toSkipReason(row.skip_reason),
    summaryAvailableAt: row.processed_at,
    // Summary and related data leave the Registry only for an available episode.
    summary: status === "available" ? toSummary(row) : null,
    related: status === "available" ? related : [],
    processing: {
      discoveredByRunId: row.discovered_by_run_id,
      recoveryMode: toRecoveryMode(row.recovery_mode),
      recoveryStartedAt: row.recovery_started_at,
      recoveryDeadlineAt: row.recovery_deadline_at,
      nextAttemptAt: row.next_attempt_at,
      attemptCount: row.attempt_count,
      latestAttempt,
      failureCode: toFailureCode(row.failure_code),
      failureDetail: row.failure_detail,
      skippedAt: row.skipped_at,
      skippedByEmail: row.skipped_by_email,
      transcriptCheckedAt: row.transcript_checked_at,
      chunkCount: row.chunk_count,
      vectorizedAt: row.vectorized_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

function toSummary(row: EpisodeRow): EpisodeSummary | null {
  switch (row.summary_format) {
    case null:
      return null;
    case "structured":
      return {
        format: "structured",
        executiveSummary: requireText(
          row.executive_summary,
          "executive_summary",
        ),
        takeaways: parseTakeaways(row.takeaways_json),
        topicTags: parseStringArray(row.topic_tags_json, "topic_tags_json"),
      };
    case "raw_fallback":
      return {
        format: "raw_fallback",
        rawText: requireText(row.raw_text, "raw_text"),
      };
    default:
      throw new Error(
        `unexpected episode_summaries.format: ${row.summary_format}`,
      );
  }
}

function toStatus(value: string): EpisodeStatus {
  switch (value) {
    case "pending":
    case "available":
    case "failed":
    case "skipped":
      return value;
    default:
      throw new Error(`unexpected episodes.status: ${value}`);
  }
}

function toRecoveryMode(value: string | null): RecoveryMode | null {
  if (value === null || value === "publication" || value === "replacement") {
    return value;
  }
  throw new Error(`unexpected episodes.recovery_mode: ${value}`);
}

function toFailureCode(value: string | null): EpisodeFailureCode | null {
  if (value === null || value === "INGESTION_TIMEOUT") return value;
  throw new Error(`unexpected episodes.failure_code: ${value}`);
}

function toSkipReason(value: string | null): EpisodeSkipReason | null {
  switch (value) {
    case null:
    case "SHORT":
    case "NON_ENGLISH":
    case "UNPLAYABLE":
    case "OWNER":
      return value;
    default:
      throw new Error(`unexpected episodes.skip_reason: ${value}`);
  }
}

// Summaries are validated before they are stored (docs/PRD.md §4.4), so a malformed column
// is corruption, not input: fail loudly rather than return a half summary.
function requireText(value: string | null, column: string): string {
  if (value === null) throw new Error(`episode_summaries.${column} is NULL`);
  return value;
}

function parseStringArray(value: string | null, column: string): string[] {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error(`episode_summaries.${column} is not a string array`);
  }
  return parsed;
}

/** `[{ text, startSec }]`, `startSec` null when the model gave no usable marker (docs/PRD.md §4.4). */
function parseTakeaways(value: string | null): Takeaway[] {
  const parsed: unknown = JSON.parse(requireText(value, "takeaways_json"));
  if (!Array.isArray(parsed) || !parsed.every(isTakeaway)) {
    throw new Error(
      "episode_summaries.takeaways_json is not an array of { text, startSec }",
    );
  }
  return parsed;
}

function isTakeaway(item: unknown): item is Takeaway {
  if (typeof item !== "object" || item === null) return false;
  const { text, startSec } = item as Record<string, unknown>;
  return (
    typeof text === "string" &&
    (startSec === null ||
      (typeof startSec === "number" && Number.isFinite(startSec)))
  );
}
