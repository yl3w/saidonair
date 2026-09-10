import type {
  Channel,
  ChannelManagement,
  EpisodeCounts,
} from "@media-digest/shared";
import type {
  CatalogChannel,
  ChannelManagementRecord,
} from "../do/registry/types";

/** The only status whose episodes are ingested and readable. */
export function isApproved(channel: CatalogChannel): boolean {
  return channel.status === "approved";
}

export function zeroEpisodeCounts(): EpisodeCounts {
  return {
    tracked: 0,
    available: 0,
    pending: 0,
    waiting: 0,
    failed: 0,
    skipped: 0,
  };
}

export type ChannelView = {
  following: boolean;
  episodes: EpisodeCounts;
  followerCount: number;
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
    approvedAt: channel.approvedAt,
    reviewedAt: channel.reviewedAt,
    reviewNote: channel.reviewNote,
    lastIngestedAt: channel.lastIngestedAt,
    episodes: view.episodes,
    following: view.following,
    followerCount: view.followerCount,
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
    pausedBy: channel.pausedBy,
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
