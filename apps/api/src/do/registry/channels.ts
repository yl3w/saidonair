import type { ChannelStatus, PausedBy } from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import { requireChannelId } from "../../lib/youtube/ids";
import type { CatalogChannel, CreateChannelInput, ReviewInput } from "./types";

type ChannelRow = {
  channel_id: string;
  title: string;
  canonical_url: string;
  status: string;
  initial_import_count: number;
  approved_at: number | null;
  reviewed_at: number | null;
  reviewed_by_email: string | null;
  review_note: string | null;
  paused_by: string | null;
  paused_at: number | null;
  last_checked_at: number | null;
  last_ingested_at: number | null;
  lifecycle_version: number;
  created_at: number;
  updated_at: number;
};

const CHANNEL_COLUMNS = `channel_id, title, canonical_url, status, initial_import_count, approved_at,
  reviewed_at, reviewed_by_email, review_note, paused_by, paused_at, last_checked_at,
  last_ingested_at, lifecycle_version, created_at, updated_at`;

export function canonicalChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export function getChannel(
  sql: SqlStorage,
  channelId: string,
): CatalogChannel | null {
  const row = sql
    .exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels WHERE channel_id = ?`,
      channelId,
    )
    .toArray()[0];
  return row ? toChannel(row) : null;
}

/** Owner view: every status, newest first. */
export function listChannels(sql: SqlStorage): CatalogChannel[] {
  return sql
    .exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels ORDER BY created_at DESC, channel_id`,
    )
    .toArray()
    .map(toChannel);
}

/** Channels by id in any status, including declined; ids that do not exist are simply absent. */
export function listChannelsByIds(
  sql: SqlStorage,
  channelIds: readonly string[],
): CatalogChannel[] {
  const found: CatalogChannel[] = [];
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels
       WHERE channel_id IN (${placeholders(batch.length)})`,
      ...batch,
    )) {
      found.push(toChannel(row));
    }
  }
  return found.sort(
    (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.channelId.localeCompare(b.channelId),
  );
}

/** The browsable catalog: requested and approved, title order. Declined channels are reachable by id only. */
export function listCatalogChannels(sql: SqlStorage): CatalogChannel[] {
  return sql
    .exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels
       WHERE status IN ('requested', 'approved')
       ORDER BY title COLLATE NOCASE, channel_id`,
    )
    .toArray()
    .map(toChannel);
}

/**
 * Creates a channel; `INVALID_STATE` when the id exists in any status. Create-only on purpose
 * (db26c74): the route treats that refusal as "exists" and follows or reopens instead.
 */
export function createChannel(
  sql: SqlStorage,
  input: CreateChannelInput,
  now: number,
): CatalogChannel {
  const channelId = requireChannelId(input.channelId);
  if (getChannel(sql, channelId)) {
    throw new DomainError("INVALID_STATE", "channel is already in the catalog");
  }
  const approved = input.status === "approved";
  if (approved && !input.reviewer) {
    throw new DomainError(
      "INVALID_INPUT",
      "an approved channel needs a reviewer",
    );
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `INSERT INTO channels (channel_id, title, canonical_url, status, initial_import_count,
           approved_at, reviewed_at, reviewed_by_email, lifecycle_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, COALESCE(?, 5), ?, ?, ?, 1, ?, ?)
         RETURNING ${CHANNEL_COLUMNS}`,
        channelId,
        requireTitle(input.title),
        canonicalChannelUrl(channelId),
        input.status,
        optionalImportCount(input.initialImportCount),
        approved ? now : null,
        approved ? now : null,
        approved ? (input.reviewer ?? null) : null,
        now,
        now,
      )
      .one(),
  );
}

