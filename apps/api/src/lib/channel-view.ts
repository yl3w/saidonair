import type { Channel, ChannelManagement } from "@media-digest/shared";
import type {
  CatalogChannel,
  ChannelManagementRecord,
} from "../do/registry/types";

/** The only status whose episodes are ingested and readable. */
export function isApproved(channel: CatalogChannel): boolean {
  return channel.status === "approved";
}

export type ChannelView = {
  following: boolean;
  processedCount: number;
  /** Present only when the caller is the owner. */
  management?: ChannelManagementRecord;
};

/**
 * The one projection from the Registry's channel onto the shared `Channel`. Listing fields here,
 * rather than spreading, means a new Registry column never reaches the API by accident.
 */
export function toChannel(channel: CatalogChannel, view: ChannelView): Channel {
  const base: Channel = {
    channelId: channel.channelId,
    title: channel.title,
    canonicalUrl: channel.canonicalUrl,
    status: channel.status,
    paused: channel.pausedBy !== null,
    pausedBy: channel.pausedBy,
    approvedAt: channel.approvedAt,
    reviewedAt: channel.reviewedAt,
    reviewNote: channel.reviewNote,
    lastIngestedAt: channel.lastIngestedAt,
    processedCount: view.processedCount,
    following: view.following,
  };
  return view.management
    ? { ...base, management: toManagement(view.management) }
    : base;
}

export function toManagement(
  record: ChannelManagementRecord,
): ChannelManagement {
  const { channel } = record;
  return {
    initialImportCount: channel.initialImportCount,
    reviewedByEmail: channel.reviewedByEmail,
    pausedAt: channel.pausedAt,
    lastCheckedAt: channel.lastCheckedAt,
    lifecycleVersion: channel.lifecycleVersion,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    episodes: record.episodes,
    latestRun: record.latestRun,
    neverStarted: record.neverStarted,
  };
}
