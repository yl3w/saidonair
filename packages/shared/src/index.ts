import { z } from "zod";

/**
 * Every API request and response shape, as Zod schemas with the TypeScript types inferred beside
 * them (`XSchema` / `X`). `apps/api` validates requests and documents responses with the schemas;
 * `apps/web` imports the types only, so Zod never enters its bundle. `.meta({ id })` names a schema as
 * an OpenAPI component wherever another schema refers to it (a response envelope's own root stays
 * inline); `.describe()` is the text readers see in `/docs`. Schemas that carry an id must not be
 * re-described where they are used, or the registry would hold two schemas with one id.
 */

/** Unix time in milliseconds, as every timestamp in the API. */
const UnixMs = z.number().int().describe("Unix time, milliseconds");
const Count = z.number().int().nonnegative();

/**
 * Optional free text (`title`, `explanation`). Omit the field to mean "not provided"; a present
 * value must be non-blank and is trimmed. Empty, whitespace-only, and null are `INVALID_INPUT`
 * (owner decision 2026-09-08, `docs/specs/api-reference.md` §2): the API validates and clients
 * normalise, so a blank never silently becomes a default. The web app strips blanks before sending.
 */
const optionalText = (description: string) =>
  z
    .string()
    .trim()
    .min(1, "must be omitted or non-blank")
    .describe(description)
    .optional();

export const HealthResponseSchema = z
  .object({ service: z.literal("api"), status: z.literal("ok") })
  .meta({ id: "HealthResponse", description: "`GET /health`" });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * The typed error codes and their HTTP statuses. There is no 403: the API enforces no authorization
 * (PRD §9). `apps/api` infers its `DomainErrorCode` from this schema, so the two cannot drift.
 */
export const ErrorCodeSchema = z
  .enum(["INVALID_INPUT", "NOT_FOUND", "INVALID_STATE", "UPSTREAM_UNAVAILABLE"])
  .meta({
    id: "ErrorCode",
    description:
      "INVALID_INPUT (400, including a missing or malformed `X-User-Email`), NOT_FOUND (404), INVALID_STATE (409), UPSTREAM_UNAVAILABLE (502: YouTube did not answer usably).",
  });
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z
      .string()
      .describe("What went wrong. Typed errors are prefixed with their code."),
    code: ErrorCodeSchema.optional(),
  })
  .meta({
    id: "ErrorResponse",
    description:
      "Every non-2xx response body. `code` is absent only on an unexpected 500.",
  });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Registry role. `owner` manages the shared catalog; everyone else is `user`. */
export const UserRoleSchema = z.enum(["owner", "user"]).meta({
  id: "UserRole",
  description:
    "`owner` manages the shared catalog; everyone else is `user`. Identity, not authentication.",
});
export type UserRole = z.infer<typeof UserRoleSchema>;

export const MeResponseSchema = z
  .object({
    email: z.string().describe("The caller's normalized X-User-Email."),
    role: UserRoleSchema,
  })
  .meta({ id: "MeResponse", description: "`GET /me`" });
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- enums (mirror the CHECK constraints in the Registry schema) -----------------------------------

export const ChannelStatusSchema = z
  .enum(["requested", "approved", "declined"])
  .meta({
    id: "ChannelStatus",
    description:
      "The owner's answer. `requested` awaits review; `approved` is ingested and readable; `declined` is hidden from the catalog list, keeps everything, and can be approved or requested again.",
  });
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const PausedBySchema = z.enum(["owner", "system"]).meta({
  id: "PausedBy",
  description:
    "`system` when no one follows the channel; `owner` when the owner paused it.",
});
export type PausedBy = z.infer<typeof PausedBySchema>;

export const EpisodeStatusSchema = z
  .enum(["pending", "available", "failed", "skipped"])
  .meta({
    id: "EpisodeStatus",
    description:
      "`pending` may be waiting; `available` has verified vectors and a summary; `failed` is a technical error after three attempts; `skipped` is deliberate and reversible.",
  });
