import type {
  AttemptOutcomeCode,
  Catalog,
  ChannelStatus,
  EpisodeCounts,
  EpisodeIngestionAttempt,
  EpisodeProcessing,
  EpisodeSkipReason,
  EpisodeStatus,
  EpisodeSummary,
  IngestionRun,
  PausedBy,
  ProcessingIntent,
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

/** One active follower of a channel, as the owner's queue shows it. */
export type FollowerRecord = { email: string; followedAt: number };

/** One user's follow of one channel: active while `unfollowedAt` is null, a retained tombstone otherwise. */
export type FollowRecord = {
  channelId: string;
  followedAt: number;
  unfollowedAt: number | null;
};

/** Processing detail of an episode: the shared shape itself, returned to every caller. */
export type EpisodeProcessingRecord = EpisodeProcessing;

/**
 * One episode with its shared summary (null unless available), related titles already filtered to
 * the channel scope the caller passed so ineligible titles never leave the DO, and its processing
 * detail with the latest attempt.
 */
export type EpisodeRecord = {
  episodeId: string;
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

/** Where a digest page resumes: the last row's availability and episode id (docs/PRD.md §4.4 order). */
export type DigestPosition = { summaryAvailableAt: number; episodeId: string };

/**
 * What one digest page selects: a half-open range of first availability, a position to resume
 * after, and a page size. Every bound is optional except the size, because the reader's own local
 * days are the only window there is (docs/PRD.md §4.4).
 */
export type DigestSelection = {
  fromMs: number | null;
  toMs: number | null;
  after: DigestPosition | null;
  limit: number;
};

/** A compact digest row: what the calendar counts, without the summary body. */
export type DigestRowRecord = {
  episodeId: string;
  channelId: string;
  summaryAvailableAt: number;
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

// --- ingestion writes (docs/specs/m3-2-attempt-ledger.md §3) ---------------------------------

/** What one feed check recorded: the completed run and the episodes it created, newest first. */
export type DiscoveryResult = {
  run: IngestionRunRecord;
  created: EpisodeRecord[];
};

/** A vector generation an attempt staged, with how many ids it wrote, so a later attempt can delete it. */
export type StagedGeneration = { generationId: string; chunkCount: number };

/**
 * `beginAttempt`'s answer: a new running attempt, with the abandoned staged generation of the
 * episode's previous attempt when it left one; or the attempt that is still running, so the caller
 * can reconcile it (a `DomainError` carries only a code across RPC).
 */
export type AttemptStart =
  | {
      kind: "started";
      attempt: EpisodeIngestionAttempt;
      abandonedGeneration: StagedGeneration | null;
    }
  | { kind: "running"; attempt: EpisodeIngestionAttempt };

/** Reasons an attempt finishes `waiting`: the episode stays in its window (docs/PRD.md §4.2 rule 11). */
export const WAITING_CODES = [
  "CAPTIONS",
  "PROVIDER_LIMIT",
] as const satisfies readonly AttemptOutcomeCode[];
/** Deterministic content results: skip a publication, leave a replacement's content alone (rule 12). */
export const DETERMINISTIC_SKIP_CODES = [
  "SHORT",
  "NON_ENGLISH",
  "UNPLAYABLE",
] as const satisfies readonly AttemptOutcomeCode[];
/** Technical results: the attempt failed, the episode stays in its window (rule 13; PRD §5.3). */
export const TECHNICAL_CODES = [
  "PROVIDER_AUTH",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_HTTP",
  "PROVIDER_PARSE",
  "TRANSCRIPT_TOO_LARGE",
  "EMBEDDING_FAILED",
  "VECTORIZE_INCOMPLETE",
  "SUMMARY_FAILED",
  "WORKFLOW_LOST",
] as const satisfies readonly AttemptOutcomeCode[];

export type WaitingCode = (typeof WAITING_CODES)[number];
export type DeterministicSkipCode = (typeof DETERMINISTIC_SKIP_CODES)[number];
export type TechnicalCode = (typeof TECHNICAL_CODES)[number];

/** How an attempt ended without publishing. */
export type AttemptOutcome =
  | { status: "waiting"; code: WaitingCode }
  | { status: "failed"; code: TechnicalCode; detail?: string }
  | { status: "skipped"; code: DeterministicSkipCode };

/** Why pre-flight refused a start (docs/PRD.md §4.2 rule 9). */
export type BlockReason = "PROVIDER_AUTH" | "PROVIDER_LIMIT";

export type AttemptResult = {
  attempt: EpisodeIngestionAttempt;
  episode: EpisodeRecord;
};

/** `completeAttempt`'s answer: the generation that was active before, for the cleanup step, or null on first publication. */
export type PublicationResult = AttemptResult & {
  previousGeneration: StagedGeneration | null;
};

/** The summary an attempt publishes, validated by shape at the Registry boundary (docs/PRD.md §4.4). */
export type EpisodeSummaryInput =
  | {
      format: "structured";
      executiveSummary: string;
      takeaways: { text: string; startSec: number | null }[];
      topicTags: string[];
      model: string;
      promptVersion: string;
    }
  | {
      format: "raw_fallback";
      rawText: string;
      model: string;
      promptVersion: string;
    };

/**
 * What a Workflow instance learns about its own attempt before it works (docs/specs/m3-5-episode-workflow.md
 * §3.4 `load`): whether it is still the current attempt, the generation it stages, the episode facts its vector
 * metadata carries, and the abandoned generation it deletes first, when any.
 */
export type AttemptContext = {
  current: boolean;
  attempt: EpisodeIngestionAttempt;
  generationId: string | null;
  episode: {
    episodeId: string;
    channelId: string;
    channelTitle: string;
    title: string;
    publishedAt: number;
    intent: ProcessingIntent | null;
    activeVectorGeneration: string | null;
  };
  abandonedGeneration: StagedGeneration | null;
};
