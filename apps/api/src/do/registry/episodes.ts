import type {
  EpisodeCounts,
  EpisodeStatus,
  EpisodeSummary,
  RelatedEpisode,
} from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, MAX_BOUND_PARAMS, placeholders } from "../../lib/sql";
import type { EpisodeRecord, ListEpisodesOptions } from "./types";

type EpisodeRow = {
  video_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  published_at: number;
  status: string;
  attempt_count: number;
  failure_code: string | null;
  failure_detail: string | null;
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
    e.status, e.attempt_count, e.failure_code, e.failure_detail, e.transcript_checked_at,
    e.chunk_count, e.vectorized_at, e.processed_at, e.created_at, e.updated_at,
    s.format AS summary_format, s.executive_summary, s.takeaways_json, s.topic_tags_json,
    s.raw_text, s.related_video_ids_json
  FROM episodes e
  JOIN channels c ON c.channel_id = e.channel_id
  LEFT JOIN episode_summaries s ON s.video_id = e.video_id`;

export const DEFAULT_EPISODE_LIMIT = 20;
export const MAX_EPISODE_LIMIT = 200;

/** Processed episodes per channel; callers derive counts and unread state from these. */
export function listProcessedVideoIds(
  sql: SqlStorage,
  channelIds: readonly string[],
): { channelId: string; videoId: string }[] {
  const ids: { channelId: string; videoId: string }[] = [];
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<{ channel_id: string; video_id: string }>(
      `SELECT channel_id, video_id FROM episodes
       WHERE status = 'processed' AND channel_id IN (${placeholders(batch.length)})
       ORDER BY channel_id, video_id`,
      ...batch,
    )) {
      ids.push({ channelId: row.channel_id, videoId: row.video_id });
    }
  }
  return ids;
}

/** Episode counts by status, zero-filled for every requested channel. */
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

/**
 * The digest: processed episodes with a stored summary, published at or after `sinceMs`, in the
 * given channels, newest first. Related titles are resolved within the same channels.
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
           WHERE e.status = 'processed' AND s.video_id IS NOT NULL AND e.published_at >= ?
             AND e.channel_id IN (${placeholders(batch.length)})`,
          sinceMs,
          ...batch,
        )
        .toArray(),
    );
  }
  rows.sort(byNewest);
  return attachRelated(sql, rows, channelIds);
}

/** Every episode of one channel in every status, newest first, with its summary when present. */
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
  return attachRelated(sql, rows, options.relatedScope);
}

export function zeroCounts(): EpisodeCounts {
  return {
    processed: 0,
    pending: 0,
    processing: 0,
    noTranscript: 0,
    failed: 0,
  };
}

function addCount(counts: EpisodeCounts, status: EpisodeStatus, n: number) {
  switch (status) {
    case "processed":
      counts.processed += n;
      break;
    case "pending":
      counts.pending += n;
      break;
    case "processing":
      counts.processing += n;
      break;
    case "no_transcript":
      counts.noTranscript += n;
      break;
    case "failed":
      counts.failed += n;
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
 * Resolves each row's related video ids to titles, keeping only processed episodes whose channel
 * is in `scope` and never the episode itself. AGENTS.md: referenced titles are filtered to the
 * reader's eligible channels.
 */
function attachRelated(
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
         WHERE status = 'processed' AND video_id IN (${placeholders(batch.length)})`,
        ...batch,
      )) {
        if (inScope.has(row.channel_id)) titles.set(row.video_id, row.title);
      }
    }
  }

  return rows.map((row) => {
    const related: RelatedEpisode[] = [];
    for (const videoId of relatedIds.get(row.video_id) ?? []) {
      const title = titles.get(videoId);
      if (videoId !== row.video_id && title !== undefined) {
        related.push({ videoId, title });
      }
    }
    return toRecord(row, related);
  });
}

function toRecord(row: EpisodeRow, related: RelatedEpisode[]): EpisodeRecord {
  return {
    videoId: row.video_id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    title: row.title,
    publishedAt: row.published_at,
    status: toStatus(row.status),
    summary: toSummary(row),
    related,
    processing: {
      attemptCount: row.attempt_count,
      failureCode: row.failure_code,
      failureDetail: row.failure_detail,
      transcriptCheckedAt: row.transcript_checked_at,
      chunkCount: row.chunk_count,
      vectorizedAt: row.vectorized_at,
      processedAt: row.processed_at,
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
        takeaways: parseStringArray(row.takeaways_json, "takeaways_json"),
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
    case "processing":
    case "processed":
    case "no_transcript":
    case "failed":
      return value;
    default:
      throw new Error(`unexpected episodes.status: ${value}`);
  }
}

// Summaries are validated before they are stored (AGENTS.md → AI usage), so a malformed column
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
