import type { ChannelRequestStatus } from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { requireChannelId } from "../../lib/youtube/ids";
import { createChannel, getChannel } from "./channels";
import type {
  ApproveRequestInput,
  CatalogChannel,
  ChannelRequest,
  RejectRequestInput,
  SubmitRequestInput,
} from "./types";
import { ensureUser } from "./users";

type RequestRow = {
  request_id: string;
  user_email: string;
  youtube_channel_id: string;
  submitted_url: string;
  status: string;
  reviewed_at: number | null;
  reviewed_by_email: string | null;
  owner_explanation: string | null;
  approved_channel_id: string | null;
  auto_follow_completed_at: number | null;
  created_at: number;
  updated_at: number;
};

const REQUEST_COLUMNS = `request_id, user_email, youtube_channel_id, submitted_url, status,
  reviewed_at, reviewed_by_email, owner_explanation, approved_channel_id,
  auto_follow_completed_at, created_at, updated_at`;

/**
 * Records a pending request, or returns the requester's existing request for that channel
 * (one per user/channel). The requester row is ensured so the FK holds for direct callers.
 * TODO(owner): decide whether a request for an already-available channel should auto-approve.
 */
export function submitRequest(
  sql: SqlStorage,
  email: string,
  input: SubmitRequestInput,
  now: number,
): ChannelRequest {
  const youtubeChannelId = requireChannelId(input.youtubeChannelId);
  const submittedUrl = input.submittedUrl.trim();
  if (submittedUrl.length === 0) {
    throw new DomainError("INVALID_INPUT", "submittedUrl is required");
  }
  ensureUser(sql, email, now);

  const existing = sql
    .exec<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM channel_requests
       WHERE user_email = ? AND youtube_channel_id = ?`,
      email,
      youtubeChannelId,
    )
    .toArray()[0];
  if (existing) return toRequest(existing);

  return toRequest(
    sql
      .exec<RequestRow>(
        `INSERT INTO channel_requests
           (request_id, user_email, youtube_channel_id, submitted_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)
         RETURNING ${REQUEST_COLUMNS}`,
        crypto.randomUUID(),
        email,
        youtubeChannelId,
        submittedUrl,
        now,
        now,
      )
      .one(),
  );
}

/** Requesters see only their own requests. */
export function listOwnRequests(
  sql: SqlStorage,
  email: string,
): ChannelRequest[] {
  return sql
    .exec<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM channel_requests
       WHERE user_email = ? ORDER BY created_at DESC, request_id`,
      email,
    )
    .toArray()
    .map(toRequest);
}

/** Owner review queue: every user's requests, newest first. */
export function listAllRequests(sql: SqlStorage): ChannelRequest[] {
  return sql
    .exec<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM channel_requests ORDER BY created_at DESC, request_id`,
    )
    .toArray()
    .map(toRequest);
}

/**
 * Approves a pending request, creating the shared channel if it does not exist yet or
 * reusing it unchanged (including a deleted one — restoring is a separate owner action).
 * `channelCreated` tells the caller to start initial ingestion. Run inside a transaction.
 */
export function approveRequest(
  sql: SqlStorage,
  reviewerEmail: string,
  requestId: string,
  input: ApproveRequestInput,
  now: number,
): {
  request: ChannelRequest;
  channel: CatalogChannel;
  channelCreated: boolean;
} {
  const request = requirePendingRequest(sql, requestId);

  const existing = getChannel(sql, request.youtubeChannelId);
  const channel =
    existing ??
    createChannel(
      sql,
      {
        channelId: request.youtubeChannelId,
        title: input.title,
        initialImportCount: input.initialImportCount,
      },
      now,
    );

  const approved = toRequest(
    sql
      .exec<RequestRow>(
        `UPDATE channel_requests
         SET status = 'approved', reviewed_at = ?, reviewed_by_email = ?, owner_explanation = ?,
             approved_channel_id = ?, updated_at = ?
         WHERE request_id = ?
         RETURNING ${REQUEST_COLUMNS}`,
        now,
        reviewerEmail,
        optionalExplanation(input.explanation),
        channel.channelId,
        now,
        request.requestId,
      )
      .one(),
  );
  return { request: approved, channel, channelCreated: existing === null };
}

export function rejectRequest(
  sql: SqlStorage,
  reviewerEmail: string,
  requestId: string,
  input: RejectRequestInput,
  now: number,
): ChannelRequest {
  const request = requirePendingRequest(sql, requestId);
  return toRequest(
    sql
      .exec<RequestRow>(
        `UPDATE channel_requests
         SET status = 'rejected', reviewed_at = ?, reviewed_by_email = ?, owner_explanation = ?,
             updated_at = ?
         WHERE request_id = ?
         RETURNING ${REQUEST_COLUMNS}`,
        now,
        reviewerEmail,
        optionalExplanation(input.explanation),
        now,
        request.requestId,
      )
      .one(),
  );
}

function requirePendingRequest(
  sql: SqlStorage,
  requestId: string,
): ChannelRequest {
  const row = sql
    .exec<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM channel_requests WHERE request_id = ?`,
      requestId,
    )
    .toArray()[0];
  if (!row) throw new DomainError("NOT_FOUND", "request not found");
  const request = toRequest(row);
  if (request.status !== "pending") {
    throw new DomainError("INVALID_STATE", `request already ${request.status}`);
  }
  return request;
}

function optionalExplanation(value: string | undefined): string | null {
  const explanation = value?.trim();
  return explanation ? explanation : null;
}

function toRequest(row: RequestRow): ChannelRequest {
  return {
    requestId: row.request_id,
    userEmail: row.user_email,
    youtubeChannelId: row.youtube_channel_id,
    submittedUrl: row.submitted_url,
    status: toStatus(row.status),
    reviewedAt: row.reviewed_at,
    reviewedByEmail: row.reviewed_by_email,
    ownerExplanation: row.owner_explanation,
    approvedChannelId: row.approved_channel_id,
    autoFollowCompletedAt: row.auto_follow_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStatus(value: string): ChannelRequestStatus {
  if (value === "pending" || value === "approved" || value === "rejected") {
    return value;
  }
  throw new Error(`unexpected channel_requests.status: ${value}`);
}
