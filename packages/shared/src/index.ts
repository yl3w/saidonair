export type HealthResponse = {
  service: "api";
  status: "ok";
};

export type ErrorResponse = {
  error: string;
  /** Present for typed Registry errors, e.g. `NOT_OWNER`. */
  code?: string;
};

/** Registry role. `owner` manages the shared catalog; everyone else is `user`. */
export type UserRole = "owner" | "user";

/** `GET /me` */
export type MeResponse = {
  email: string;
  role: UserRole;
};

// --- enums (mirror the CHECK constraints in the Registry schema) -----------------------------------

export type ChannelStatus = "pending" | "available" | "failed";

export type ChannelFailureCode =
  | "NO_TRANSCRIPTS"
  | "NO_EPISODES"
  | "INITIAL_IMPORT_FAILED";

export type ChannelRequestStatus = "pending" | "approved" | "rejected";

export type EpisodeStatus =
  | "pending"
  | "processing"
  | "processed"
  | "no_transcript"
  | "failed";

export type SummaryFormat = "structured" | "raw_fallback";

export type IngestionRunKind = "initial" | "scheduled" | "owner_retry";

export type IngestionRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Per-run outcome; `skipped` means the run did not attempt an already processed episode. */
export type IngestionRunEpisodeStatus = EpisodeStatus | "skipped";

export type FollowOrigin = "manual" | "request";

export type ChatRole = "user" | "assistant";

export type ChatMessageStatus = "pending" | "completed" | "failed";

// --- derived states ---------------------------------------------------------------------------------

/** Where a requested channel id stands in the catalog. */
export type CatalogState =
  | "not_in_catalog"
  | "pending"
  | "available"
  | "failed"
  | "deleted";

/**
 * A request in one phrase: request status combined with the channel's processing and deletion
 * state. Computed server-side so the UI and tests agree.
 */
export type RequestOutcome =
  | "awaiting_review"
  | "rejected"
  | "importing"
  | "import_failed"
  | "following"
  | "approved_pending_follow"
  | "channel_removed";

// --- channels ---------------------------------------------------------------------------------------

/**
 * A catalog channel as any caller sees it. `following` is about the caller; `management` is present
 * only when the caller is the owner. Everything else is identical for everyone.
 */
export type Channel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: ChannelStatus;
  failureCode: ChannelFailureCode | null;
  deletedAt: number | null;
  /** `status === "available"` and not deleted; the only state that can be followed or read. */
  available: boolean;
  lastIngestedAt: number | null;
  processedCount: number;
  following: boolean;
  management?: ChannelManagement;
};

export type EpisodeCounts = {
  processed: number;
  pending: number;
  processing: number;
  noTranscript: number;
  failed: number;
};

/** The newest run for a channel, as shown in catalog rows. */
export type IngestionRunSummary = {
  runId: string;
  kind: IngestionRunKind;
  status: IngestionRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  failureCode: string | null;
};

/** Owner-only fields of a channel. */
export type ChannelManagement = {
  initialImportCount: number;
  failureDetail: string | null;
  availableAt: number | null;
  lastCheckedAt: number | null;
  lifecycleVersion: number;
  createdAt: number;
  updatedAt: number;
  episodes: EpisodeCounts;
  latestRun: IngestionRunSummary | null;
  /** Pending or approved requests for this id. Stands in for follower count, which the Registry cannot know. */
  requesterCount: number;
  /** Pending, not deleted, and no queued or running run, at any age. */
  stuckPending: boolean;
};

/** `GET /channels` — available channels by default; `?scope=all` (owner) every state, each with `management`. */
export type ChannelsResponse = {
  channels: Channel[];
};

/** `GET /channels/:id`, `POST /channels`, `DELETE /channels/:id`, `POST /channels/:id/restore|retry` */
export type ChannelResponse = {
  channel: Channel;
};

/** `POST /channels` — a bare `UC…` id or a URL containing `/channel/UC…`; the feed title is used unless given. */
export type CreateChannelBody = {
  channelId: string;
  title?: string;
  initialImportCount?: number;
};

// --- episodes ---------------------------------------------------------------------------------------

export type EpisodeSummary =
  | {
      format: "structured";
      executiveSummary: string;
      takeaways: string[];
      topicTags: string[];
    }
  | {
      format: "raw_fallback";
      rawText: string;
    };

export type RelatedEpisode = {
  videoId: string;
  title: string;
};

