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

export const HealthResponseSchema = z
  .object({ service: z.literal("api"), status: z.literal("ok") })
  .meta({ id: "HealthResponse", description: "`GET /health`" });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z
      .string()
      .describe("What went wrong. Typed errors are prefixed with their code."),
    code: z
      .string()
      .describe(
        "Present for typed errors: INVALID_INPUT (400), NOT_OWNER (403), NOT_FOUND (404), INVALID_STATE (409), UPSTREAM_UNAVAILABLE (502).",
      )
      .optional(),
  })
  .meta({ id: "ErrorResponse", description: "Every non-2xx response body." });
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
  .enum(["pending", "available", "failed"])
  .meta({ id: "ChannelStatus" });
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const ChannelFailureCodeSchema = z
  .enum(["NO_TRANSCRIPTS", "NO_EPISODES", "INITIAL_IMPORT_FAILED"])
  .meta({
    id: "ChannelFailureCode",
    description:
      "Why initial import failed: every attempted episode lacked captions, the feed was empty, or a technical/mixed failure.",
  });
export type ChannelFailureCode = z.infer<typeof ChannelFailureCodeSchema>;

export const ChannelRequestStatusSchema = z
  .enum(["pending", "approved", "rejected"])
  .meta({ id: "ChannelRequestStatus" });
export type ChannelRequestStatus = z.infer<typeof ChannelRequestStatusSchema>;

const EPISODE_STATUSES = [
  "pending",
  "processing",
  "processed",
  "no_transcript",
  "failed",
] as const;

export const EpisodeStatusSchema = z
  .enum(EPISODE_STATUSES)
  .meta({ id: "EpisodeStatus" });
export type EpisodeStatus = z.infer<typeof EpisodeStatusSchema>;

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

/** Per-run outcome; `skipped` means the run did not attempt an already processed episode. */
export const IngestionRunEpisodeStatusSchema = z
  .enum([...EPISODE_STATUSES, "skipped"])
  .meta({
    id: "IngestionRunEpisodeStatus",
    description:
      "Per-run outcome; `skipped` means the run did not attempt an already processed episode.",
  });
export type IngestionRunEpisodeStatus = z.infer<
  typeof IngestionRunEpisodeStatusSchema
>;

export const FollowOriginSchema = z.enum(["manual", "request"]).meta({
  id: "FollowOrigin",
  description:
    "`manual` for an explicit follow; `request` for the automatic follow after an approved request.",
});
export type FollowOrigin = z.infer<typeof FollowOriginSchema>;

export const ChatRoleSchema = z
  .enum(["user", "assistant"])
  .meta({ id: "ChatRole" });
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageStatusSchema = z
  .enum(["pending", "completed", "failed"])
  .meta({ id: "ChatMessageStatus" });
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusSchema>;

// --- derived states ---------------------------------------------------------------------------------

/** Where a requested channel id stands in the catalog. */
export const CatalogStateSchema = z
  .enum(["not_in_catalog", "pending", "available", "failed", "deleted"])
  .meta({
    id: "CatalogState",
    description: "Where a requested channel id stands in the catalog.",
  });
export type CatalogState = z.infer<typeof CatalogStateSchema>;

/**
 * A request in one phrase: request status combined with the channel's processing and deletion
 * state. Computed server-side so the UI and tests agree.
 */
export const RequestOutcomeSchema = z
  .enum([
    "awaiting_review",
    "rejected",
    "importing",
    "import_failed",
    "following",
    "approved_pending_follow",
    "channel_removed",
  ])
  .meta({
    id: "RequestOutcome",
    description:
      "A request in one phrase: its status combined with the channel's processing and deletion state. Computed server-side so the UI and tests agree.",
  });
export type RequestOutcome = z.infer<typeof RequestOutcomeSchema>;

// --- channels ---------------------------------------------------------------------------------------

