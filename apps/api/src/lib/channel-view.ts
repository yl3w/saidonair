import type { Channel, ChannelManagement } from "@media-digest/shared";
import type {
  CatalogChannel,
  ChannelManagementRecord,
} from "../do/registry/types";

/** The only status whose episodes are discovered and readable. */
export function isApproved(channel: CatalogChannel): boolean {
  return channel.status === "approved";
}

/** What depends on who is asking: the caller's own relationship to the channel, and whether there is a caller. */
export type ChannelView = {
  following: boolean;
  followerCount: number;
  /**
   * Whether to attach the management facts. True whenever a session was presented — any identity,
   * not only the owner — and false for an anonymous caller on a public read
   * (docs/specs/route-visibility.md §4.3). Required rather than defaulted, so a new route states
   * the decision instead of inheriting "include it" by silence.
   */
  management: boolean;
};

/**
 * The one projection from the Registry's channel, with its management facts, onto the shared
 * `Channel`. Listing fields here, rather than spreading, means a new Registry column never reaches
 * the API by accident.
 */
export function toChannel(
  record: ChannelManagementRecord,
  view: ChannelView,
): Channel {
  const { channel } = record;
  const result: Channel = {
    channelId: channel.channelId,
    title: channel.title,
    canonicalUrl: channel.canonicalUrl,
    status: channel.status,
    paused: channel.pausedBy !== null,
    approvedAt: channel.approvedAt,
    reviewedAt: channel.reviewedAt,
    reviewNote: channel.reviewNote,
    lastIngestedAt: record.lastIngestedAt,
    episodes: record.episodes,
    following: view.following,
    followerCount: view.followerCount,
  };
  if (view.management) result.management = toManagement(record);
  return result;
}

export function toManagement(
  record: ChannelManagementRecord,
): ChannelManagement {
  const { channel } = record;
  return {
    initialImportCount: channel.initialImportCount,
    reviewedByEmail: record.reviewedByEmail,
    pausedBy: channel.pausedBy,
    pausedAt: channel.pausedAt,
    lastCheckedAt: channel.lastCheckedAt,
    latestRun: record.latestRun,
    neverStarted: record.neverStarted,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}