export type EpisodeStatus = z.infer<typeof EpisodeStatusSchema>;

export const EpisodeWaitingCodeSchema = z
  .enum(["CAPTIONS", "LIVE_OR_UPCOMING", "PROVIDER_LIMIT"])
  .meta({
    id: "EpisodeWaitingCode",
    description: "Why a pending episode is waiting for a later run.",
  });
export type EpisodeWaitingCode = z.infer<typeof EpisodeWaitingCodeSchema>;

export const EpisodeSkipReasonSchema = z
  .enum([
    "SHORT",
    "NON_ENGLISH",
    "NO_CAPTIONS",
    "LIVE_OR_UPCOMING",
    "UNPLAYABLE",
    "OWNER",
  ])
  .meta({
    id: "EpisodeSkipReason",
    description:
      "Why an episode was skipped; `OWNER` carries the owner's email.",
  });
export type EpisodeSkipReason = z.infer<typeof EpisodeSkipReasonSchema>;

export const SummaryFormatSchema = z
  .enum(["structured", "raw_fallback"])
  .meta({ id: "SummaryFormat" });
export type SummaryFormat = z.infer<typeof SummaryFormatSchema>;

export const IngestionRunKindSchema = z
  .enum(["initial", "scheduled", "owner_retry"])
  .meta({ id: "IngestionRunKind" });
export type IngestionRunKind = z.infer<typeof IngestionRunKindSchema>;

export const IngestionRunStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "cancelled"])
  .meta({ id: "IngestionRunStatus" });
export type IngestionRunStatus = z.infer<typeof IngestionRunStatusSchema>;

export const IngestionRunEpisodeStatusSchema = z
  .enum([
    "selected",
    "available",
    "failed",
    "skipped",
    "waiting",
    "not_attempted",
  ])
  .meta({
    id: "IngestionRunEpisodeStatus",
    description:
      "Per-run outcome; `selected` until the run reaches the episode, `not_attempted` when it ended early.",
  });
export type IngestionRunEpisodeStatus = z.infer<
  typeof IngestionRunEpisodeStatusSchema
>;

export const ChatRoleSchema = z
  .enum(["user", "assistant"])
  .meta({ id: "ChatRole" });
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageStatusSchema = z
  .enum(["pending", "completed", "failed"])
  .meta({ id: "ChatMessageStatus" });
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusSchema>;

// --- channels ---------------------------------------------------------------------------------------

export const EpisodeCountsSchema = z
  .object({
    tracked: Count,
    available: Count,
    pending: Count,
    waiting: Count,
    failed: Count,
    skipped: Count,
  })
  .meta({
    id: "EpisodeCounts",
    description:
      "Episodes of a channel by status; `waiting` is the subset of `pending` with a wait reason.",
  });
export type EpisodeCounts = z.infer<typeof EpisodeCountsSchema>;

/** The newest run for a channel, as shown in catalog rows. */
export const IngestionRunSummarySchema = z
  .object({
    runId: z.string(),
    kind: IngestionRunKindSchema,
    status: IngestionRunStatusSchema,
    startedAt: UnixMs.nullable(),
    finishedAt: UnixMs.nullable(),
    failureCode: z.string().nullable(),
  })
  .meta({
    id: "IngestionRunSummary",
    description: "The newest run for a channel, as shown in catalog rows.",
  });
export type IngestionRunSummary = z.infer<typeof IngestionRunSummarySchema>;

/** The management facts of a channel, present for every caller; the web shows them on the Owner screens. */
export const ChannelManagementSchema = z
  .object({
    initialImportCount: z.number().int(),
    reviewedByEmail: z.string().nullable(),
    pausedBy: PausedBySchema.nullable(),
    pausedAt: UnixMs.nullable(),
    lastCheckedAt: UnixMs.nullable(),
    createdAt: UnixMs,
    updatedAt: UnixMs,
    episodes: EpisodeCountsSchema,
    latestRun: IngestionRunSummarySchema.nullable(),
    neverStarted: z
      .boolean()
      .describe("Approved, yet no ingestion run has ever been recorded."),
  })
  .meta({
    id: "ChannelManagement",
    description:
      "The management facts of a channel, present for every caller: the API enforces no authorization, and the web shows them on the Owner screens.",
  });
