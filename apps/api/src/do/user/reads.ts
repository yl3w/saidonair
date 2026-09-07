import { chunk, placeholders } from "../../lib/sql";
import { requireVideoId } from "../../lib/youtube/ids";

/**
 * Records read receipts for summaries actually returned to this user. Existing receipts
 * keep their original read_at. Returns how many were newly recorded; RETURNING yields only
 * inserted rows, whereas `rowsWritten` also counts index writes.
 */
export function markRead(
  sql: SqlStorage,
  videoIds: readonly string[],
  now: number,
): number {
  let marked = 0;
  for (const videoId of uniqueVideoIds(videoIds)) {
    marked += sql
      .exec(
        `INSERT OR IGNORE INTO summary_reads (video_id, read_at, created_at)
         VALUES (?, ?, ?)
         RETURNING video_id`,
        videoId,
        now,
        now,
      )
      .toArray().length;
  }
  return marked;
}

/** The subset of `videoIds` this user has already read. Callers derive unread state. */
export function readVideoIds(
  sql: SqlStorage,
  videoIds: readonly string[],
): string[] {
  const read: string[] = [];
  for (const batch of chunk(uniqueVideoIds(videoIds))) {
    for (const row of sql.exec<{ video_id: string }>(
      `SELECT video_id FROM summary_reads WHERE video_id IN (${placeholders(batch.length)})`,
      ...batch,
    )) {
      read.push(row.video_id);
    }
  }
  return read.sort();
}

function uniqueVideoIds(videoIds: readonly string[]): string[] {
  return [...new Set(videoIds.map(requireVideoId))];
}
