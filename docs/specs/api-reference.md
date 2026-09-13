# Feature spec — API reference and browser test client

**Written:** 2026-09-07, against commit `82a4557`. **Rewritten:** 2026-09-12, against PRD v4 (Said on Air) as revised
that day (working copy after `a94921d`), as a new implementation of the contract the document describes.
**Status:** approved by the owner on 2026-09-12; the plan was restructured the same day to depend on nothing in M3
(§8). Implementation not started. Plan: `docs/specs/api-reference-plan.md`.
**History:** the 2026-09-07 version was implemented and merged (`db4777f` … `1e31974`; its `curl` walkthrough is in
`0215d54`). Its mechanism — Zod schemas in `packages/shared`, `hono-openapi`, Scalar at `GET /docs` — is on `main` and
is kept. Its contract described a route table that no longer exists (channel requests, channel restore and retry, per-run
episode outcomes, a waiting code on episodes) and is replaced here rather than patched.
**Owner decisions already made:** code-first, the document is generated from the code (2026-09-07); Scalar served by the
API at `GET /docs` as the one exception to "JSON everywhere" (2026-09-07); the API is modelled on entities, not roles
(2026-09-07); blank optional text is `INVALID_INPUT` (2026-09-08); the API contract is restarted from the M3 model with
no legacy member (2026-09-12); the product is Said on Air and the API document title follows the name (2026-09-12); the API enforces
no authorization at all and is promiscuous about input and representation (2026-09-12).

## 1. Summary

The API describes itself and can be exercised from a browser:

- `GET /openapi.json` — an OpenAPI 3.1 document generated at request time from the route definitions and their
  validation schemas. Public, JSON. It lists exactly the registered routes (PRD §7), so a route cannot ship undocumented.
- `GET /docs` — Scalar's API Reference rendering that document with a try-it client. Public, HTML. The only non-JSON
  response the API serves.