/** `requested | declined → approved`. Sets approved_at once; the caller starts the import only when it was null. */
export function approveChannel(
  sql: SqlStorage,
  channelId: string,
  reviewer: string,
  input: ReviewInput,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status === "approved") {
    throw new DomainError("INVALID_STATE", "channel is already approved");
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET status = 'approved', title = COALESCE(?, title),
             initial_import_count = COALESCE(?, initial_import_count),
             approved_at = COALESCE(approved_at, ?), reviewed_at = ?, reviewed_by_email = ?,
             review_note = ?, paused_by = NULL, paused_at = NULL, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        optionalTitle(input.title),
        optionalImportCount(input.initialImportCount),
        now,
        now,
        reviewer,
        optionalNote(input.explanation),
        now,
        channel.channelId,
      )
      .one(),
  );
}

/** `requested | approved → declined`. From approved, bumps the fence so a run in flight publishes nothing. */
export function declineChannel(
  sql: SqlStorage,
  channelId: string,
  reviewer: string,
  input: ReviewInput,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status === "declined") {
    throw new DomainError("INVALID_STATE", "channel is already declined");
  }
  const bump = channel.status === "approved" ? 1 : 0;
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET status = 'declined', reviewed_at = ?, reviewed_by_email = ?, review_note = ?,
             paused_by = NULL, paused_at = NULL, lifecycle_version = lifecycle_version + ?, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        now,
        reviewer,
        optionalNote(input.explanation),
        bump,
        now,
        channel.channelId,
      )
      .one(),
  );
}

/** `declined → requested`, keeping the review fields so the queue can show them. */
export function requestChannel(
  sql: SqlStorage,
  channelId: string,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status !== "declined") {
    throw new DomainError(
      "INVALID_STATE",
      `only a declined channel can be requested again (status: ${channel.status})`,
    );
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels SET status = 'requested', updated_at = ? WHERE channel_id = ? RETURNING ${CHANNEL_COLUMNS}`,
        now,
        channel.channelId,
      )
      .one(),
  );
}

/** Sets or clears the pause on an approved channel. Idempotent. */
export function setPause(
  sql: SqlStorage,
  channelId: string,
  pausedBy: PausedBy | null,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status !== "approved") {
    throw new DomainError(
      "INVALID_STATE",
      "only approved channels can be paused or resumed",
    );
  }
  if (channel.pausedBy === pausedBy) return channel;
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels SET paused_by = ?, paused_at = ?, updated_at = ? WHERE channel_id = ? RETURNING ${CHANNEL_COLUMNS}`,
        pausedBy,
        pausedBy === null ? null : now,
        now,
        channel.channelId,
      )
      .one(),
  );
}

export function requireChannel(
  sql: SqlStorage,
  channelId: string,
): CatalogChannel {
  const channel = getChannel(sql, requireChannelId(channelId));
  if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
  return channel;
}

function requireTitle(raw: string): string {
  const title = raw.trim();
  if (title.length === 0) {
    throw new DomainError("INVALID_INPUT", "title is required");
  }
  return title;
}

function optionalImportCount(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "initialImportCount must be a positive integer",
    );
  }
  return value;
}

function optionalTitle(value: string | undefined): string | null {
  const title = value?.trim();
  return title ? title : null;
}

function optionalNote(value: string | undefined): string | null {
  const note = value?.trim();
  return note ? note : null;
}

function toChannel(row: ChannelRow): CatalogChannel {
  return {
    channelId: row.channel_id,
    title: row.title,
    canonicalUrl: row.canonical_url,
    status: toStatus(row.status),
    initialImportCount: row.initial_import_count,
    approvedAt: row.approved_at,
    reviewedAt: row.reviewed_at,
    reviewedByEmail: row.reviewed_by_email,
    reviewNote: row.review_note,
    pausedBy: toPausedBy(row.paused_by),
    pausedAt: row.paused_at,
    lastCheckedAt: row.last_checked_at,
    lastIngestedAt: row.last_ingested_at,
    lifecycleVersion: row.lifecycle_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStatus(value: string): ChannelStatus {
  if (value === "requested" || value === "approved" || value === "declined") {
    return value;
  }
  throw new Error(`unexpected channels.status: ${value}`);
}

function toPausedBy(value: string | null): PausedBy | null {
  if (value === null || value === "owner" || value === "system") return value;
  throw new Error(`unexpected channels.paused_by: ${value}`);
}