export type ChannelManagement = z.infer<typeof ChannelManagementSchema>;

/**
 * A catalog channel as every caller sees it, `management` included. Only `following` depends on
 * who is asking.
 */
export const ChannelSchema = z
  .object({
    channelId: z.string().describe("Canonical `UC…` id."),
    title: z.string(),
    canonicalUrl: z.string(),
    status: ChannelStatusSchema,
    paused: z
      .boolean()
      .describe("No new ingestion runs while true. Approved channels only."),
    approvedAt: UnixMs.nullable().describe("First approval; never reset."),
    reviewedAt: UnixMs.nullable(),
    reviewNote: z
      .string()
      .nullable()
      .describe(
        "The owner's latest note, shown to followers of a declined channel.",
      ),
    lastIngestedAt: UnixMs.nullable(),
    episodes: EpisodeCountsSchema,
    following: z.boolean().describe("Whether the caller follows this channel."),
    followerCount: Count.describe(
      "Active followers, from the Registry's follower record.",
    ),
    management: ChannelManagementSchema,
  })
  .meta({
    id: "Channel",
    description:
      "A catalog channel as every caller sees it, `management` included. Only `following` depends on who is asking.",
  });
export type Channel = z.infer<typeof ChannelSchema>;

/** `GET /channels` — requested and approved channels; `?scope=all` adds declined ones. */
export const ChannelsResponseSchema = z
  .object({ channels: z.array(ChannelSchema) })
  .meta({
    id: "ChannelsResponse",
    description:
      "`GET /channels` — requested and approved channels; `?scope=all` adds declined ones.",
  });
export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;

/** `GET /channels/:id`, `POST /channels`, and the channel actions. */
export const ChannelResponseSchema = z.object({ channel: ChannelSchema }).meta({
  id: "ChannelResponse",
  description:
    "`GET /channels/:id`, `POST /channels`, and the channel actions.",
});
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;

/** `POST /channels` — a bare `UC…` id or a URL containing `/channel/UC…`; the feed title is used unless given. */
export const CreateChannelBodySchema = z
  .object({
    channelId: z
      .string()
      .trim()
      .min(1)
      .describe("A bare `UC…` id or any URL containing `/channel/UC…`."),
    title: optionalText(
      "Overrides the title read from the channel's RSS feed.",
    ),
    initialImportCount: z
      .number()
      .int()
      .positive()
      .describe("Recent episodes to import first; defaults to five.")
      .optional(),
  })
  .meta({
    id: "CreateChannelBody",
    description:
      "`POST /channels` — a bare `UC…` id or a URL containing `/channel/UC…`; the feed title is used unless given.",
  });
export type CreateChannelBody = z.infer<typeof CreateChannelBodySchema>;

/** `POST /channels/:id/approve` — every field optional. */
export const ApproveChannelBodySchema = z
  .object({
    title: optionalText("Overrides the channel's title."),
    initialImportCount: z
      .number()
      .int()
      .positive()
      .describe("Recent episodes to import first; defaults to five.")
      .optional(),
    explanation: optionalText("Shown to the channel's followers."),
  })
  .meta({
    id: "ApproveChannelBody",
    description: "`POST /channels/:id/approve` — every field optional.",
  });
export type ApproveChannelBody = z.infer<typeof ApproveChannelBodySchema>;

/** `POST /channels/:id/decline` */
export const DeclineChannelBodySchema = z
  .object({
    explanation: optionalText(
      "Shown to the channel's followers with the word Declined or Withdrawn.",
    ),
  })
  .meta({
    id: "DeclineChannelBody",
    description: "`POST /channels/:id/decline`",
  });
export type DeclineChannelBody = z.infer<typeof DeclineChannelBodySchema>;

// --- episodes ---------------------------------------------------------------------------------------