Every request and response shape is a Zod schema in `packages/shared`, with its TypeScript type inferred beside it. The
API validates requests and documents responses from the same schema; the web app imports the types only. This revision
restates that module from PRD v4 §5.3 and §7 with no legacy member: the enums mirror the rewritten Registry schema, the
episode carries recovery state and its latest attempt instead of a waiting code, a discovery run is completed feed
history, Retry returns the attempt it started, and the M4 chat and preference shapes are specified so their routes do
not redesign them later. There is no 403 in the document: the API enforces no authorization, and every caller receives
every entity's full representation. What changed in the PRD since 2026-09-07 and why is PRD §9.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| How the document is produced | **Generated from the code** (2026-09-07, kept). Each handler carries `describeRoute` (tag, summary, description, responses) and `validate(...)` middleware built on the shared schemas. | A hand-written document drifts the day a field changes. The handlers return `c.json<SomeResponse>()`, so the compiler is the drift guard. |
| Where shapes live | **`packages/shared/src/index.ts`**, one module, as `XSchema` values with `export type X = z.infer<typeof XSchema>` beside each (kept). **The module is the whole contract of PRD §7**, M3 and M4 shapes included, written now. | The web needs the types before the routes exist, and a schema no operation references never reaches the document (Zod extracts referenced schemas only), so writing M4 shapes early costs nothing in `/docs`. |
| Restart, not evolution | **Rewritten from the PRD**, section by section (§5), and a test asserts the absence of every removed member (§5.11) from the module and the document. | Owner decision 2026-09-12: no shared schema, reader, or route keeps a legacy table, column, or enum value alive. |
| Document identity | `info.title` and the Scalar page title are **"Said on Air API"**; `info.description` is PRD §1–§2 in three paragraphs. The Worker name, the `@media-digest/*` scope, and storage keys are untouched. | PRD §9: the API document title follows the name; the rest needs an owner decision. |
| Reasons on attempts | `Episode.processing` carries the recovery fields and `latestAttempt: EpisodeIngestionAttempt \| null`. There is no stored waiting code on the episode and no `waiting` count anywhere. | PRD §4.2 rules 11–13: reasons live on attempts only; counts are the four statuses. |
| Reader-safe wait reason | `Episode.waitReason` for every caller on a pending episode, derived from the latest attempt, which is also present in full in `processing.latestAttempt`. | Owner decision 2026-09-12 (PRD §4.2 rule 11, §9), resolving PRD §7's Channel screen against its route row; `skipReason` went reader-safe for the same reason. |
| No authorization | **The API enforces none.** No 403, no `NOT_OWNER`, no `requireOwner`, no Registry role check. Every operation is accepted from any identity; `?scope=all`, `GET /catalog`, `GET /channels/{id}/followers`, and the run routes are open to every caller. `GET /me` still returns the role, for the web. | Owner decision 2026-09-12 (PRD §2, §7, §9): the email header is identity, not authentication, so an API check was never a guard; the web is the one gate. |
| Owner add shortcut | Gone: `POST /channels` creates `requested` for every caller and starts nothing. | Owner decision 2026-09-12: the API reads the role nowhere; the web does add then approve for the owner. |
| Promiscuous input and representation | `CreateChannelBody.title` and `initialImportCount` are honoured from any caller. `management` is a required block on every `Channel`, `processing` on every `Episode`, and summaries and related items go to every caller; the only per-caller fields are `following`, `unreadCount`, and `wasUnread`. | Same decision: one representation per entity, whoever asks; what a user is offered is the UX's job. |
| Episode counts | `EpisodeCounts = { available, pending, failed, skipped }` for channels and the catalog alike; no `tracked`, the client sums. | PRD §4.2 names exactly these four; one schema for both places. |
| Discovery runs | `IngestionRun = { runId, channelId, kind, feedStatus, discoveredCount, episodeLimit, startedAt, finishedAt }`; `management.latestRun` is the same schema. No status, Workflow id, failure, or per-episode outcomes. | PRD §4.2 rules 1–4: a run is completed feed history. One schema instead of a summary variant. |
| Retry and Start responses | `POST …/retry` returns `EpisodeRetryResponse { episode, attempt }`; `POST /channels/:id/runs` returns `IngestionRunResponse { run }` and 502 after recording an unavailable feed. | PRD §7 rows; the owner reads the blocked attempt from the response instead of reloading. |
| Run collection name | **`runs`** on both `GET` and `POST /channels/:id/runs`, tag `runs`; the schemas stay `IngestionRun`, `IngestionRunsResponse`, `IngestionRunResponse` after the table. | Owner decision 2026-09-12: one resource, one name. Every other tag is its URL segment already. |
| Takeaways and availability | `Takeaway = { text, startSec }`; `Episode.summaryAvailableAt` (first `processed_at`) for every caller. | PRD §4.4: the digest's basis is first availability, and its most useful click is the timestamp. |
| Error codes | `ErrorCode` is a shared enum of the four PRD §7 codes; `ErrorResponse.code` uses it and the API's `DomainErrorCode` type is inferred from it. Every 400 the API produces carries `INVALID_INPUT`, the missing-header 400 included. | Scalar shows an enum; two hand-kept lists cannot drift; one 400 shape for clients. |
| Attempt outcome codes | One closed `AttemptOutcomeCode` enum across the four finished attempt statuses; `outcomeCode` is `AttemptOutcomeCode \| null`. | Owner decision 2026-09-12 named the last two codes (PRD §5.3, §9). One enum, not one per status: the same code would otherwise sit in two components for no client benefit; the status-to-family pairing is the Registry's to enforce. |
| Tag vocabulary | One tag per entity that has a registered route, declared in `lib/openapi.ts`; a test asserts the declared set equals the used set. M4 adds `chats` and `preferences` with its routes. | `hono-openapi` emits every declared tag whether or not an operation uses it; an empty group in Scalar is noise. |
| 502 is documented | `errorResponses({ upstream })` adds the `UPSTREAM_UNAVAILABLE` entry; `POST /channels` (feed verification) and `POST /channels/:id/runs` declare it. | `lib/youtube/rss.ts` already throws it and the document did not say so. |
| Identity in the document | `X-User-Email` is an `apiKey`-in-header security scheme `userEmail`, applied globally; `/health`, `/openapi.json`, `/docs` declare `security: []` or are hidden (kept). | Scalar renders it as an auth field and sends the header on every try-it call. It is still not authentication. |
| Validation errors | Unchanged contract: 400 `{ error, code: "INVALID_INPUT" }` naming the field; malformed JSON maps to the same shape (kept). | The web's `ApiError` and every route test rely on it. |
| Blank optional text | Strict (2026-09-08, kept): `title`, `explanation`, and M4's chat `title` are omitted or non-blank through the shared `optionalText` helper. | The API never guesses at intent; a client bug is a named 400. |
| Third-party script | Scalar's script from jsDelivr, pinned to one version, proxy off (kept). Self-hosting stays a follow-up (§9). | Hard rule 2 governs what the Worker calls; the browser loading a pinned open-source dev tool is the smaller footprint. |

## 3. Contract

### 3.1 The two public routes

| Method and path | Who | Response | Notes |
|---|---|---|---|
| `GET /openapi.json` | anyone, no header | `application/json`, OpenAPI 3.1 | `info.title` "Said on Air API"; `info.version` from `apps/api/package.json`; `components.securitySchemes.userEmail`; every registered route except the two hidden ones; components named after the shared types. Generated once per isolate. |
| `GET /docs` | anyone, no header | `text/html` | Scalar page, configuration in §7. Hidden from the document. |

### 3.2 Document conventions

- **Tags** are the entities with routes, named by their URL segment: `health`, `me`, `catalog`, `channels`,
  `episodes`, `runs`, `follows`, `digest`, and from M4 `chats`, `preferences`. One tag per operation.
- **Summary** is the PRD §7 purpose column shortened to one line, with no role in it. **Description** carries the nuance
  from the same row: `?scope=all`, which fields depend on the caller's follows, read receipts, what a 409 means, and
  "the web offers this to the owner" where that is so, since the API accepts the call from anyone.
- **Responses:** the success status with its shared schema (two entries where the status varies); `400` on every
  operation but `/health`; never `403`, since the API enforces no authorization; `404` where the handler
  looks something up; `409` where a state rule applies, spelled out; `502` where YouTube is called. Error bodies are
  `ErrorResponse`; the declined-channel 409 is `ChannelDeclinedResponse`.
