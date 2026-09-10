import { chunk, placeholders } from "../../lib/sql";
import { getChannel, requireChannel, setPause } from "./channels";
import type { CatalogChannel, FollowerRecord } from "./types";

/**
 * Who follows what, shared with the Registry so it can list requesters, count followers, and pause a
 * channel nobody follows (docs/specs/channel-simplification.md §3.2). The User DO's channel_follows is
 * the source of truth for the user's own list; the follow routes keep the two in step.
 */
export function recordFollow(
  sql: SqlStorage,
  channelId: string,
  email: string,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  sql.exec(
    `INSERT INTO channel_followers (channel_id, user_email, followed_at, unfollowed_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)
     ON CONFLICT (channel_id, user_email) DO UPDATE
       SET followed_at = CASE WHEN unfollowed_at IS NULL THEN followed_at ELSE excluded.followed_at END,
           unfollowed_at = NULL, updated_at = excluded.updated_at`,
    channel.channelId,
    email,
    now,
    now,
    now,
  );
  // A follow lifts a system pause; an owner pause needs the owner.
  if (channel.pausedBy === "system")
    return setPause(sql, channel.channelId, null, now);
  return channel;
}

export function recordUnfollow(
  sql: SqlStorage,
  channelId: string,
  email: string,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  sql.exec(
    `UPDATE channel_followers SET unfollowed_at = ?, updated_at = ?
     WHERE channel_id = ? AND user_email = ? AND unfollowed_at IS NULL`,
    now,
    now,
    channel.channelId,
    email,
  );
  // The last follower leaving pauses an approved channel, unless the owner already paused it.
  const active =
    countActiveByChannel(sql, [channel.channelId])[channel.channelId] ?? 0;
  if (
    active === 0 &&
    channel.status === "approved" &&
    channel.pausedBy === null
  ) {
    return setPause(sql, channel.channelId, "system", now);
  }
  return getChannel(sql, channel.channelId) ?? channel;
}

/** Active followers per channel, zero-filled for every requested id. */
export function countActiveByChannel(
  sql: SqlStorage,
  channelIds: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of channelIds) counts[id] = 0;
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<{ channel_id: string; n: number }>(
      `SELECT channel_id, COUNT(*) AS n FROM channel_followers
       WHERE unfollowed_at IS NULL AND channel_id IN (${placeholders(batch.length)}) GROUP BY channel_id`,
      ...batch,
    )) {
      counts[row.channel_id] = row.n;
    }
  }
  return counts;
}

/** Active followers of one channel, oldest first; the owner queue shows these. */
export function listActive(
  sql: SqlStorage,
  channelId: string,
): FollowerRecord[] {
  return sql
    .exec<{ user_email: string; followed_at: number }>(
      `SELECT user_email, followed_at FROM channel_followers
       WHERE channel_id = ? AND unfollowed_at IS NULL ORDER BY followed_at, user_email`,
      channelId,
    )
    .toArray()
    .map((row) => ({ email: row.user_email, followedAt: row.followed_at }));
}
