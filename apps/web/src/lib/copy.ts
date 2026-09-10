// The user-facing phrases from the spec, kept in one place so screens never invent their own wording.
import type { ChannelStatus } from "@media-digest/shared";

export const CHANNEL_STATUS_COPY: Record<ChannelStatus, string> = {
  requested: "Awaiting owner approval",
  approved: "Approved",
  declined: "Declined",
};

export const CHANNEL_ID_HELP =
  "On the channel's page open About, then Share channel, then Copy channel ID.";