- **Parameters** are documented by the validators only: `validate("param", …)`, `validate("query", …)`,
  `validate("json", …)`. Nothing is declared twice.
- **Component names** equal type names through Zod 4's `.meta({ id })`; `.describe()` and `.meta({ description })`
  are the text readers see in Scalar. A schema carrying an id is never re-described where it is used.

### 3.3 Operations

The whole PRD §7 table, as the document must show it. M3 and M4 rows register with their milestones; the coverage
test lists exactly the registered routes at any time. No row has a 403: the API enforces no authorization.

| Operation | Tag | Success | Errors | Since |
|---|---|---|---|---|
| `GET /health` | health | 200 `HealthResponse` | none; `security: []` | M1 |
| `GET /me` | me | 200 `MeResponse` | 400 | M1 |
| `GET /catalog` | catalog | 200 `CatalogResponse` | 400 | M2; `transcripts` M3 |
| `GET /channels` `?scope=all` | channels | 200 `ChannelsResponse` | 400 | M2 |
| `POST /channels` `CreateChannelBody` | channels | 201 `ChannelResponse` (created), 200 `ChannelResponse` (followed) | 400, 409 `ChannelDeclinedResponse`, 502 | M2 |
| `GET /channels/{id}` | channels | 200 `ChannelResponse` | 400 404 | M2 |
| `POST /channels/{id}/request` | channels | 200 `ChannelResponse` | 400 404 409 | M2 |
| `POST /channels/{id}/approve` `ApproveChannelBody` | channels | 200 `ChannelResponse` | 400 404 409 | M2 |
| `POST /channels/{id}/decline` `DeclineChannelBody` | channels | 200 `ChannelResponse` | 400 404 409 | M2 |
| `POST /channels/{id}/pause`, `…/resume` | channels | 200 `ChannelResponse` | 400 404 409 | M2 |
| `GET /channels/{id}/followers` | channels | 200 `FollowersResponse` | 400 404 | M2 |
| `GET /channels/{id}/episodes` `?limit=` | episodes | 200 `EpisodesResponse` | 400 404 | M2 |
| `POST /channels/{id}/episodes/{videoId}/retry` | episodes | 200 `EpisodeRetryResponse` | 400 404 409 (running attempt) | M3 (`EpisodeResponse` until the attempt starter exists) |
| `POST /channels/{id}/episodes/{videoId}/skip` | episodes | 200 `EpisodeResponse` | 400 404 409 (not failed) | M2 |
| `GET /channels/{id}/runs` | runs | 200 `IngestionRunsResponse` | 400 404 | M2; was `ingestion-runs` until 2026-09-12 |
| `POST /channels/{id}/runs` | runs | 200 `IngestionRunResponse` | 400 404 409 (not approved) 502 | M3 |
| `GET /follows` | follows | 200 `FollowsResponse` | 400 | M2 |
| `PUT /follows/{channelId}` | follows | 200 `FollowResponse` | 400 404, 409 `ChannelDeclinedResponse` | M2 |
| `DELETE /follows/{channelId}` | follows | 200 `FollowResponse` | 400 404 | M2 |
| `GET /digest` `?since=` | digest | 200 `DigestResponse` | 400 | M2; availability basis M3 |
| `POST /chats` `CreateChatBody` | chats | 201 `ChatResponse` | 400 | M4 |
| `GET /chats` | chats | 200 `ChatsResponse` | 400 | M4 |
| `GET /chats/{id}/messages` `?limit=` | chats | 200 `ChatMessagesResponse` | 400 404 | M4 |
| `POST /chats/{id}/messages` `SendMessageBody` | chats | 200 `ChatExchangeResponse` | 400 404 | M4 |
| `GET /preferences` | preferences | 200 `PreferencesResponse` | 400 | M4 |
| `PUT /preferences` `UpdatePreferencesBody` | preferences | 200 `PreferencesResponse` | 400 | M4 |

## 4. Dependencies

None new. The three approved on 2026-09-07 are installed and pinned in `pnpm-lock.yaml`:

| Package | Installed | Workspace | Role |
|---|---|---|---|
| `zod` | 4.4.3 | `packages/shared`, `apps/api` | Schemas, inferred types, native JSON Schema output |
| `hono-openapi` | 1.3.2 | `apps/api` | `describeRoute`, `validator`, `resolver`, `generateSpecs` |
| `@scalar/hono-api-reference` | 0.12.1 | `apps/api` | The `/docs` HTML |

Nothing is added to `apps/web`; Zod reaches it as types only. The DownSub status call (§5.8) uses `fetch`; hard rule 2
already permits `api.downsub.com`.

## 5. The shared contract (`packages/shared/src/index.ts`)

### 5.1 Conventions

- One module, sections in this order, each headed by a comment naming the PRD section it mirrors. `XSchema` is the
  value, `X` the inferred type, every name below exported.
- Timestamps are `UnixMs` (`z.number().int()`, "Unix time, milliseconds"). Counts are `Count`
  (`z.number().int().nonnegative()`). Ids are non-empty strings; id *format* is the Registry's check.
- Enums are `z.enum([...])` mirroring PRD §5.3's `CHECK` constraints exactly (§5.3 below). `T | null` is
  `.nullable()`; a field that may be absent is `.optional()`; a field is never both.