export const EpisodeCountsSchema = z
  .object({
    processed: Count,
    pending: Count,
    processing: Count,
    noTranscript: Count,
    failed: Count,
  })
  .meta({
    id: "EpisodeCounts",
    description: "Episodes of a channel by state.",
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

/** Owner-only fields of a channel. */
export const ChannelManagementSchema = z
  .object({
    initialImportCount: z.number().int(),
    failureDetail: z.string().nullable(),
    availableAt: UnixMs.nullable(),
    lastCheckedAt: UnixMs.nullable(),
    lifecycleVersion: z.number().int(),
    createdAt: UnixMs,
    updatedAt: UnixMs,
    episodes: EpisodeCountsSchema,
    latestRun: IngestionRunSummarySchema.nullable(),
    requesterCount: Count.describe(
      "Pending or approved requests for this id. Stands in for follower count, which the Registry cannot know.",
    ),
    stuckPending: z
      .boolean()
      .describe(
        "Pending, not deleted, and no queued or running run, at any age.",
      ),
  })
  .meta({
    id: "ChannelManagement",
    description: "Owner-only fields of a channel.",
  });
export type ChannelManagement = z.infer<typeof ChannelManagementSchema>;

/**
 * A catalog channel as any caller sees it. `following` is about the caller; `management` is present
 * only when the caller is the owner. Everything else is identical for everyone.
 */
export const ChannelSchema = z
  .object({
    channelId: z.string().describe("Canonical `UC…` id."),
    title: z.string(),
    canonicalUrl: z.string(),
    status: ChannelStatusSchema,
    failureCode: ChannelFailureCodeSchema.nullable(),
    deletedAt: UnixMs.nullable(),
    available: z
      .boolean()
      .describe(
        '`status === "available"` and not deleted; the only state that can be followed or read.',
      ),
    lastIngestedAt: UnixMs.nullable(),
    processedCount: Count,
    following: z.boolean().describe("Whether the caller follows this channel."),
    management: ChannelManagementSchema.optional(),
  })
  .meta({
    id: "Channel",
    description:
      "A catalog channel as any caller sees it. `following` is about the caller; `management` is present only when the caller is the owner. Everything else is identical for everyone.",
  });
export type Channel = z.infer<typeof ChannelSchema>;

/** `GET /channels` — available channels by default; `?scope=all` (owner) every state, each with `management`. */
export const ChannelsResponseSchema = z
  .object({ channels: z.array(ChannelSchema) })
  .meta({
    id: "ChannelsResponse",
    description:
      "`GET /channels` — available channels by default; `?scope=all` (owner) every state, each with `management`.",
  });
export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;

/** `GET /channels/:id`, `POST /channels`, `DELETE /channels/:id`, `POST /channels/:id/restore|retry` */
export const ChannelResponseSchema = z.object({ channel: ChannelSchema }).meta({
  id: "ChannelResponse",
  description:
    "`GET /channels/:id`, `POST /channels`, `DELETE /channels/:id`, `POST /channels/:id/restore|retry`",
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
    title: z
      .string()
      .trim()
      .min(1)
      .describe("Overrides the title read from the channel's RSS feed.")
      .optional(),
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

/** Owner-only processing detail of an episode. */
export const EpisodeProcessingSchema = z
  .object({
    attemptCount: Count,
    failureCode: z.string().nullable(),
    failureDetail: z.string().nullable(),
    transcriptCheckedAt: UnixMs.nullable(),
    chunkCount: Count.nullable(),
    vectorizedAt: UnixMs.nullable(),
    processedAt: UnixMs.nullable(),
    createdAt: UnixMs,
    updatedAt: UnixMs,
  })
  .meta({
    id: "EpisodeProcessing",
    description: "Owner-only processing detail of an episode.",
  });
export type EpisodeProcessing = z.infer<typeof EpisodeProcessingSchema>;

/**
 * An episode of a catalog channel. `summary` and `related` are present for followers and the owner;
 * `wasUnread` accompanies a returned summary and reports the caller's receipt state before this
 * response recorded one; `processing` is present only for the owner.
 */
export const EpisodeSchema = z
  .object({
    videoId: z.string(),
    channelId: z.string(),
    channelTitle: z.string(),
    title: z.string(),
    publishedAt: UnixMs,
    status: EpisodeStatusSchema,
    summary: EpisodeSummarySchema.nullable(),
    related: z
      .array(RelatedEpisodeSchema)
      .describe("Already filtered to the caller's eligible channels."),
    wasUnread: z
      .boolean()
      .describe(
        "Whether the caller had no read receipt for the summary before this response recorded one.",
      )
      .optional(),
    processing: EpisodeProcessingSchema.optional(),
  })
  .meta({
    id: "Episode",
    description:
      "An episode of a catalog channel. `summary` and `related` carry content for followers and the owner (null and empty for others); `wasUnread` accompanies a returned summary; `processing` is present only for the owner.",
  });
export type Episode = z.infer<typeof EpisodeSchema>;

/** `GET /channels/:id/episodes?limit=` — newest first. */
export const EpisodesResponseSchema = z
  .object({ episodes: z.array(EpisodeSchema) })
  .meta({
    id: "EpisodesResponse",
    description: "`GET /channels/:id/episodes?limit=` — newest first.",
  });
export type EpisodesResponse = z.infer<typeof EpisodesResponseSchema>;

/** `GET /digest?since=<iso>` — processed episodes from eligible follows, newest first; returned summaries are marked read. */
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
      "`GET /digest?since=<iso>` — processed episodes from eligible follows, newest first; returned summaries are marked read.",
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
    lifecycleVersion: z.number().int(),
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

/** `GET /channels/:id/ingestion-runs` (owner) — newest first. */
export const IngestionRunsResponseSchema = z
  .object({ runs: z.array(IngestionRunSchema) })
  .meta({
    id: "IngestionRunsResponse",
    description: "`GET /channels/:id/ingestion-runs` (owner) — newest first.",
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
    origin: FollowOriginSchema,
    channel: ChannelSchema,
    unreadCount: Count.describe(
      "Processed episodes the caller has no read receipt for.",
    ),
  })
  .meta({
    id: "Follow",
    description:
      "One of the caller's follows, with its channel embedded. `channel.available` is false while the owner has the channel deleted; the follow row stays.",
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

// --- channel requests -------------------------------------------------------------------------------

/**
 * A request for a channel to join the catalog, as both the requester and the owner see it. `outcome`
 * is the requester's one-phrase view; `channel` carries the owner's decision inputs.
 */
export const ChannelRequestSchema = z
  .object({
    requestId: z.string(),
    userEmail: z.string(),
    channelId: z.string(),
    channelTitle: z
      .string()
      .nullable()
      .describe(
        "Feed title captured at submission; null for rows created before the column existed.",
      ),
    submittedUrl: z.string().describe("Exactly what the requester typed."),
    status: ChannelRequestStatusSchema,
    reviewedAt: UnixMs.nullable(),
    reviewedByEmail: z.string().nullable(),
    ownerExplanation: z.string().nullable(),
    autoFollowCompletedAt: UnixMs.nullable(),
    createdAt: UnixMs,
    outcome: RequestOutcomeSchema,
    channel: z
      .object({
        state: CatalogStateSchema,
        failureCode: ChannelFailureCodeSchema.nullable(),
      })
      .describe("Where the requested id stands in the catalog right now."),
  })
  .meta({
    id: "ChannelRequest",
    description:
      "A request for a channel to join the catalog, as both the requester and the owner see it. `outcome` is the requester's one-phrase view; `channel` carries the owner's decision inputs.",
  });
export type ChannelRequest = z.infer<typeof ChannelRequestSchema>;

/** `GET /channel-requests` — the caller's own by default; `?scope=all` (owner) everyone's. Also `GET /channels/:id/requests` (owner). */
export const ChannelRequestsResponseSchema = z
  .object({ requests: z.array(ChannelRequestSchema) })
  .meta({
    id: "ChannelRequestsResponse",
    description:
      "`GET /channel-requests` — the caller's own by default; `?scope=all` (owner) everyone's. Also `GET /channels/:id/requests` (owner).",
  });
export type ChannelRequestsResponse = z.infer<
  typeof ChannelRequestsResponseSchema
>;

/** `POST /channel-requests`, `POST /channel-requests/:id/reject` */
export const ChannelRequestResponseSchema = z
  .object({ request: ChannelRequestSchema })
  .meta({
    id: "ChannelRequestResponse",
    description:
      "`POST /channel-requests`, `POST /channel-requests/:id/reject`",
  });
export type ChannelRequestResponse = z.infer<
  typeof ChannelRequestResponseSchema
>;

/** `POST /channel-requests` — a bare `UC…` id or a URL containing `/channel/UC…`. */
export const CreateChannelRequestBodySchema = z
  .object({
    channelId: z
      .string()
      .trim()
      .min(1)
      .describe(
        "A bare `UC…` id or any URL containing `/channel/UC…`. Handles and other URLs are rejected.",
      ),
  })
  .meta({
    id: "CreateChannelRequestBody",
    description:
      "`POST /channel-requests` — a bare `UC…` id or a URL containing `/channel/UC…`.",
  });
export type CreateChannelRequestBody = z.infer<
  typeof CreateChannelRequestBodySchema
>;

/** 409 body when the requested channel is already available; the UI offers Follow instead. */
export const ChannelAlreadyAvailableResponseSchema = z
  .object({
    error: z.string(),
    code: z.literal("INVALID_STATE"),
    channelId: z.string().describe("The canonical id, ready to follow."),
  })
  .meta({
    id: "ChannelAlreadyAvailableResponse",
    description:
      "409 body when the requested channel is already available; the UI offers Follow instead.",
  });
export type ChannelAlreadyAvailableResponse = z.infer<
  typeof ChannelAlreadyAvailableResponseSchema
>;

/** `POST /channel-requests/:id/approve` — title defaults to the request's stored title. */
export const ApproveChannelRequestBodySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .describe("Overrides the title stored on the request.")
      .optional(),
    initialImportCount: z
      .number()
      .int()
      .positive()
      .describe("Recent episodes to import first; defaults to five.")
      .optional(),
    explanation: z
      .string()
      .trim()
      .min(1)
      .describe("Shown to the requester.")
      .optional(),
  })
  .meta({
    id: "ApproveChannelRequestBody",
    description:
      "`POST /channel-requests/:id/approve` — every field optional; the title defaults to the request's stored title.",
  });
export type ApproveChannelRequestBody = z.infer<
  typeof ApproveChannelRequestBodySchema
>;

export const ApproveChannelRequestResponseSchema = z
  .object({
    request: ChannelRequestSchema,
    channel: ChannelSchema,
    channelCreated: z
      .boolean()
      .describe(
        "True when approval created the channel; initial ingestion should start.",
      ),
  })
  .meta({
    id: "ApproveChannelRequestResponse",
    description: "`POST /channel-requests/:id/approve`",
  });
export type ApproveChannelRequestResponse = z.infer<
  typeof ApproveChannelRequestResponseSchema
>;

/** `POST /channel-requests/:id/reject` */
export const RejectChannelRequestBodySchema = z
  .object({
    explanation: z
      .string()
      .trim()
      .min(1)
      .describe("Shown to the requester.")
      .optional(),
  })
  .meta({
    id: "RejectChannelRequestBody",
    description: "`POST /channel-requests/:id/reject`",
  });
export type RejectChannelRequestBody = z.infer<
  typeof RejectChannelRequestBodySchema
>;

// --- catalog ----------------------------------------------------------------------------------------

/** The catalog's aggregate state. */
export const CatalogSchema = z
  .object({
    channels: z.object({
      available: Count,
      pending: Count,
      failed: Count,
      deleted: Count,
      stuckPending: Count.describe(
        "Pending, not deleted, and no queued or running run.",
      ),
    }),
    episodes: z.object({
      processed: Count,
      tracked: Count,
    }),
    runs: z.object({ active: Count }),
    requests: z.object({ pending: Count }),
    lastSuccessfulIngestionAt: UnixMs.nullable(),
  })
  .meta({ id: "Catalog", description: "The catalog's aggregate state." });
export type Catalog = z.infer<typeof CatalogSchema>;

/** `GET /catalog` (owner) */
export const CatalogResponseSchema = z
  .object({ catalog: CatalogSchema })
  .meta({ id: "CatalogResponse", description: "`GET /catalog` (owner)" });
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;

// --- query and path parameters (API only; documented and validated from the same schema) ------------

/** `?scope=` — absent for the caller's own view, exactly `all` for the owner's. */
export const ScopeQuerySchema = z.object({
  scope: z
    .enum(["all"])
    .describe(
      "`all` widens the collection to everything the system holds. Owner only.",
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

/** `/follows/:channelId`. */
export const FollowParamsSchema = z.object({
  channelId: z.string().min(1).describe("Canonical `UC…` channel id."),
});
export type FollowParams = z.infer<typeof FollowParamsSchema>;

/** `/channel-requests/:id`. */
export const ChannelRequestParamsSchema = z.object({
  id: z.string().min(1).describe("Channel request id."),
});
export type ChannelRequestParams = z.infer<typeof ChannelRequestParamsSchema>;
