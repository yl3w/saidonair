import type {
  EpisodeCounts,
  EpisodeFailureCode,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeSummary,
  ProcessingIntent,
  RelatedEpisode,
  Takeaway,
} from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, MAX_BOUND_PARAMS, placeholders } from "../../lib/sql";
import type { FeedEntry } from "../../lib/youtube/rss";
import { hasRunning, latestByVideo } from "./attempts";
import { requireChannel } from "./channels";
import type {
  DigestRowRecord,
  DigestSelection,
  EpisodeRecord,
  ListEpisodesOptions,
} from "./types";

type EpisodeRow = {
  video_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  published_at: number;
  status: string;
  discovered_by_run_id: string;
  intent: string | null;
  window_started_at: number | null;
  window_deadline_at: number | null;
  next_attempt_at: number | null;
  attempt_count: number;
  failure_code: string | null;
  failure_detail: string | null;
  skip_reason: string | null;
  skipped_at: number | null;
  skipped_by_email: string | null;
  transcript_checked_at: number | null;
  duration_sec: number | null;
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
    e.status, e.discovered_by_run_id, e.intent, e.window_started_at, e.window_deadline_at,
    e.next_attempt_at, e.attempt_count, e.failure_code, e.failure_detail, e.skip_reason, e.skipped_at,
    e.skipped_by_email, e.transcript_checked_at, e.duration_sec, e.chunk_count, e.vectorized_at, e.processed_at,
    e.created_at, e.updated_at,
    s.format AS summary_format, s.executive_summary, s.takeaways_json, s.topic_tags_json,
    s.raw_text, s.related_video_ids_json
  FROM episodes e
  JOIN channels c ON c.channel_id = e.channel_id
  LEFT JOIN episode_summaries s ON s.video_id = e.video_id`;

export const DEFAULT_EPISODE_LIMIT = 20;
export const MAX_EPISODE_LIMIT = 200;
/** The one processing window every episode gets, from creation and again on Retry (docs/PRD.md §4.2 rule 13). */
export const PROCESSING_WINDOW_MS = 48 * 60 * 60 * 1000;
/** An unfinished attempt makes the episode due again this much later, capped at the deadline (rule 13). */
export const RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The columns the state machine reads before it writes (`processing.ts`): content state and the open
 * window, without the joins the API record carries.
 */
export type EpisodeState = {
  videoId: string;
  channelId: string;
  status: EpisodeStatus;
  intent: ProcessingIntent | null;
  windowStartedAt: number | null;
  windowDeadlineAt: number | null;
  nextAttemptAt: number | null;
  attemptCount: number;
  stagedVectorGeneration: string | null;
  activeVectorGeneration: string | null;
  chunkCount: number | null;
  processedAt: number | null;
};

export function getState(
  sql: SqlStorage,
  videoId: string,
): EpisodeState | null {
  const row = sql
    .exec<{
      video_id: string;
      channel_id: string;
      status: string;
      intent: string | null;
      window_started_at: number | null;
      window_deadline_at: number | null;
      next_attempt_at: number | null;
      attempt_count: number;
      staged_vector_generation: string | null;
      active_vector_generation: string | null;
      chunk_count: number | null;
      processed_at: number | null;
    }>(
      `SELECT video_id, channel_id, status, intent, window_started_at, window_deadline_at, next_attempt_at,
         attempt_count, staged_vector_generation, active_vector_generation, chunk_count, processed_at
       FROM episodes WHERE video_id = ?`,
      videoId,
    )
    .toArray()[0];
  if (!row) return null;
  return {
    videoId: row.video_id,
    channelId: row.channel_id,
    status: toStatus(row.status),
    intent: toIntent(row.intent),
    windowStartedAt: row.window_started_at,
    windowDeadlineAt: row.window_deadline_at,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
    stagedVectorGeneration: row.staged_vector_generation,
    activeVectorGeneration: row.active_vector_generation,
    chunkCount: row.chunk_count,
    processedAt: row.processed_at,
  };
}

export function requireState(sql: SqlStorage, videoId: string): EpisodeState {
  const state = getState(sql, videoId);
  if (!state) throw new DomainError("NOT_FOUND", "episode not found");
  return state;
}

/** Whether any run of this channel has ever created an episode: the run kind rule (docs/PRD.md §4.2 rule 2). */
export function hasAnyEpisode(sql: SqlStorage, channelId: string): boolean {
  return (
    sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM (SELECT 1 FROM episodes WHERE channel_id = ? LIMIT 1)",
        channelId,
      )
      .one().n > 0
  );
}

/** Which of the given ids already exist anywhere in the Registry; discovery never selects them. */
export function existingVideoIds(
  sql: SqlStorage,
  videoIds: readonly string[],
): Set<string> {
  const existing = new Set<string>();
  for (const batch of chunk(videoIds)) {
    for (const row of sql.exec<{ video_id: string }>(
      `SELECT video_id FROM episodes WHERE video_id IN (${placeholders(batch.length)})`,
      ...batch,
    )) {
      existing.add(row.video_id);
    }
  }
  return existing;
}

/**
 * The episodes one feed check creates: `pending`, intent `publish`, the 48-hour window open from
 * now, due at once, naming the run that discovered them (docs/PRD.md §4.2 rules 3 and 5).
 */
export function insertDiscovered(
  sql: SqlStorage,
  channelId: string,
  runId: string,
  entries: readonly FeedEntry[],
  now: number,
): void {
  for (const entry of entries) {
    sql.exec(
      `INSERT INTO episodes
         (video_id, channel_id, discovered_by_run_id, title, published_at, status,
          intent, window_started_at, window_deadline_at, next_attempt_at, attempt_count,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 'publish', ?, ?, ?, 0, ?, ?)`,
      entry.videoId,
      channelId,
      runId,
      entry.title,
      entry.publishedAt,
      now,
      now + PROCESSING_WINDOW_MS,
      now,
      now,
      now,
    );
  }
}

/** Records the generation a new attempt will stage and counts the launch (rule 13). */
export function openStaged(
  sql: SqlStorage,
  videoId: string,
  generationId: string,
  now: number,
): void {
  sql.exec(
    `UPDATE episodes SET staged_vector_generation = ?, attempt_count = attempt_count + 1, updated_at = ?
     WHERE video_id = ?`,
    generationId,
    now,
    videoId,
  );
}

export function scheduleNextAttempt(
  sql: SqlStorage,
  videoId: string,
  nextAttemptAt: number,
  now: number,
): void {
  sql.exec(
    "UPDATE episodes SET next_attempt_at = ?, updated_at = ? WHERE video_id = ?",
    nextAttemptAt,
    now,
    videoId,
  );
}

const CLOSE_WINDOW = `intent = NULL, window_started_at = NULL, window_deadline_at = NULL,
  next_attempt_at = NULL, staged_vector_generation = NULL`;

/** Closes the window and forgets the staged generation; content state is untouched. */
export function closeWindow(
  sql: SqlStorage,
  videoId: string,
  now: number,
): void {
  sql.exec(
    `UPDATE episodes SET ${CLOSE_WINDOW}, updated_at = ? WHERE video_id = ?`,
    now,
    videoId,
  );
}

/** A deterministic result under intent `publish`: skipped, reversibly, with the window closed (rule 12). */
export function markSkipped(
  sql: SqlStorage,
  videoId: string,
  reason: "SHORT" | "NON_ENGLISH" | "UNPLAYABLE",
  now: number,
): void {
  sql.exec(
    `UPDATE episodes SET status = 'skipped', skip_reason = ?, skipped_at = ?, skipped_by_email = NULL,
       failure_code = NULL, failure_detail = NULL, ${CLOSE_WINDOW}, updated_at = ?
     WHERE video_id = ?`,
    reason,
    now,
    now,
    videoId,
  );
}

/** A publication that exhausted its window: the one time `failure_code` is written (rule 14). */
export function markTimedOut(
  sql: SqlStorage,
  videoId: string,
  detail: string,
  now: number,
): void {
  sql.exec(
    `UPDATE episodes SET status = 'failed', failure_code = 'INGESTION_TIMEOUT', failure_detail = ?,
       skip_reason = NULL, skipped_at = NULL, skipped_by_email = NULL, ${CLOSE_WINDOW}, updated_at = ?
     WHERE video_id = ?`,
    detail,
    now,
    videoId,
  );
}

/**
 * The provider answered about this video (a transcript result or a deterministic classification).
 * A known runtime is kept: `durationSec` is null for a deterministic answer that never fetched a
 * transcript, and a later null must not erase what an earlier attempt learned.
 */
export function markTranscriptChecked(
  sql: SqlStorage,
  videoId: string,
  durationSec: number | null,
  now: number,
): void {
  sql.exec(
    `UPDATE episodes SET transcript_checked_at = ?, duration_sec = COALESCE(?, duration_sec),
       updated_at = ? WHERE video_id = ?`,
    now,
    durationSec === null ? null : Math.round(durationSec),
    now,
    videoId,
  );
}

/**
 * Publication (rules 25–26): the staged generation becomes active, the window closes, `processed_at`
 * is set only when null so first availability is never reset. The summary row is written beside it
 * by `summaries.ts`, in the same transaction.
 */
export function publish(
  sql: SqlStorage,
  videoId: string,
  chunkCount: number,
  now: number,
): void {
  sql.exec(
    `UPDATE episodes SET status = 'available', chunk_count = ?, vectorized_at = ?,
       processed_at = COALESCE(processed_at, ?), transcript_checked_at = ?,
       active_vector_generation = staged_vector_generation,
       failure_code = NULL, failure_detail = NULL, skip_reason = NULL, skipped_at = NULL, skipped_by_email = NULL,
       ${CLOSE_WINDOW}, updated_at = ?
     WHERE video_id = ?`,
    chunkCount,
    now,
    now,
    now,
    now,
    videoId,
  );
}

/** Episodes by id, in the order given, with processing detail and no related titles. */
export function listByVideoIds(
  sql: SqlStorage,
  videoIds: readonly string[],
): EpisodeRecord[] {
  const rows: EpisodeRow[] = [];
  for (const batch of chunk(videoIds)) {
    rows.push(
      ...sql
        .exec<EpisodeRow>(
          `${EPISODE_SELECT} WHERE e.video_id IN (${placeholders(batch.length)})`,
          ...batch,
        )
        .toArray(),
    );
  }
  const order = new Map(videoIds.map((id, index) => [id, index]));
  rows.sort(
    (a, b) => (order.get(a.video_id) ?? 0) - (order.get(b.video_id) ?? 0),
  );
  return complete(sql, rows, []);
}

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

/** Five bindings can join the channel list (`from`, `to`, two for the cursor, `limit`). */
const DIGEST_CHANNEL_BATCH = MAX_BOUND_PARAMS - 5;
const DIGEST_ORDER = "ORDER BY e.processed_at DESC, e.video_id LIMIT ?";
const DIGEST_JOIN = `FROM episodes e
  LEFT JOIN episode_summaries s ON s.video_id = e.video_id`;

/**
 * The digest's selection as SQL: an available episode with a stored summary, in this batch of
 * channels, inside the range, strictly after the cursor position in availability order.
 */
function digestClause(
  selection: DigestSelection,
  batch: readonly string[],
): { where: string; params: (string | number)[] } {
  const conditions = [
    "e.status = 'available'",
    "s.video_id IS NOT NULL",
    "e.processed_at IS NOT NULL",
    `e.channel_id IN (${placeholders(batch.length)})`,
  ];
  const params: (string | number)[] = [...batch];
  if (selection.fromMs !== null) {
    conditions.push("e.processed_at >= ?");
    params.push(selection.fromMs);
  }
  if (selection.toMs !== null) {
    // Exclusive, so a reader's consecutive local days never claim the same summary twice.
    conditions.push("e.processed_at < ?");
    params.push(selection.toMs);
  }
  if (selection.after !== null) {
    conditions.push(
      "(e.processed_at < ? OR (e.processed_at = ? AND e.video_id > ?))",
    );
    params.push(
      selection.after.summaryAvailableAt,
      selection.after.summaryAvailableAt,
      selection.after.videoId,
    );
  }
  return { where: conditions.join(" AND "), params };
}

/**
 * One digest page: available episodes with a stored summary, selected and ordered by first
 * availability (`processed_at`, the API's `summaryAvailableAt`) newest first with `video_id` as the
 * only tiebreak (docs/PRD.md §4.4). Publication time is metadata here, never the basis. Each batch
 * of channels is ordered and limited in SQL, then merged, so a wide follow list still reads one
 * page. Related titles are resolved within the same channels.
 */
export function listDigest(
  sql: SqlStorage,
  channelIds: readonly string[],
  selection: DigestSelection,
): EpisodeRecord[] {
  const rows: EpisodeRow[] = [];
  for (const batch of chunk(channelIds, DIGEST_CHANNEL_BATCH)) {
    const { where, params } = digestClause(selection, batch);
    rows.push(
      ...sql
        .exec<EpisodeRow>(
          `${EPISODE_SELECT} WHERE ${where} ${DIGEST_ORDER}`,
          ...params,
          selection.limit,
        )
        .toArray(),
    );
  }
  rows.sort(byAvailability);
  return complete(sql, rows.slice(0, selection.limit), channelIds);
}

/**
 * The same page as rows: no summary, no related titles, no attempt. The calendar reads five weeks
 * this way, which is the widest read in the product (docs/specs/design-phase-plan.md, Risks).
 */
export function listDigestRows(
  sql: SqlStorage,
  channelIds: readonly string[],
  selection: DigestSelection,
): DigestRowRecord[] {
  const rows: { video_id: string; channel_id: string; processed_at: number }[] =
    [];
  for (const batch of chunk(channelIds, DIGEST_CHANNEL_BATCH)) {
    const { where, params } = digestClause(selection, batch);
    rows.push(
      ...sql
        .exec<{ video_id: string; channel_id: string; processed_at: number }>(
          `SELECT e.video_id, e.channel_id, e.processed_at ${DIGEST_JOIN}
           WHERE ${where} ${DIGEST_ORDER}`,
          ...params,
          selection.limit,
        )
        .toArray(),
    );
  }
  rows.sort(byAvailability);
  return rows.slice(0, selection.limit).map((row) => ({
    videoId: row.video_id,
    channelId: row.channel_id,
    summaryAvailableAt: row.processed_at,
  }));
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

/**
 * The recovery tick's selection (docs/specs/m3-6-recovery.md §2): every episode whose open window
 * says its next attempt is due and that has no attempt running, in every channel status and pause
 * state. Due order, then video id, so one tick's stagger is deterministic. No related titles.
 */
export function listDue(sql: SqlStorage, now: number): EpisodeRecord[] {
  const rows = sql
    .exec<EpisodeRow>(
      `${EPISODE_SELECT}
       WHERE e.intent IS NOT NULL AND e.next_attempt_at IS NOT NULL AND e.next_attempt_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM episode_ingestion_attempts a
           WHERE a.video_id = e.video_id AND a.status = 'running'
         )
       ORDER BY e.next_attempt_at, e.video_id`,
      now,
    )
    .toArray();
  return complete(sql, rows, []);
}

/**
 * One episode of one channel, with processing detail. Related titles are resolved only within
 * `relatedScope`, the caller's eligible channels; the empty default is the ingestion paths, which
 * never show them.
 */
export function getEpisode(
  sql: SqlStorage,
  channelId: string,
  videoId: string,
  relatedScope: readonly string[] = [],
): EpisodeRecord | null {
  const row = sql
    .exec<EpisodeRow>(
      `${EPISODE_SELECT} WHERE e.channel_id = ? AND e.video_id = ?`,
      channelId,
      videoId,
    )
    .toArray()[0];
  return row ? (complete(sql, [row], relatedScope)[0] ?? null) : null;
}

/**
 * Retry opens a fresh 48-hour window (docs/PRD.md §4.2 rule 16): a `pending`, `failed`, or `skipped`
 * episode returns to `pending` with intent `publish`; an `available` one gets intent `replace`, its
 * summary, active generation, and first availability untouched.
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
  const deadline = now + PROCESSING_WINDOW_MS;
  if (episode.status === "available") {
    sql.exec(
      `UPDATE episodes SET intent = 'replace', window_started_at = ?, window_deadline_at = ?,
         next_attempt_at = ?, attempt_count = 0, staged_vector_generation = NULL, updated_at = ?
       WHERE video_id = ?`,
      now,
      deadline,
      now,
      now,
      videoId,
    );
  } else {
    sql.exec(
      `UPDATE episodes SET status = 'pending', intent = 'publish', window_started_at = ?,
         window_deadline_at = ?, next_attempt_at = ?, attempt_count = 0, failure_code = NULL,
         failure_detail = NULL, skip_reason = NULL, skipped_at = NULL, skipped_by_email = NULL,
         staged_vector_generation = NULL, updated_at = ?
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

/**
 * Newest first availability first; `video_id` breaks ties so the order is stable (docs/PRD.md §4.4).
 * The cursor encodes exactly this pair, so merging batches here matches what SQL ordered.
 */
function byAvailability(
  a: { processed_at: number | null; video_id: string },
  b: { processed_at: number | null; video_id: string },
): number {
  return (
    (b.processed_at ?? 0) - (a.processed_at ?? 0) ||
    a.video_id.localeCompare(b.video_id)
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
      intent: toIntent(row.intent),
      windowStartedAt: row.window_started_at,
      windowDeadlineAt: row.window_deadline_at,
      nextAttemptAt: row.next_attempt_at,
      attemptCount: row.attempt_count,
      latestAttempt,
      failureCode: toFailureCode(row.failure_code),
      failureDetail: row.failure_detail,
      skippedAt: row.skipped_at,
      skippedByEmail: row.skipped_by_email,
      transcriptCheckedAt: row.transcript_checked_at,
      durationSec: row.duration_sec,
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

function toIntent(value: string | null): ProcessingIntent | null {
  if (value === null || value === "publish" || value === "replace") {
    return value;
  }
  throw new Error(`unexpected episodes.intent: ${value}`);
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