- Optional free text uses `optionalText(description)`: `z.string().trim().min(1).optional()`, message "must be omitted
  or non-blank". Omit the field to mean "not provided"; `""`, whitespace, and `null` are `INVALID_INPUT`.
- Component ids are given to every entity, enum, and body schema; response envelopes carry an id too, and Zod keeps
  the envelope's own root inline while extracting what it references.
- Descriptions say what the field means to a client, not how the Registry computes it, in one sentence.

### 5.2 Common

```ts
type HealthResponse = { service: "api"; status: "ok" };
type ErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "INVALID_STATE" | "UPSTREAM_UNAVAILABLE";   // no NOT_OWNER: nothing is authorized
type ErrorResponse = { error: string; code?: ErrorCode };   // code absent only on 500
type UserRole = "owner" | "user";
type MeResponse = { email: string; role: UserRole };
```

### 5.3 Enums

| Schema | Values | Mirrors |
|---|---|---|
| `UserRole` | `owner`, `user` | `global_users.role` |
| `ErrorCode` | `INVALID_INPUT`, `NOT_FOUND`, `INVALID_STATE`, `UPSTREAM_UNAVAILABLE` | PRD §7 error mapping; no `NOT_OWNER` |
| `ChannelStatus` | `requested`, `approved`, `declined` | `channels.status` |
| `PausedBy` | `owner`, `system` | `channels.paused_by` |
| `EpisodeStatus` | `pending`, `available`, `failed`, `skipped` | `episodes.status` |
| `RecoveryMode` | `publication`, `replacement` | `episodes.recovery_mode`, attempts |
| `EpisodeFailureCode` | `INGESTION_TIMEOUT` | `episodes.failure_code` |
| `EpisodeSkipReason` | `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`, `OWNER` | `episodes.skip_reason` |
| `EpisodeWaitReason` | `CAPTIONS`, `LIVE_OR_UPCOMING`, `PROVIDER_LIMIT` | the outcome codes of a `waiting` attempt, PRD §4.2 rule 11; derived, not stored |
| `SummaryFormat` | `structured`, `raw_fallback` | `episode_summaries.format` |
| `IngestionRunKind` | `initial`, `scheduled` | `ingestion_runs.kind` |
| `FeedStatus` | `read`, `unavailable` | `ingestion_runs.feed_status` |
| `AttemptTrigger` | `channel_ingestion`, `scheduled_recovery`, `owner_retry` | `episode_ingestion_attempts.trigger` |
| `AttemptStatus` | `running`, `available`, `failed`, `skipped`, `waiting`, `blocked` | `episode_ingestion_attempts.status` |
| `AttemptOutcomeCode` | `CAPTIONS`, `LIVE_OR_UPCOMING`, `PROVIDER_LIMIT`, `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`, `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `PROVIDER_HTTP`, `PROVIDER_PARSE`, `TRANSCRIPT_TOO_LARGE`, `EMBEDDING_FAILED`, `VECTORIZE_INCOMPLETE`, `SUMMARY_FAILED`, `WORKFLOW_LOST` | `episode_ingestion_attempts.outcome_code`, PRD §5.3 (closed 2026-09-12) |
| `TranscriptProviderStatus` | `ok`, `auth_failed`, `unreachable` | `m3-ingestion.md` §2, catalog health |
| `ChatRole` | `user`, `assistant` | `chat_messages.role` |
| `ChatMessageStatus` | `pending`, `completed`, `failed` | `chat_messages.status` |

`AttemptOutcomeCode`'s description states the per-status families from PRD §5.3: `waiting` → `CAPTIONS`,
`LIVE_OR_UPCOMING`, `PROVIDER_LIMIT`; `skipped` → `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`; `blocked` → `PROVIDER_AUTH`,
`PROVIDER_LIMIT`; `failed` → `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `PROVIDER_HTTP`, `PROVIDER_PARSE`,
`TRANSCRIPT_TOO_LARGE`, `EMBEDDING_FAILED`, `VECTORIZE_INCOMPLETE`, `SUMMARY_FAILED`, `WORKFLOW_LOST`. `running` and
`available` attempts carry null. `EpisodeWaitReason` is the `waiting` family on its own, for `Episode.waitReason`.

### 5.4 Channels (PRD §4.1, §4.3, §7)

```ts
type EpisodeCounts = { available: number; pending: number; failed: number; skipped: number };
type ChannelManagement = {                       // every caller
  initialImportCount: number;
  reviewedByEmail: string | null;
  pausedBy: PausedBy | null; pausedAt: number | null;
  lastCheckedAt: number | null;                  // the feed was last read; unavailable reads do not move it
  latestRun: IngestionRun | null;                // the newest completed discovery run
  neverStarted: boolean;                         // approved and no run row at all
  createdAt: number; updatedAt: number;
};
type Channel = {
  channelId: string; title: string; canonicalUrl: string;
  status: ChannelStatus;
  paused: boolean;                               // approved channels only; no new discovery while true
  approvedAt: number | null;                     // first approval, never reset; declined + non-null reads "Withdrawn"
  reviewedAt: number | null; reviewNote: string | null;
  lastIngestedAt: number | null;                 // MAX(processed_at) over the channel's episodes
  episodes: EpisodeCounts;
  following: boolean; followerCount: number;
  management: ChannelManagement;                 // always present, for every caller
};
type ChannelsResponse = { channels: Channel[] };
type ChannelResponse  = { channel: Channel };
type CreateChannelBody  = { channelId: string; title?: string; initialImportCount?: number };  // id: bare UC… or /channel/UC… URL
type ApproveChannelBody = { title?: string; initialImportCount?: number; explanation?: string };
type DeclineChannelBody = { explanation?: string };
type ChannelDeclinedResponse = {                 // 409 body for POST /channels and PUT /follows/:channelId
  error: string; code: "INVALID_STATE"; channelId: string; status: "declined";
  reviewNote: string | null; reviewedAt: number | null;
};
```

