import { chunk, placeholders } from "../../lib/sql";
import { requireEpisodeId } from "../../lib/youtube/ids";

/**
 * Records read receipts for summaries actually returned to this user. Existing receipts
 * keep their original read_at. Returns how many were newly recorded; RETURNING yields only
 * inserted rows, whereas `rowsWritten` also counts index writes.
 */
export function markRead(
  sql: SqlStorage,
  episodeIds: readonly string[],
  now: number,
): number {
  let marked = 0;
  for (const episodeId of uniqueEpisodeIds(episodeIds)) {
    marked += sql
      .exec(
        `INSERT OR IGNORE INTO summary_reads (episode_id, read_at, created_at)
         VALUES (?, ?, ?)
         RETURNING episode_id`,
        episodeId,
        now,
        now,
      )
      .toArray().length;
  }
  return marked;
}

/**
 * Removes this user's receipts for the given summaries, so they read as unread again. Returns how
 * many rows went; a video with no receipt is simply absent. Undo lives in History (docs/PRD.md §4.4).
 */
export function clearRead(
  sql: SqlStorage,
  episodeIds: readonly string[],
): number {
  let cleared = 0;
  for (const episodeId of uniqueEpisodeIds(episodeIds)) {
    cleared += sql
      .exec(
        "DELETE FROM summary_reads WHERE episode_id = ? RETURNING episode_id",
        episodeId,
      )
      .toArray().length;
  }
  return cleared;
}

/** The subset of `episodeIds` this user has already read. Callers derive unread state. */
export function readEpisodeIds(
  sql: SqlStorage,
  episodeIds: readonly string[],
): string[] {
  const read: string[] = [];
  for (const batch of chunk(uniqueEpisodeIds(episodeIds))) {
    for (const row of sql.exec<{ episode_id: string }>(
      `SELECT episode_id FROM summary_reads WHERE episode_id IN (${placeholders(batch.length)})`,
      ...batch,
    )) {
      read.push(row.episode_id);
    }
  }
  return read.sort();
}

function uniqueEpisodeIds(episodeIds: readonly string[]): string[] {
  return [...new Set(episodeIds.map(requireEpisodeId))];
}
