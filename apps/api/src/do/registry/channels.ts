import type { ChannelFailureCode, ChannelStatus } from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import { requireChannelId } from "../../lib/youtube/ids";
import type { CatalogChannel, ConfigureChannelInput } from "./types";

type ChannelRow = {
  channel_id: string;
  title: string;
  canonical_url: string;
  status: string;
  initial_import_count: number;
  failure_code: string | null;
  failure_detail: string | null;
  available_at: number | null;
  last_checked_at: number | null;
  last_ingested_at: number | null;
  deleted_at: number | null;
  lifecycle_version: number;
  created_at: number;
  updated_at: number;
};

const CHANNEL_COLUMNS = `channel_id, title, canonical_url, status, initial_import_count,
  failure_code, failure_detail, available_at, last_checked_at, last_ingested_at, deleted_at,
  lifecycle_version, created_at, updated_at`;

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

/** Owner view: every state, including deleted, newest first. */
export function listChannels(sql: SqlStorage): CatalogChannel[] {
  return sql
    .exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels ORDER BY created_at DESC, channel_id`,
    )
    .toArray()
    .map(toChannel);
}

/** Channels by id in any state, including deleted; ids that do not exist are simply absent. */
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

/** The followable catalog: available and not deleted. */
export function listAvailableChannels(sql: SqlStorage): CatalogChannel[] {
  return sql
    .exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels
       WHERE status = 'available' AND deleted_at IS NULL
       ORDER BY title COLLATE NOCASE, channel_id`,
    )
    .toArray()
    .map(toChannel);
}

/** Creates a `pending` channel. Callers decide whether to start initial ingestion. */
export function createChannel(
  sql: SqlStorage,
  input: ConfigureChannelInput,
  now: number,
): CatalogChannel {
  const channelId = requireChannelId(input.channelId);
  const title = requireTitle(input.title);
  const importCount = optionalImportCount(input.initialImportCount);
  return toChannel(
    sql
      .exec<ChannelRow>(
        `INSERT INTO channels (channel_id, title, canonical_url, status, initial_import_count,
           lifecycle_version, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', COALESCE(?, 5), 1, ?, ?)
         RETURNING ${CHANNEL_COLUMNS}`,
        channelId,
        title,
        canonicalChannelUrl(channelId),
        importCount,
        now,
        now,
      )
      .one(),
  );
}

/**
 * Owner configuration: create the channel, or update the owner-configurable fields of an
 * existing one without touching its processing state or deletion.
 */
export function configureChannel(
  sql: SqlStorage,
  input: ConfigureChannelInput,
  now: number,
): { channel: CatalogChannel; created: boolean } {
  const channelId = requireChannelId(input.channelId);
  if (!getChannel(sql, channelId)) {
    return { channel: createChannel(sql, input, now), created: true };
  }
  const title = requireTitle(input.title);
  const importCount = optionalImportCount(input.initialImportCount);
  const channel = toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET title = ?, initial_import_count = COALESCE(?, initial_import_count), updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        title,
        importCount,
        now,
        channelId,
      )
      .one(),
  );
  return { channel, created: false };
}

/**
 * `failed → pending` for an owner retry. Clears the current failure (history stays in
 * ingestion_runs) and bumps lifecycle_version so stale runs are fenced out.
 */
export function retryChannel(
  sql: SqlStorage,
  channelId: string,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.deletedAt !== null) {
    throw new DomainError(
      "INVALID_STATE",
      "channel is deleted; restore it first",
    );
  }
  if (channel.status !== "failed") {
    throw new DomainError(
      "INVALID_STATE",
      `only failed channels can be retried (status: ${channel.status})`,
    );
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET status = 'pending', failure_code = NULL, failure_detail = NULL,
             lifecycle_version = lifecycle_version + 1, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        now,
        channel.channelId,
      )
      .one(),
  );
}

/** Soft delete. Idempotent: deleting a deleted channel changes nothing (no extra fence bump). */
export function deleteChannel(
  sql: SqlStorage,
  channelId: string,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.deletedAt !== null) return channel;
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET deleted_at = ?, lifecycle_version = lifecycle_version + 1, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        now,
        now,
        channel.channelId,
      )
      .one(),
  );
}

/** Clears deletion only. Processing state, available_at, and failure are preserved. */
export function restoreChannel(
  sql: SqlStorage,
  channelId: string,
  now: number,
): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.deletedAt === null) return channel;
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels SET deleted_at = NULL, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        now,
        channel.channelId,
      )
      .one(),
  );
}

function requireChannel(sql: SqlStorage, channelId: string): CatalogChannel {
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

function toChannel(row: ChannelRow): CatalogChannel {
  return {
    channelId: row.channel_id,
    title: row.title,
    canonicalUrl: row.canonical_url,
    status: toStatus(row.status),
    initialImportCount: row.initial_import_count,
    failureCode: toFailureCode(row.failure_code),
    failureDetail: row.failure_detail,
    availableAt: row.available_at,
    lastCheckedAt: row.last_checked_at,
    lastIngestedAt: row.last_ingested_at,
    deletedAt: row.deleted_at,
    lifecycleVersion: row.lifecycle_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStatus(value: string): ChannelStatus {
  if (value === "pending" || value === "available" || value === "failed") {
    return value;
  }
  throw new Error(`unexpected channels.status: ${value}`);
}

function toFailureCode(value: string | null): ChannelFailureCode | null {
  if (value === null) return null;
  if (
    value === "NO_TRANSCRIPTS" ||
    value === "NO_EPISODES" ||
    value === "INITIAL_IMPORT_FAILED"
  ) {
    return value;
  }
  throw new Error(`unexpected channels.failure_code: ${value}`);
}