`initialImportCount` is a positive integer; `channelId` is trimmed and non-empty, the handle rule and feed check stay
in the handler. `title` and `initialImportCount` are honoured from any caller (owner decision 2026-09-12); the UI
offers them to the owner only. `POST /channels` creates a `requested` channel for every caller and starts nothing;
there is no owner shortcut (owner decision 2026-09-12), and the web's owner add follows with
`POST /channels/:id/approve`. `ChannelManagement` no longer repeats `episodes`; `Channel` carries it for every caller.
`management` is a required block on every `Channel` the API returns, for every caller, `Follow.channel` included;
`?scope=all`, open to any caller, only adds declined channels to the list. Nothing in the block is role-gated: the web
renders it on the Owner screens only.

### 5.5 Episodes, attempts, and the digest (PRD §4.2, §4.4, §7)

```ts
type Takeaway = { text: string; startSec: number | null };           // null when the model gave no usable marker
type EpisodeSummary =
  | { format: "structured"; executiveSummary: string; takeaways: Takeaway[]; topicTags: string[] }
  | { format: "raw_fallback"; rawText: string };
type RelatedEpisode = { videoId: string; title: string };            // already filtered to the caller's eligible channels
type EpisodeIngestionAttempt = {                                     // one Workflow instance, or one blocked start
  attemptId: string; videoId: string;
  trigger: AttemptTrigger; requestedByEmail: string | null;         // set exactly for owner_retry
  recoveryMode: RecoveryMode;
  status: AttemptStatus; outcomeCode: AttemptOutcomeCode | null; failureDetail: string | null;   // code null while running and on available
  workflowId: string | null;                                         // null for blocked
  stagedChunkCount: number | null;                                   // set when embedding began
  startedAt: number; finishedAt: number | null;                      // finishedAt null only while running
};
type EpisodeProcessing = {                                           // every caller
  discoveredByRunId: string;
  recoveryMode: RecoveryMode | null;                                 // the four recovery fields are all set or all null
  recoveryStartedAt: number | null; recoveryDeadlineAt: number | null; nextAttemptAt: number | null;
  attemptCount: number;                                              // launched since the window last started; blocked never counts
  latestAttempt: EpisodeIngestionAttempt | null;                     // where the reason lives
  failureCode: EpisodeFailureCode | null; failureDetail: string | null;   // written once, at the timeout
  skippedAt: number | null; skippedByEmail: string | null;
  transcriptCheckedAt: number | null; chunkCount: number | null; vectorizedAt: number | null;
  createdAt: number; updatedAt: number;
};
type Episode = {
  videoId: string; channelId: string; channelTitle: string; title: string;
  publishedAt: number;
  status: EpisodeStatus;
  skipReason: EpisodeSkipReason | null;                              // every caller
  waitReason: EpisodeWaitReason | null;                              // every caller; pending only, from the latest attempt
  summaryAvailableAt: number | null;                                 // first processed_at; the digest's basis
  summary: EpisodeSummary | null; related: RelatedEpisode[];         // for every caller; null and empty only when the episode has none
  wasUnread?: boolean;                                               // eligible callers only, with a returned summary: no receipt before this response recorded one
  processing: EpisodeProcessing;                                     // always present, for every caller
};
type EpisodesResponse    = { episodes: Episode[] };
type EpisodeResponse     = { episode: Episode };
type EpisodeRetryResponse = { episode: Episode; attempt: EpisodeIngestionAttempt };   // running, or blocked
type DigestResponse      = { since: number; episodes: Episode[] };  // since: the window start actually used
```

`processedAt` is not repeated inside `processing`; it is `summaryAvailableAt`. Vector generation ids are internal to the
index and not exposed. `waitReason` (owner decision 2026-09-12) is derived in `lib/episode-view.ts` from the latest
attempt, for every caller: a `waiting` attempt gives its code; a `blocked` attempt with `PROVIDER_LIMIT` gives
`PROVIDER_LIMIT`, the same wait as the in-flight provider reason (PRD §7 Channel screen); a running attempt, a
technical failure, a `PROVIDER_AUTH` block, no attempt, or any status other than `pending` gives null, which the web
phrases as "Not summarised yet". The stored `waiting_code` column is gone (§5.11); this field is a projection. Read
receipts, and therefore `wasUnread`, exist only for eligible callers (PRD §4.4); every other caller receives the same
summaries with no receipt recorded.

