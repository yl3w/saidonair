import { DomainError } from "../../lib/errors";
import { requireChannelId } from "../../lib/youtube/ids";
import type { ChannelFollow, ListFollowsOptions } from "./types";

type FollowRow = {
  channel_id: string;
  followed_at: number;
  unfollowed_at: number | null;
  created_at: number;
  updated_at: number;
};

const FOLLOW_COLUMNS = `channel_id, followed_at, unfollowed_at, created_at, updated_at`;

/**
 * Explicit follow or refollow. Eligibility (the channel's status) is the caller's responsibility
 * via the Registry; this only owns the row semantics. Idempotent on an active follow; a tombstone
 * is cleared.
 */
export function follow(
  sql: SqlStorage,
  channelId: string,
  now: number,
): ChannelFollow {
  const id = requireChannelId(channelId);
  const existing = getFollow(sql, id);
  if (existing && existing.unfollowedAt === null) return existing;
  if (!existing) {
    return toFollow(
      sql
        .exec<FollowRow>(
          `INSERT INTO channel_follows (channel_id, followed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           RETURNING ${FOLLOW_COLUMNS}`,
          id,
          now,
          now,
          now,
        )
        .one(),
    );
  }
  return toFollow(
    sql
      .exec<FollowRow>(
        `UPDATE channel_follows
         SET followed_at = ?, unfollowed_at = NULL, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${FOLLOW_COLUMNS}`,
        now,
        now,
        id,
      )
      .one(),
  );
}

/** Retains a tombstone; never deletes the row. Idempotent once unfollowed. */
export function unfollow(
  sql: SqlStorage,
  channelId: string,
  now: number,
): ChannelFollow {
  const id = requireChannelId(channelId);
  const existing = getFollow(sql, id);
  if (!existing) throw new DomainError("NOT_FOUND", "channel is not followed");
  if (existing.unfollowedAt !== null) return existing;
  return toFollow(
    sql
      .exec<FollowRow>(
        `UPDATE channel_follows SET unfollowed_at = ?, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${FOLLOW_COLUMNS}`,
        now,
        now,
        id,
      )
      .one(),
  );
}

export function getFollow(
  sql: SqlStorage,
  channelId: string,
): ChannelFollow | null {
  const row = sql
    .exec<FollowRow>(
      `SELECT ${FOLLOW_COLUMNS} FROM channel_follows WHERE channel_id = ?`,
      channelId,
    )
    .toArray()[0];
  return row ? toFollow(row) : null;
}

export function listFollows(
  sql: SqlStorage,
  options: ListFollowsOptions = {},
): ChannelFollow[] {
  const where = options.includeUnfollowed ? "" : "WHERE unfollowed_at IS NULL";
  return sql
    .exec<FollowRow>(
      `SELECT ${FOLLOW_COLUMNS} FROM channel_follows ${where}
       ORDER BY followed_at DESC, channel_id`,
    )
    .toArray()
    .map(toFollow);
}

/** Channel ids currently followed; chat eligibility intersects this with the Registry. */
export function activeChannelIds(sql: SqlStorage): string[] {
  return sql
    .exec<{ channel_id: string }>(
      `SELECT channel_id FROM channel_follows WHERE unfollowed_at IS NULL
       ORDER BY channel_id`,
    )
    .toArray()
    .map((row) => row.channel_id);
}

function toFollow(row: FollowRow): ChannelFollow {
  return {
    channelId: row.channel_id,
    followedAt: row.followed_at,
    unfollowedAt: row.unfollowed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