/** Owner-only processing detail of an episode. */
export type EpisodeProcessing = {
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
 * An episode of a catalog channel. `summary` and `related` are present for followers and the owner;
 * `wasUnread` accompanies a returned summary and reports the caller's receipt state before this
 * response recorded one; `processing` is present only for the owner.
 */
export type Episode = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: number;
  status: EpisodeStatus;
  summary: EpisodeSummary | null;
  /** Already filtered to the caller's eligible channels. */
  related: RelatedEpisode[];
  wasUnread?: boolean;
  processing?: EpisodeProcessing;
};

/** `GET /channels/:id/episodes?limit=` — newest first. */
export type EpisodesResponse = {
  episodes: Episode[];
};

/** `GET /digest?since=<iso>` — processed episodes from eligible follows, newest first; returned summaries are marked read. */
export type DigestResponse = {
  since: number;
  episodes: Episode[];
};

// --- ingestion runs ---------------------------------------------------------------------------------

export type IngestionRunEpisode = {
  videoId: string;
  status: IngestionRunEpisodeStatus;
  failureCode: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

export type IngestionRun = {
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
  /** Historical per-run outcomes; a later retry does not rewrite them. */
  episodes: IngestionRunEpisode[];
};

/** `GET /channels/:id/ingestion-runs` (owner) — newest first. */
export type IngestionRunsResponse = {
  runs: IngestionRun[];
};

// --- follows ----------------------------------------------------------------------------------------

/** One of the caller's follows, with its channel embedded. */
export type Follow = {
  channelId: string;
  followedAt: number;
  /** Set on unfollow and retained as a tombstone; null while the follow is active. */
  unfollowedAt: number | null;
  origin: FollowOrigin;
  /** `channel.available` is false while the owner has the channel deleted; the follow row stays. */
  channel: Channel;
  unreadCount: number;
};

/** `GET /follows` — active follows, most recent ingestion first. */
export type FollowsResponse = {
  follows: Follow[];
};

/** `PUT /follows/:channelId`, `DELETE /follows/:channelId` */
export type FollowResponse = {
  follow: Follow;
};

// --- channel requests -------------------------------------------------------------------------------

/**
 * A request for a channel to join the catalog, as both the requester and the owner see it. `outcome`
 * is the requester's one-phrase view; `channel` carries the owner's decision inputs.
 */
export type ChannelRequest = {
  requestId: string;
  userEmail: string;
  channelId: string;
  /** Feed title captured at submission; null for rows created before the column existed. */
  channelTitle: string | null;
  submittedUrl: string;
  status: ChannelRequestStatus;
  reviewedAt: number | null;
  reviewedByEmail: string | null;
  ownerExplanation: string | null;
  autoFollowCompletedAt: number | null;
  createdAt: number;
  outcome: RequestOutcome;
  channel: {
    state: CatalogState;
    failureCode: ChannelFailureCode | null;
  };
};

/** `GET /channel-requests` — the caller's own by default; `?scope=all` (owner) everyone's. Also `GET /channels/:id/requests` (owner). */
export type ChannelRequestsResponse = {
  requests: ChannelRequest[];
};

/** `POST /channel-requests`, `POST /channel-requests/:id/reject` */
export type ChannelRequestResponse = {
  request: ChannelRequest;
};

/** `POST /channel-requests` — a bare `UC…` id or a URL containing `/channel/UC…`. */
export type CreateChannelRequestBody = {
  channelId: string;
};

/** 409 body when the requested channel is already available; the UI offers Follow instead. */
export type ChannelAlreadyAvailableResponse = ErrorResponse & {
  code: "INVALID_STATE";
  channelId: string;
};

/** `POST /channel-requests/:id/approve` — title defaults to the request's stored title. */
export type ApproveChannelRequestBody = {
  title?: string;
  initialImportCount?: number;
  explanation?: string;
};

export type ApproveChannelRequestResponse = {
  request: ChannelRequest;
  channel: Channel;
  /** True when approval created the channel; initial ingestion should start. */
  channelCreated: boolean;
};

/** `POST /channel-requests/:id/reject` */
export type RejectChannelRequestBody = {
  explanation?: string;
};

// --- catalog ----------------------------------------------------------------------------------------

/** The catalog's aggregate state. */
export type Catalog = {
  channels: {
    available: number;
    pending: number;
    failed: number;
    deleted: number;
    /** Pending, not deleted, and no queued or running run. */
    stuckPending: number;
  };
  episodes: {
    processed: number;
    tracked: number;
  };
  runs: {
    active: number;
  };
  requests: {
    pending: number;
  };
  lastSuccessfulIngestionAt: number | null;
};

/** `GET /catalog` (owner) */
export type CatalogResponse = {
  catalog: Catalog;
};
