import type {
  ChannelFailureCode,
  ChannelRequestStatus,
  ChannelStatus,
  EpisodeCounts,
  EpisodeStatus,
  EpisodeSummary,
  IngestionRunEpisodeStatus,
  IngestionRunKind,
  IngestionRunStatus,
  IngestionRunSummary,
  RelatedEpisode,
  UserRole,
} from "@media-digest/shared";

export type RegistryUser = {
  email: string;
  role: UserRole;
  createdAt: number;
  lastSeenAt: number;
};

export type CatalogChannel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: ChannelStatus;
  initialImportCount: number;
  failureCode: ChannelFailureCode | null;
  failureDetail: string | null;
  availableAt: number | null;
  lastCheckedAt: number | null;
  lastIngestedAt: number | null;
  deletedAt: number | null;
  lifecycleVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type ChannelRequest = {
  requestId: string;
  userEmail: string;
  youtubeChannelId: string;
  submittedUrl: string;
  /** Feed title captured at submission; null for rows created before migration 0002. */
  channelTitle: string | null;
  status: ChannelRequestStatus;
  reviewedAt: number | null;
  reviewedByEmail: string | null;
  ownerExplanation: string | null;
  approvedChannelId: string | null;
  autoFollowCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Callers resolve URLs to a canonical `UC…` id and fetch the title before calling the DO. */
export type ConfigureChannelInput = {
  channelId: string;
  title: string;
  initialImportCount?: number;
};

export type SubmitRequestInput = {
  youtubeChannelId: string;
  submittedUrl: string;
  /** The channel's RSS feed title, fetched by the route to verify the id. Stored trimmed; empty means none. */
  channelTitle?: string;
};

export type ApproveRequestInput = {
  /** Used only when approval has to create the channel; defaults to the request's stored title. */
  title?: string;
  initialImportCount?: number;
  explanation?: string;
};

/** Owner-only processing detail of an episode; routes drop it for readers. */
export type EpisodeProcessingRecord = {
  attemptCount: number;
  failureCode: string | null;
  failureDetail: string | null;
  transcriptCheckedAt: number | null;
  chunkCount: number | null;
  vectorizedAt: number | null;
  processedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * One episode with its shared summary (null until processed) and related titles already
 * filtered to the channel scope the caller passed, so ineligible titles never leave the DO.
 */
export type EpisodeRecord = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: number;
  status: EpisodeStatus;
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

export type IngestionRunEpisodeRecord = {
  videoId: string;
  status: IngestionRunEpisodeStatus;
  failureCode: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

export type IngestionRunRecord = {
  runId: string;
  channelId: string;
  kind: IngestionRunKind;
  status: IngestionRunStatus;
  lifecycleVersion: number;
  episodeLimit: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  failureCode: string | null;
  failureDetail: string | null;
  createdAt: number;
  episodes: IngestionRunEpisodeRecord[];
};

/** A channel with the owner-only facts the catalog table and detail header show. */
export type ChannelManagementRecord = {
  channel: CatalogChannel;
  episodes: EpisodeCounts;
  latestRun: IngestionRunSummary | null;
  /** Pending or approved requests for this id; stands in for follower count. */
  requesterCount: number;
  /** Pending, not deleted, and no queued or running run. */
  stuckPending: boolean;
};

export type RejectRequestInput = {
  explanation?: string;
};
