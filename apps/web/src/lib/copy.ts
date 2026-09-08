// The user-facing phrases from the spec (§6.4 outcomes, §7.3 failure codes), kept in one place so
// screens never invent their own wording.
import type {
  CatalogState,
  ChannelFailureCode,
  ChannelRequest,
  ChannelStatus,
} from "@media-digest/shared";

export const FAILURE_COPY: Record<ChannelFailureCode, string> = {
  NO_TRANSCRIPTS: "No captions on any attempted episode",
  NO_EPISODES: "The feed had no episodes",
  INITIAL_IMPORT_FAILED: "Import failed for technical reasons",
};

export function failureCopy(code: ChannelFailureCode | null): string {
  return code === null ? "Failed" : FAILURE_COPY[code];
}

/** The requester's one-phrase view of a request. */
export function outcomeCopy(request: ChannelRequest): string {
  switch (request.outcome) {
    case "awaiting_review":
      return "Waiting for owner review";
    case "rejected":
      return "Declined";
    case "importing":
      return "Approved, importing";
    case "import_failed":
      return `Approved, import failed: ${failureCopy(request.channel.failureCode)}. The owner can retry.`;
    case "following":
      return "Following";
    case "approved_pending_follow":
      return "Approved, you will follow it shortly";
    case "channel_removed":
      return "Approved, channel removed by the owner";
  }
}

export const CATALOG_STATE_COPY: Record<CatalogState, string> = {
  not_in_catalog: "Not in catalog",
  pending: "Pending",
  available: "Available",
  failed: "Failed",
  deleted: "Deleted",
};

export const CHANNEL_STATUS_COPY: Record<ChannelStatus, string> = {
  pending: "Pending",
  available: "Available",
  failed: "Failed",
};

export const CHANNEL_ID_HELP =
  "On the channel's page open About, then Share channel, then Copy channel ID.";

export const UNAVAILABLE_FOLLOW_COPY = "Unavailable: removed by the owner";