export const EpisodeSummarySchema = z
  .discriminatedUnion("format", [
    z.object({
      format: z.literal("structured"),
      executiveSummary: z.string(),
      takeaways: z.array(z.string()),
      topicTags: z.array(z.string()),
    }),
    z.object({
      format: z.literal("raw_fallback"),
      rawText: z.string(),
    }),
  ])
  .meta({
    id: "EpisodeSummary",
    description:
      "The shared per-episode summary: structured when the model returned valid JSON, otherwise the raw text it produced.",
  });
export type EpisodeSummary = z.infer<typeof EpisodeSummarySchema>;

export const RelatedEpisodeSchema = z
  .object({ videoId: z.string(), title: z.string() })
  .meta({
    id: "RelatedEpisode",
    description: "Another episode whose transcript is close to this one.",
  });
export type RelatedEpisode = z.infer<typeof RelatedEpisodeSchema>;

/** Processing detail of an episode, present for every caller; the web shows it on the Owner screens. */
export const EpisodeProcessingSchema = z
  .object({
    attemptCount: Count,
    failureCode: z.string().nullable(),
    failureDetail: z.string().nullable(),
    waitingCode: EpisodeWaitingCodeSchema.nullable(),
    skipReason: EpisodeSkipReasonSchema.nullable(),
    skippedAt: UnixMs.nullable(),
    skippedByEmail: z.string().nullable(),
    transcriptCheckedAt: UnixMs.nullable(),
    chunkCount: Count.nullable(),
    vectorizedAt: UnixMs.nullable(),
    processedAt: UnixMs.nullable(),
    createdAt: UnixMs,
    updatedAt: UnixMs,
  })
  .meta({
    id: "EpisodeProcessing",
    description:
      "Processing detail of an episode, present for every caller; the web shows it on the Owner screens.",
  });
export type EpisodeProcessing = z.infer<typeof EpisodeProcessingSchema>;

/**
 * An episode of a catalog channel, the same for every caller: summary, related titles (filtered to
 * the caller's eligible channels), and `processing`. `wasUnread` accompanies a summary returned to
 * an eligible caller and reports their receipt state before this response recorded one.
 */
export const EpisodeSchema = z
  .object({
    videoId: z.string(),
    channelId: z.string(),
    channelTitle: z.string(),
    title: z.string(),
    publishedAt: UnixMs,
    status: EpisodeStatusSchema,
    skipReason: EpisodeSkipReasonSchema.nullable().describe(
      "Why there is no summary, when the episode was skipped.",
    ),
    summary: EpisodeSummarySchema.nullable(),
    related: z
      .array(RelatedEpisodeSchema)
      .describe("Already filtered to the caller's eligible channels."),
    wasUnread: z
      .boolean()
      .describe(
        "For an eligible caller (active follower of an approved channel) with a returned summary: whether they had no read receipt before this response recorded one. Absent for everyone else; their receipts are never touched.",
      )
      .optional(),
    processing: EpisodeProcessingSchema,
  })
  .meta({
    id: "Episode",
    description:
      "An episode of a catalog channel, the same for every caller: summary, related titles filtered to the caller's eligible channels, and `processing`. `wasUnread` accompanies a summary returned to an eligible caller.",
  });
export type Episode = z.infer<typeof EpisodeSchema>;

/** `POST /channels/:id/episodes/:videoId/retry|skip` (owner). */
export const EpisodeResponseSchema = z.object({ episode: EpisodeSchema }).meta({
  id: "EpisodeResponse",
  description: "`POST /channels/:id/episodes/:videoId/retry|skip`",
});
export type EpisodeResponse = z.infer<typeof EpisodeResponseSchema>;

/** `GET /channels/:id/episodes?limit=` — newest first, with summaries and processing detail for every caller. */
export const EpisodesResponseSchema = z
  .object({ episodes: z.array(EpisodeSchema) })
  .meta({
    id: "EpisodesResponse",
    description: "`GET /channels/:id/episodes?limit=` — newest first.",
  });
