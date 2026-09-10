// The user-facing phrases from the spec (§6.4 outcomes, §7.3 failure codes), kept in one place so
// screens never invent their own wording.
import type { ChannelFailureCode, ChannelStatus } from "@media-digest/shared";

export const FAILURE_COPY: Record<ChannelFailureCode, string> = {
  NO_TRANSCRIPTS: "No captions on any attempted episode",
  NO_EPISODES: "The feed had no episodes",
  INITIAL_IMPORT_FAILED: "Import failed for technical reasons",
};

export function failureCopy(code: ChannelFailureCode | null): string {
  return code === null ? "Failed" : FAILURE_COPY[code];
}

export const CHANNEL_STATUS_COPY: Record<ChannelStatus, string> = {
  pending: "Pending",
  available: "Available",
  failed: "Failed",
};

export const CHANNEL_ID_HELP =
  "On the channel's page open About, then Share channel, then Copy channel ID.";

export const UNAVAILABLE_FOLLOW_COPY = "Unavailable: removed by the owner";
