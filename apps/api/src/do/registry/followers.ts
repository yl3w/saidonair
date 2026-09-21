import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import {
  type ChannelRow,
  requireChannel,
  setPause,
  toChannel,
} from "./channels";
import type { CatalogChannel, FollowerRecord, FollowRecord } from "./types";

/**
 * The one record of who follows what (docs/PRD.md §4.3, decided 2026-09-13): one row per channel
 * and user serves the user's own list, `following`, the follower count, the owner's queue, the
 * automatic pause, and eligibility. Nothing is copied anywhere else, so nothing can drift.
 */

type FollowRow = {
  channel_id: string;
  followed_at: number;
  unfollowed_at: number | null;
};

const FOLLOW_COLUMNS = "channel_id, followed_at, unfollowed_at";

/**
 * Follow or refollow. Idempotent on an active row; a tombstone is cleared and adopts the new
 * `followed_at`. A follow lifts a system pause; an owner pause needs the owner.
 */
export function recordFollow(
  sql: SqlStorage,
  channelId: string,
  userId: string,
  now: number,
): FollowRecord {
  const channel = requireChannel(sql, channelId);
  const row = sql
    .exec<FollowRow>(
      `INSERT INTO channel_followers (channel_id, user_id, followed_at, unfollowed_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT (channel_id, user_id) DO UPDATE
         SET followed_at = CASE WHEN unfollowed_at IS NULL THEN followed_at ELSE excluded.followed_at END,
             unfollowed_at = NULL, updated_at = excluded.updated_at
       RETURNING ${FOLLOW_COLUMNS}`,
      channel.channelId,
      userId,
      now,
      now,
      now,
    )
    .one();
  if (channel.pausedBy === "system")
    setPause(sql, channel.channelId, null, now);
  return toFollow(row);
}

/**
 * Unfollow, retaining a tombstone. `NOT_FOUND` when the user never followed the channel; idempotent
 * on a tombstone. The last active follower leaving pauses an approved channel, unless the owner
 * already paused it.
 */
export function recordUnfollow(
  sql: SqlStorage,
  channelId: string,
  userId: string,
  now: number,
): FollowRecord {
  const channel = requireChannel(sql, channelId);
  const existing = getFollow(sql, channel.channelId, userId);
  if (!existing) throw new DomainError("NOT_FOUND", "channel is not followed");
  if (existing.unfollowedAt !== null) return existing;
  const row = sql
    .exec<FollowRow>(
      `UPDATE channel_followers SET unfollowed_at = ?, updated_at = ?
       WHERE channel_id = ? AND user_id = ?
       RETURNING ${FOLLOW_COLUMNS}`,
      now,
      now,
      channel.channelId,
      userId,
    )
    .one();
  const active =
    countActiveByChannel(sql, [channel.channelId])[channel.channelId] ?? 0;
  if (
    active === 0 &&
    channel.status === "approved" &&
    channel.pausedBy === null
  ) {
    setPause(sql, channel.channelId, "system", now);
  }
  return toFollow(row);
}

/** One user's row for one channel, active or tombstone; null when they never followed it. */
export function getFollow(
  sql: SqlStorage,
  channelId: string,
  userId: string,
): FollowRecord | null {
  const row = sql
    .exec<FollowRow>(
      `SELECT ${FOLLOW_COLUMNS} FROM channel_followers WHERE channel_id = ? AND user_id = ?`,
      channelId,
      userId,
    )
    .toArray()[0];
  return row ? toFollow(row) : null;
}

/** A user's own list: active follows, newest first. */
export function listByUser(sql: SqlStorage, userId: string): FollowRecord[] {
  return sql
    .exec<FollowRow>(
      `SELECT ${FOLLOW_COLUMNS} FROM channel_followers
       WHERE user_id = ? AND unfollowed_at IS NULL
       ORDER BY followed_at DESC, channel_id`,
      userId,
    )
    .toArray()
    .map(toFollow);
}

/** The channel ids a user actively follows, sorted. */
export function activeChannelIds(sql: SqlStorage, userId: string): string[] {
  return sql
    .exec<{ channel_id: string }>(
      `SELECT channel_id FROM channel_followers
       WHERE user_id = ? AND unfollowed_at IS NULL ORDER BY channel_id`,
      userId,
    )
    .toArray()
    .map((row) => row.channel_id);
}

/**
 * The one implementation of eligibility (docs/PRD.md §4.3, hard rule 3): the channels a user may
 * read from are their active follows that are approved, paused or not. Requested channels have no
 * content yet and declined ones are excluded by status. Title order, as the catalog lists.
 */
export function listEligible(
  sql: SqlStorage,
  userId: string,
): CatalogChannel[] {
  return sql
    .exec<ChannelRow>(
      `SELECT c.* FROM channel_followers f
       JOIN channels c ON c.channel_id = f.channel_id
       WHERE f.user_id = ? AND f.unfollowed_at IS NULL AND c.status = 'approved'
       ORDER BY c.title COLLATE NOCASE, c.channel_id`,
      userId,
    )
    .toArray()
    .map(toChannel);
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

/**
 * Active followers of one channel, oldest first; the owner queue shows these. The row carries a
 * `user_id`, so the address the screen prints is joined rather than stored — an address that
 * changes cannot leave a stale copy behind here. The tiebreak is the email, not the id, because
 * a random id would order the screen arbitrarily.
 */
export function listActive(
  sql: SqlStorage,
  channelId: string,
): FollowerRecord[] {
  return sql
    .exec<{ user_id: string; email: string; followed_at: number }>(
      `SELECT f.user_id, u.email AS email, f.followed_at FROM channel_followers f
       JOIN global_users u ON u.user_id = f.user_id
       WHERE f.channel_id = ? AND f.unfollowed_at IS NULL
       ORDER BY f.followed_at, u.email`,
      channelId,
    )
    .toArray()
    .map((row) => ({
      userId: row.user_id,
      email: row.email,
      followedAt: row.followed_at,
    }));
}

function toFollow(row: FollowRow): FollowRecord {
  return {
    channelId: row.channel_id,
    followedAt: row.followed_at,
    unfollowedAt: row.unfollowed_at,
  };
}