export type EpisodesResponse = z.infer<typeof EpisodesResponseSchema>;

/** `GET /digest?since=<iso>` — available episodes from eligible follows, newest first; returned summaries are marked read. */
export const DigestResponseSchema = z
  .object({
    since: UnixMs.describe(
      "The window start actually used, after the default and the 7-day clamp.",
    ),
    episodes: z.array(EpisodeSchema),
  })
  .meta({
    id: "DigestResponse",
    description:
      "`GET /digest?since=<iso>` — available episodes from eligible follows, newest first; returned summaries are marked read.",
  });
export type DigestResponse = z.infer<typeof DigestResponseSchema>;

// --- ingestion runs ---------------------------------------------------------------------------------

export const IngestionRunEpisodeSchema = z
  .object({
    videoId: z.string(),
    status: IngestionRunEpisodeStatusSchema,
    failureCode: z.string().nullable(),
    startedAt: UnixMs.nullable(),
    finishedAt: UnixMs.nullable(),
  })
  .meta({
    id: "IngestionRunEpisode",
    description: "One episode's outcome within one run.",
  });
export type IngestionRunEpisode = z.infer<typeof IngestionRunEpisodeSchema>;

export const IngestionRunSchema = z
  .object({
    runId: z.string(),
    channelId: z.string(),
    kind: IngestionRunKindSchema,
    status: IngestionRunStatusSchema,
    episodeLimit: z.number().int().nullable(),
    startedAt: UnixMs.nullable(),
    finishedAt: UnixMs.nullable(),
    failureCode: z.string().nullable(),
    failureDetail: z.string().nullable(),
    createdAt: UnixMs,
    episodes: z
      .array(IngestionRunEpisodeSchema)
      .describe(
        "Historical per-run outcomes; a later retry does not rewrite them.",
      ),
  })
  .meta({ id: "IngestionRun", description: "One ingestion run of a channel." });
export type IngestionRun = z.infer<typeof IngestionRunSchema>;

/** `GET /channels/:id/runs` — newest first. */
export const IngestionRunsResponseSchema = z
  .object({ runs: z.array(IngestionRunSchema) })
  .meta({
    id: "IngestionRunsResponse",
    description: "`GET /channels/:id/runs` — newest first.",
  });
export type IngestionRunsResponse = z.infer<typeof IngestionRunsResponseSchema>;

// --- follows ----------------------------------------------------------------------------------------

/** One of the caller's follows, with its channel embedded. */
export const FollowSchema = z
  .object({
    channelId: z.string(),
    followedAt: UnixMs,
    unfollowedAt: UnixMs.nullable().describe(
      "Set on unfollow and retained as a tombstone; null while the follow is active.",
    ),
    channel: ChannelSchema,
    unreadCount: Count.describe(
      "Available episodes the caller has no read receipt for.",
    ),
  })
  .meta({
    id: "Follow",
    description:
      "One of the caller's follows, with its channel embedded. A follow of a declined channel stays listed; the follow row is never removed.",
  });
export type Follow = z.infer<typeof FollowSchema>;

/** `GET /follows` — active follows, most recent ingestion first. */
export const FollowsResponseSchema = z
  .object({ follows: z.array(FollowSchema) })
  .meta({
    id: "FollowsResponse",
    description:
      "`GET /follows` — active follows, most recent ingestion first.",
  });
export type FollowsResponse = z.infer<typeof FollowsResponseSchema>;

/** `PUT /follows/:channelId`, `DELETE /follows/:channelId` */
export const FollowResponseSchema = z.object({ follow: FollowSchema }).meta({
  id: "FollowResponse",
  description: "`PUT /follows/:channelId`, `DELETE /follows/:channelId`",
});
export type FollowResponse = z.infer<typeof FollowResponseSchema>;

export const FollowerSchema = z
  .object({ email: z.string(), followedAt: UnixMs })
  .meta({
    id: "Follower",
    description: "One active follower of a channel.",
  });
export type Follower = z.infer<typeof FollowerSchema>;