### 5.6 Discovery runs (PRD §4.2 rules 1–4)

```ts
type IngestionRun = {
  runId: string; channelId: string;
  kind: IngestionRunKind; feedStatus: FeedStatus;
  discoveredCount: number;                        // 0 for "nothing new" and for an unavailable feed
  episodeLimit: number | null;                    // the initial run's initial_import_count
  startedAt: number; finishedAt: number;          // a run exists only once complete
};
type IngestionRunsResponse = { runs: IngestionRun[] };   // newest first
type IngestionRunResponse  = { run: IngestionRun };      // POST /channels/:id/runs
```

A run carries `discoveredCount` only. The episodes it discovered are those whose `processing.discoveredByRunId` names
it, a client-side join on the owner channel detail; there is no per-run episode list (PRD §4.2 rule 3).

### 5.7 Follows and followers (PRD §4.3)

```ts
type Follow = {
  channelId: string; followedAt: number;
  unfollowedAt: number | null;                    // the tombstone; null while active
  channel: Channel;                               // any status, so a declined follow still lists with its note
  unreadCount: number;                            // available episodes with no receipt; 0 unless the channel is approved
};
type FollowsResponse  = { follows: Follow[] };    // most recent ingestion first
type FollowResponse   = { follow: Follow };
type Follower         = { email: string; followedAt: number };
type FollowersResponse = { followers: Follower[] };   // oldest first
```

### 5.8 Catalog (PRD §7 `GET /catalog`)

```ts
type TranscriptProviderHealth = { remainingCredits: number | null; status: TranscriptProviderStatus };
type Catalog = {
  channels: { requested: number; approved: number; paused: number; declined: number };
  episodes: EpisodeCounts;
  attention: { failedEpisodes: number; neverStarted: number; requested: number };
  lastSuccessfulIngestionAt: number | null;       // MAX(episodes.processed_at)
  transcripts: TranscriptProviderHealth;          // unreachable with null credits when no DOWNSUB_API_KEY is configured
};
type CatalogResponse = { catalog: Catalog };
```

### 5.9 Chats and preferences (PRD §4.5, §7; M4)

Shapes for the M4 routes, mirroring the User DO's existing `Chat`, `ChatMessage`, `ChatMessageSource`, and
`UserPreferences` records (`do/user/types.ts`), which are already stored and tested. The M4 plan registers the routes;
it should confirm these rather than redesign them.

```ts
type Chat = { chatId: string; title: string | null; createdAt: number; updatedAt: number };
type ChatSource = {                                // a citation snapshot; catalog changes never rewrite it
  position: number; videoId: string; channelId: string;
  videoTitle: string; channelTitle: string; startSec: number;   // link: https://youtu.be/<videoId>?t=<startSec>
};
type ChatMessage = {
  messageId: string; chatId: string; sequenceNumber: number;
  role: ChatRole; content: string;                 // empty while an assistant reply is pending
  status: ChatMessageStatus; failureCode: string | null;
  replyToMessageId: string | null;                 // set on every assistant message
  sources: ChatSource[];
  createdAt: number; updatedAt: number;
};
type ChatsResponse        = { chats: Chat[] };                 // most recently updated first
type ChatResponse         = { chat: Chat };
type ChatMessagesResponse = { chat: Chat; messages: ChatMessage[] };   // ascending sequence
type ChatExchangeResponse = { chat: Chat; userMessage: ChatMessage; assistantMessage: ChatMessage };
type CreateChatBody       = { title?: string };                // optionalText
type SendMessageBody      = { message: string };               // trimmed, non-blank
type Preferences          = { systemRules: string; updatedAt: number | null };   // null until first saved
type PreferencesResponse  = { preferences: Preferences };
type UpdatePreferencesBody = { systemRules: string };          // trimmed; empty clears the rules
```

The reserved `chat_messages.channel_id` and the internal `source_id` are not exposed. `TODO(owner):` ceilings for
`message` and `systemRules` length, and whether `POST /chats/:id/messages` answers 200 with the exchange (as here) or
201 with the assistant message alone, are the M4 plan's to fix.

### 5.10 Query and path parameters

```ts
type ScopeQuery   = { scope?: "all" };                     // owner only; anything else is INVALID_INPUT
type LimitQuery   = { limit?: number };                    // coerced positive integer; default and ceiling belong to the callee
type SinceQuery   = { since?: string };                    // anything Date.parse accepts, documented as date-time
type ChannelParams = { id: string };
type EpisodeParams = { id: string; videoId: string };
type FollowParams  = { channelId: string };
type ChatParams    = { id: string };
```

An empty `?limit=` or `?since=` is a 400, as since 2026-09-07.

### 5.11 Removed members

The module exports none of these and the document contains none of them; the coverage test asserts each fact by name
or by enum equality, not by grepping description text (some words, such as `LIVE_OR_UPCOMING`, legitimately appear in
descriptions of attempt outcomes):

