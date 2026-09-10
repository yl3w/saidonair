import type { Channel, ChannelManagement } from "@media-digest/shared";
import type {
  CatalogChannel,
  ChannelManagementRecord,
} from "../do/registry/types";

/** The only state a channel can be followed or read in. */
export function isAvailable(channel: CatalogChannel): boolean {
  return channel.status === "available" && channel.deletedAt === null;
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
    failureCode: channel.failureCode,
    deletedAt: channel.deletedAt,
    available: isAvailable(channel),
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
    failureDetail: channel.failureDetail,
    availableAt: channel.availableAt,
    lastCheckedAt: channel.lastCheckedAt,
    lifecycleVersion: channel.lifecycleVersion,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    episodes: record.episodes,
    latestRun: record.latestRun,
    stuckPending: record.stuckPending,
  };
}