/** `GET /channels/:id/followers` — active followers, oldest first. */
export const FollowersResponseSchema = z
  .object({ followers: z.array(FollowerSchema) })
  .meta({
    id: "FollowersResponse",
    description:
      "`GET /channels/:id/followers` — active followers, oldest first.",
  });
export type FollowersResponse = z.infer<typeof FollowersResponseSchema>;

/** 409 body when the channel is declined: the client shows the note and offers Request again. */
export const ChannelDeclinedResponseSchema = z
  .object({
    error: z.string(),
    code: z.literal("INVALID_STATE"),
    channelId: z.string(),
    status: z.literal("declined"),
    reviewNote: z.string().nullable(),
    reviewedAt: UnixMs.nullable(),
  })
  .meta({
    id: "ChannelDeclinedResponse",
    description:
      "409 body for `POST /channels` and `PUT /follows/:channelId` when the channel is declined; the client shows the note and offers Request again.",
  });
export type ChannelDeclinedResponse = z.infer<
  typeof ChannelDeclinedResponseSchema
>;

// --- catalog ----------------------------------------------------------------------------------------

/** The catalog's aggregate state. */
export const CatalogSchema = z
  .object({
    channels: z.object({
      requested: Count,
      approved: Count,
      paused: Count,
      declined: Count,
    }),
    episodes: z.object({
      available: Count,
      pending: Count,
      waiting: Count,
      failed: Count,
      skipped: Count,
    }),
    runs: z.object({ active: Count }),
    lastSuccessfulIngestionAt: UnixMs.nullable(),
    attention: z.object({
      failedEpisodes: Count,
      neverStarted: Count.describe(
        "Approved channels with no ingestion run row at all.",
      ),
      requested: Count,
    }),
  })
  .meta({ id: "Catalog", description: "The catalog's aggregate state." });
export type Catalog = z.infer<typeof CatalogSchema>;

/** `GET /catalog` */
export const CatalogResponseSchema = z
  .object({ catalog: CatalogSchema })
  .meta({ id: "CatalogResponse", description: "`GET /catalog`" });
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;

// --- query and path parameters (API only; documented and validated from the same schema) ------------

/** `?scope=` — absent for the caller's own view, exactly `all` for the owner's. */
export const ScopeQuerySchema = z.object({
  scope: z
    .enum(["all"])
    .describe(
      "`all` widens the collection to everything the system holds, declined channels included.",
    )
    .optional(),
});
export type ScopeQuery = z.infer<typeof ScopeQuerySchema>;

/** `?limit=` — a positive integer; the default and the ceiling belong to the callee. */
export const LimitQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .describe("Maximum episodes to return, newest first.")
    .optional(),
});
export type LimitQuery = z.infer<typeof LimitQuerySchema>;

/** `?since=` — anything `Date.parse` accepts; default 24 hours ago, clamped to 7 days. */
export const SinceQuerySchema = z.object({
  since: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      "must be an ISO 8601 timestamp",
    )
    .describe(
      "ISO 8601 timestamp. Default: 24 hours ago. Clamped to 7 days ago.",
    )
    .optional(),
});
export type SinceQuery = z.infer<typeof SinceQuerySchema>;

/** `/channels/:id` and its sub-resources. Format is checked by the Registry (400 when malformed). */
export const ChannelParamsSchema = z.object({
  id: z.string().min(1).describe("Canonical `UC…` channel id."),
});
export type ChannelParams = z.infer<typeof ChannelParamsSchema>;

/** `/channels/:id/episodes/:videoId/retry|skip`. */
export const EpisodeParamsSchema = z.object({
  id: z.string().min(1).describe("Canonical `UC…` channel id."),
  videoId: z.string().min(1).describe("YouTube video id."),
});
export type EpisodeParams = z.infer<typeof EpisodeParamsSchema>;

/** `/follows/:channelId`. */
export const FollowParamsSchema = z.object({
  channelId: z.string().min(1).describe("Canonical `UC…` channel id."),
});
export type FollowParams = z.infer<typeof FollowParamsSchema>;
