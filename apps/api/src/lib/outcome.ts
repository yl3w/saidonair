import type {
  CatalogState,
  ChannelRequest,
  RequestOutcome,
} from "@media-digest/shared";
import type {
  CatalogChannel,
  ChannelRequest as ChannelRequestRecord,
} from "../do/registry/types";

/** Where a requested id stands in the catalog; `channel` is null when it is not there at all. */
export function catalogState(channel: CatalogChannel | null): CatalogState {
  if (channel === null) return "not_in_catalog";
  if (channel.deletedAt !== null) return "deleted";
  return channel.status;
}

/**
 * The requester's one-phrase view of a request (spec §6.4). Approval always creates or reuses the
 * channel row, so an approved request without a channel cannot happen; it reads as importing.
 */
export function deriveOutcome(
  request: ChannelRequestRecord,
  channel: CatalogChannel | null,
): RequestOutcome {
  if (request.status === "pending") return "awaiting_review";
  if (request.status === "rejected") return "rejected";
  if (channel === null) return "importing";
  if (channel.deletedAt !== null) return "channel_removed";
  switch (channel.status) {
    case "pending":
      return "importing";
    case "failed":
      return "import_failed";
    case "available":
      return request.autoFollowCompletedAt !== null
        ? "following"
        : "approved_pending_follow";
  }
}

/** The one projection from the Registry's request onto the shared `ChannelRequest`. */
export function toChannelRequest(
  request: ChannelRequestRecord,
  channel: CatalogChannel | null,
): ChannelRequest {
  return {
    requestId: request.requestId,
    userEmail: request.userEmail,
    channelId: request.youtubeChannelId,
    channelTitle: request.channelTitle,
    submittedUrl: request.submittedUrl,
    status: request.status,
    reviewedAt: request.reviewedAt,
    reviewedByEmail: request.reviewedByEmail,
    ownerExplanation: request.ownerExplanation,
    autoFollowCompletedAt: request.autoFollowCompletedAt,
    createdAt: request.createdAt,
    outcome: deriveOutcome(request, channel),
    channel: {
      state: catalogState(channel),
      failureCode: channel?.failureCode ?? null,
    },
  };
}
