import type {
  Catalog,
  ChannelStatus,
  EpisodeCounts,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeSummary,
  EpisodeWaitingCode,
  IngestionRunEpisodeStatus,
  IngestionRunKind,
  IngestionRunStatus,
  IngestionRunSummary,
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
  lastIngestedAt: number | null;
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

/** Processing detail of an episode, returned to every caller (the API enforces no authorization). */
export type EpisodeProcessingRecord = {
  attemptCount: number;
  failureCode: string | null;
  failureDetail: string | null;
  waitingCode: EpisodeWaitingCode | null;
  skipReason: EpisodeSkipReason | null;
  skippedAt: number | null;
  skippedByEmail: string | null;
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
  episodeLimit: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  failureCode: string | null;
  failureDetail: string | null;
  createdAt: number;
  episodes: IngestionRunEpisodeRecord[];
};

/** A channel with the management facts the catalog table and detail header show. */
export type ChannelManagementRecord = {
  channel: CatalogChannel;
  episodes: EpisodeCounts;
  latestRun: IngestionRunSummary | null;
  /** Approved and no run row exists at all. */
  neverStarted: boolean;
};
