import type { Channel, ChannelManagement } from "@media-digest/shared";
import type {
  CatalogChannel,
  ChannelManagementRecord,
} from "../do/registry/types";

/** The only status whose episodes are ingested and readable. */
export function isApproved(channel: CatalogChannel): boolean {
  return channel.status === "approved";
}

/** What depends on who is asking: the caller's own relationship to the channel, nothing else. */
export type ChannelView = {
  following: boolean;
  followerCount: number;
};

/**
 * The one projection from the Registry's channel, with its management facts, onto the shared
 * `Channel`. Every caller receives the whole of it, `management` included: the API enforces no
 * authorization (docs/PRD.md §7, §9), and the web decides what to show. Listing fields here, rather
 * than spreading, means a new Registry column never reaches the API by accident.
 */
export function toChannel(
  record: ChannelManagementRecord,
  view: ChannelView,
): Channel {
  const { channel } = record;
  return {
    channelId: channel.channelId,
    title: channel.title,
    canonicalUrl: channel.canonicalUrl,
    status: channel.status,
    paused: channel.pausedBy !== null,
    approvedAt: channel.approvedAt,
    reviewedAt: channel.reviewedAt,
    reviewNote: channel.reviewNote,
    lastIngestedAt: channel.lastIngestedAt,
    episodes: record.episodes,
    following: view.following,
    followerCount: view.followerCount,
    management: toManagement(record),
  };
}

export function toManagement(
  record: ChannelManagementRecord,
): ChannelManagement {
  const { channel } = record;
  return {
    initialImportCount: channel.initialImportCount,
    reviewedByEmail: channel.reviewedByEmail,
    pausedBy: channel.pausedBy,
    pausedAt: channel.pausedAt,
    lastCheckedAt: channel.lastCheckedAt,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    episodes: record.episodes,
    latestRun: record.latestRun,
    neverStarted: record.neverStarted,
  };
}