- Schemas and components: `EpisodeWaitingCode` and `EpisodeProcessing.waitingCode` (the stored column;
  `Episode.waitReason` is the derived replacement), `IngestionRunStatus`, `IngestionRunEpisode`,
  `IngestionRunEpisodeStatus`, `IngestionRunSummary`, `EpisodeProcessing.processedAt`,
  `ChannelManagement.episodes`, `Catalog.runs`, and everything removed on 2026-09-10 (`ChannelRequest*`,
  `RequestOutcome`, `FollowOrigin`, `CatalogState`, `ChannelFailureCode`, `ChannelAlreadyAvailableResponse`).
- Properties: `waiting` and `tracked` in any counts object; `status`, `workflowId`, `failureCode`, `failureDetail`,
  `episodes` on a run.
- Enum members: `NO_CAPTIONS` and `LIVE_OR_UPCOMING` in `EpisodeSkipReason`; `owner_retry` in `IngestionRunKind`.
- Shapes: `takeaways` as `string[]` (it is `Takeaway[]`).

## 6. Validation and error mapping in `apps/api`

- `lib/validation.ts` `validate(target, schema)` wraps `hono-openapi`'s `validator` with one hook that throws
  `DomainError("INVALID_INPUT", "<field path> <issue message>")` from the first issue (kept). Handlers read
  `c.req.valid("json" | "query" | "param")`.
- `middleware/errors.ts` maps `DomainError` codes to status through one table and turns Hono's malformed-JSON
  `HTTPException` into `{ error: "body must be JSON", code: "INVALID_INPUT" }` (kept).
- `lib/errors.ts` derives `DomainErrorCode` from the shared `ErrorCodeSchema` (`type DomainErrorCode = ErrorCode`,
  `DOMAIN_ERROR_CODES = ErrorCodeSchema.options`), so the wire enum and the thrown codes are one list.
- `middleware/user.ts` answers the missing or malformed header with `{ error, code: "INVALID_INPUT" }`, so every 400 the
  API produces has the same shape (new; the body gains one field).
- No-body actions (`request`, `approve`, `decline`, `pause`, `resume`, `runs`, `retry`, `skip`) accept a request with no
  JSON content type; a JSON content type with an empty or malformed body is a 400.
- There is no `requireOwner`, `assertOwner`, or `isOwner`, and `middleware/owner.ts` does not exist. Registry methods
  that record a reviewer, skipper, or requester take the acting email and record it without checking a role.

## 7. The `/docs` page

Scalar configuration, all explicit, in `routes/docs.ts`:

| Option | Value | Why |
|---|---|---|
| `url` | `/openapi.json` | Same origin. |
| `cdn` | `https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0` | Pinned in one exported constant; bump deliberately. |
| `proxyUrl` | `""` | No request leaves the browser except to this API. |
| `pageTitle` | `Said on Air API` | PRD §9. |
| `persistAuth` | `true` | The email survives reloads; it is an identity, not a secret. |
| `hideClientButton` | `true` | The try-it panel is enough. |
| `authentication.preferredSecurityScheme` | `userEmail` | The auth field is open on first load. |

Telemetry: Scalar's open-source build sends nothing unless an analytics plugin is loaded; none is.

## 8. Relationship to the M3 and M4 plans

