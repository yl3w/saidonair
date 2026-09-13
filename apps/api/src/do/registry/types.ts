import type {
  Catalog,
  ChannelStatus,
  EpisodeCounts,
  EpisodeProcessing,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeSummary,
  IngestionRun,
  PausedBy,
  RelatedEpisode,
  UserRole,
} from "@media-digest/shared";

/** What the Registry knows of the catalog; the route adds the transcript provider's health. */
export type CatalogSummary = Omit<Catalog, "transcripts">;

export type RegistryUser = {
  email: string;
  role: UserRole;
  createdAt: number;
  lastSeenAt: number;
};

/**
 * A channel row. There is no ingestion timestamp here: the API's `lastIngestedAt` is derived from
 * `episodes.processed_at` (docs/PRD.md §4.2 rule 27), so episode work never writes a channel.
 */
export type CatalogChannel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: ChannelStatus;
  initialImportCount: number;
  approvedAt: number | null;
  reviewedAt: number | null;
  reviewedByEmail: string | null;
  reviewNote: string | null;
  pausedBy: PausedBy | null;
  pausedAt: number | null;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Callers resolve URLs to a canonical `UC…` id and fetch the title before calling the DO. Every channel starts `requested`. */
export type CreateChannelInput = {
  channelId: string;
  title: string;
  initialImportCount?: number;
};

export type ReviewInput = {
  title?: string;
  initialImportCount?: number;
  explanation?: string;
};

/** One active or former follower of a channel, as the owner's queue shows it. */
export type FollowerRecord = { email: string; followedAt: number };

/** Processing detail of an episode: the shared shape itself, returned to every caller. */
export type EpisodeProcessingRecord = EpisodeProcessing;

/**
 * One episode with its shared summary (null unless available), related titles already filtered to
 * the channel scope the caller passed so ineligible titles never leave the DO, and its processing
 * detail with the latest attempt.
 */
export type EpisodeRecord = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: number;
  status: EpisodeStatus;
  skipReason: EpisodeSkipReason | null;
  /** First `processed_at`; never reset. */
  summaryAvailableAt: number | null;
  summary: EpisodeSummary | null;
  related: RelatedEpisode[];
  processing: EpisodeProcessingRecord;
};

export type ListEpisodesOptions = {
  /** Newest first; default 20, max 200. */
  limit?: number;
  /** Channel ids whose episodes may appear as related titles: the caller's eligible channels. */
  relatedScope: readonly string[];
};

/** A completed discovery run: the shared shape itself. */
export type IngestionRunRecord = IngestionRun;

/** A channel with the management facts the catalog table and detail header show. */
export type ChannelManagementRecord = {
  channel: CatalogChannel;
  episodes: EpisodeCounts;
  /** `MAX(processed_at)` over the channel's episodes; null before any is available. */
  lastIngestedAt: number | null;
  latestRun: IngestionRun | null;
  /** Approved and no run row exists at all. */
  neverStarted: boolean;
};