- **This spec and its plan depend on nothing in M3** (owner decision 2026-09-12). Two pieces moved here from
  `m3-ingestion-plan.md` to make that true: the Registry schema rewrite with its read model and the writes the
  registered routes perform (formerly M3 Step 4's schema section; now plan Step 4), and the DownSub status wrapper
  behind `Catalog.transcripts` (formerly one bullet of M3 Step 1; now plan Step 3).
- **This spec owns** `packages/shared/src/index.ts`, the Registry schema (`migrations/registry/0001_init.sql`) and the
  stores' read model, `lib/transcripts/status.ts`, `lib/openapi.ts`, `lib/validation.ts`, `routes/docs.ts`, the
  `describeRoute` text and response schemas of every route (§3.3), `test/openapi.test.ts`, and the one-parse-per-schema
  rule. The ingestion writes (`recordDiscovery`, `beginAttempt`, `markStaged`, `finishAttempt`, `recordBlockedAttempt`,
  `completeAttempt`), the transcript adapter, the Workflow, the crons, and the handlers of the M3 and M4 routes belong
  to their plans, and M3 Step 4 now starts from this plan's Step 4.
- **`m3-ingestion-plan.md` Step 3 is superseded** by §5 here. Where the two differed, this spec wins: `IngestionRunSummary`
  is gone in favour of `IngestionRun` on `latestRun`; `EpisodeCounts` has no `tracked`; `ChannelManagement` does not
  repeat `episodes`; `processing.processedAt` is `summaryAvailableAt`. M3 plan Step 3 was struck on approval (2026-09-12)
  and points here.
- **M3 Step 7 and the M4 plan** register their routes with the tag, summary, success schema, and errors in §3.3; the
  coverage test, the tag test, and the parse assertions fail until they do, so no separate documentation step exists.

## 9. Out of scope and follow-ups

- Renaming the Worker (`media-digest-api`), the `@media-digest/*` package scope, the repository, and the browser storage
  keys after the product: owner decision pending (PRD §9).
- Self-hosting Scalar (add `@scalar/api-reference` as a dev dependency, copy `dist/browser/standalone.js` into an
  `assets` directory before `dev`/`deploy`, point `cdn` at it). Still a swap of one constant.
- Runtime response validation, a typed `hc` client, and generating the web's `api.ts` from the document.
- CORS landed on 2026-09-07 (`lib/cors.ts`, `WEB_ORIGINS`) and needs nothing here.

## 10. Acceptance criteria

1. `GET /openapi.json` without a header returns 200 JSON: `openapi` starts with `3.1`, `info.title` is
   "Said on Air API", `components.securitySchemes.userEmail` is an `apiKey` in header `X-User-Email`, and for every
   route the Hono app registers other than `/openapi.json` and `/docs` there is exactly one operation with one tag, a
   success response, and (except `/health`) a documented 400, and no operation documents a 403. No operation exists
   that the app does not register.
2. The set of tags declared in the document equals the set of tags used by its operations.
3. Component schemas include `ErrorCode`, `Channel`, `ChannelManagement`, `EpisodeCounts`, `Episode`,
   `EpisodeSummary`, `Takeaway`, `EpisodeWaitReason`, `AttemptOutcomeCode`, `EpisodeIngestionAttempt`,
   `EpisodeProcessing`, `IngestionRun`, `Follow`, `Follower`, `Catalog`, `TranscriptProviderHealth`, and the enums of
   §5.3 that a registered route references; no `#/$defs/` reference survives.
4. Every member in §5.11 is absent from the module's exports and from the document, asserted by name and by enum
   equality (`EpisodeSkipReason` is exactly the four values; `IngestionRunKind` exactly two).
5. `GET /docs` without a header returns 200 `text/html` whose body contains the pinned CDN URL, `/openapi.json`, and
   `<title>Said on Air API</title>`, and does not contain `proxy.scalar.com`.
6. Validation contract, each a 400 `{ error, code: "INVALID_INPUT" }`: no header; a JSON content type with body
   `not json`; `POST /channels` with `{}` (names `channelId`); `title: ""`, `title: "  "`, and `title: null`;
   `?scope=bogus`; `?since=yesterday`; `?limit=`. A no-body `POST` to an action route with no content type succeeds.
7. `POST /channels` documents 502, and `lib/youtube/rss.ts`'s `UPSTREAM_UNAVAILABLE` surfaces as 502 `ErrorResponse`.
8. Every registered route's success body is parsed with its shared schema by `expectShape` in a route test at least
   once, and `ChannelDeclinedResponse` is parsed from both routes that produce it.
9. `pnpm check` is green; `pnpm build` then `grep -ril zod apps/web/dist` finds nothing.
10. Under `wrangler dev`: the `curl` legs in the plan are recorded with their results; the browser leg (open `/docs`,
    enter an email, run `GET /me`, `GET /channels`, `POST /channels` with `@veritasium`, confirm the network tab shows
    `127.0.0.1:8787` only) is the owner's.
11. `AGENTS.md` carries the edits in §11.
12. No authorization: `middleware/owner.ts` does not exist and no route or Registry method checks the role; in a
    route test a non-owner identity performs approve, decline, pause, resume, retry, skip, `GET /catalog`,
    `GET /channels?scope=all`, and `GET /channels/{id}/followers` successfully and is recorded as reviewer or skipper
    where the schema has such a field; a non-follower's `GET /channels/{id}/episodes` carries `summary` and
    `processing`, no `wasUnread`, and records no receipt; `ErrorCode` has exactly four values.
13. The Registry schema is the PRD's: a fresh Registry lists `0001_init` alone in `_migrations`, has no
    `ingestion_run_episodes` table and no `waiting_code`, `last_ingested_at`, or `lifecycle_version` column, and each
    table check of PRD §5.3 rejects the write it forbids. `GET /catalog` carries `transcripts`: under `wrangler dev`
    with `DOWNSUB_API_KEY` set, `status: "ok"` and a numeric `remainingCredits`; without the key, `unreachable` and
    null; the route never fails because of the provider.

## 11. `AGENTS.md` and PRD edits carrying the decisions

`AGENTS.md` (engineering; edited by the plan's last step):

- **Repo layout**, `packages/shared`: add "sections follow `docs/specs/api-reference.md` §5; no legacy member of the
  2026-09-12 restart".
- **API code**: after the `test/openapi.test.ts` sentence, add "or when a declared tag has no operation, or when a member
  removed by the 2026-09-12 restart reappears (`api-reference.md` §5.11)". Add "The document's title follows the product
  name (PRD §9)". Add "`lib/errors.ts` infers `DomainErrorCode` from the shared `ErrorCodeSchema`; add a code there".
- **Testing**: beside the one-parse-per-schema rule, add "`test/validation.test.ts` pins the 400 contract in one place".
- **Repo layout**: delete the `middleware/owner.ts` line when Step 2 deletes the file (the line is marked meanwhile).
  The Identity plumbing bullet already states the no-authorization rule (applied 2026-09-12).

`docs/PRD.md` (product; the owner's to change, proposed here):

- Precedence paragraph and §9: "`api-reference` for the generated API document (decided 2026-09-07)" becomes
  "(decided 2026-09-07, contract restated 2026-09-12)".
- Both §7 questions this spec raised, the `runs` name and the reader-safe `waitReason`, are recorded in §4.2, §7, and
  §9 (2026-09-12); nothing is outstanding.
