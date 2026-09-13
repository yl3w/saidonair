# Implementation plan — API reference and browser test client

**Implements:** `docs/specs/api-reference.md` (rewritten 2026-09-12) under the rules in `AGENTS.md`.
**Written:** 2026-09-12, against the PRD working copy after `a94921d`. Supersedes the 2026-09-07 plan, which completed in five commits
(`db4777f` … `1e31974`); its `curl` walkthrough is preserved in `0215d54`.
**Status:** complete 2026-09-12, five commits on `main` (`201ee3e` Step 1, `11c74ef` Step 2, `22c01ca` Step 3,
`4871782` Step 4, then this documentation commit), `pnpm check` green after each (95, 106, 117, 122 tests). No new
dependencies. Two facts learned on the way: DownSub's status body wraps the credits in a `data` envelope
(`{ status, data: { remainingCredits, … } }`), which the 2026-09-08 probe notes had dropped, so `status.ts` reads
`data.remainingCredits`; and every episode row must name a run, so `seedEpisode` shares one seed run per channel at
t=0, which means a channel with seeded episodes is never "never started" in a test. Later the same day the owner
renamed the window vocabulary (PRD §9): `recovery_mode` → `intent` (`publish` | `replace`), `recovery_started_at`
→ `window_started_at`, `recovery_deadline_at` → `window_deadline_at`, `recovery_vector_generation` →
`staged_vector_generation`, `RecoveryMode` → `ProcessingIntent`; `0001` was edited in place, and this plan's text
carries the new names.
**Shape:** five steps, each one commit ending with `pnpm check` green, in order. Steps 1 to 3 are small and independent
of each other. Step 4 is one large commit: the Registry schema rewrite, its read model, and the restated contract are
one unit because the stores return records typed against the shared module and the old shapes have no source in the
new tables; it is reviewed by file group. Step 5 is documentation and the walkthrough. Nothing here waits on M3;
`m3-2-attempt-ledger-plan.md` (M3.2, formerly `m3-ingestion-plan.md` Step 4) builds its ingestion writes on this plan's Step 4 instead. Decisions this plan makes are
marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §10, all thirteen criteria. In short: the document is titled after the product and lists exactly the registered
routes with the tags in use; no 403 and no role check exist anywhere in the API; the rewritten `0001` applies on a fresh
Registry and its table checks hold; no member of spec §5.11 exists in the module or the document; every 400 is
`{ error, code: "INVALID_INPUT" }`; every registered route's success body parses against its schema; `GET /catalog`
reports the transcript provider's health; `pnpm check` is green; the web bundle has no Zod; the `wrangler dev` legs are
recorded here; `AGENTS.md` carries spec §11.

## What exists and is kept

Installed and pinned: `zod` 4.4.3, `hono-openapi` 1.3.2, `@scalar/hono-api-reference` 0.12.1. On `main`:
`lib/validation.ts` (`validate` and the `INVALID_INPUT` hook), `lib/openapi.ts` (`jsonResponse`, `errorResponses`,
the memoized `openApiDocument`), `routes/docs.ts` (pinned `SCALAR_CDN`, proxy off), the `HTTPException` branch of
`middleware/errors.ts`, `expectShape` in `test/helpers.ts`, the derive-from-`app.routes` structure of
`test/openapi.test.ts`, `do/migrations.ts` (the runner), and the Registry store layout under `do/registry/`. None of it
is rewritten for its own sake; each step below changes only what the spec changes.

## What moved here from the M3 plan (2026-09-12)

So that this plan depends on nothing in M3, two pieces of `m3-ingestion-plan.md` now live here and M3 builds on them:

- **The Registry schema rewrite and read model**, formerly the "Schema rewrite" section of M3 Step 4: the rewritten
  `0001_init.sql`, the deletion of `0002`, the migration index and its test, the stores that read episodes with their
  latest attempt, runs as feed history, the four-status counts, the derived ingestion times, and the writes the
  registered routes already perform. Step 4 below. The ingestion writes (`recordDiscovery`, `beginAttempt`,
  `markStaged`, `finishAttempt`, `recordBlockedAttempt`, `completeAttempt`) stay in M3 Step 4.
- **The DownSub status wrapper**, formerly one bullet of M3 Step 1, because `Catalog.transcripts` is part of the
  contract. Step 3 below. M3 Step 1 reuses it for pre-flight.

### Step 1 — Document identity, tag vocabulary, the `runs` rename, and the 502 entry  (size: S)

**Files:** `apps/api/src/lib/openapi.ts`, `apps/api/src/routes/docs.ts`, `apps/api/src/routes/channels.ts`,
`apps/api/src/index.ts` (no change expected), `apps/web/src/api.ts`, `packages/shared/src/index.ts` (one
description), `apps/api/test/openapi.test.ts`, `apps/api/test/routes-channels.test.ts`.

- 1.1 `lib/openapi.ts`: `info.title` becomes `Said on Air API`; `info.description` is rewritten from PRD §1–§2 in
  three short paragraphs (what it is; identity, not authentication; entities, not roles). The `tags` array lists the
  eight entities with routes today (`health`, `me`, `catalog`, `channels`, `episodes`, `runs`, `follows`,
  `digest`) with one-line descriptions from spec §3.2; `chats` and `preferences` are added by the M4 plan with its routes.
- 1.2 `errorResponses` gains `upstream?: boolean`, producing a `502` entry with `ErrorResponseSchema` and the description "YouTube did not
  answer usably (UPSTREAM_UNAVAILABLE)". `POST /channels` passes it, since `fetchChannelFeed` already throws
  that code. **Plan decision:** the option is named `upstream`, matching the code's own word, not `youtube`; the M3
  Start route reuses it.
- 1.3 `routes/docs.ts`: `pageTitle` becomes `Said on Air API`. Nothing else in the Scalar configuration changes.
- 1.4 Rename `GET /channels/:id/ingestion-runs` to `GET /channels/:id/runs` (owner decision 2026-09-12, PRD §9):
  the route path and its tag in `routes/channels.ts`, the tag entry in `lib/openapi.ts`, the path in the web's
  `listIngestionRuns`, the three paths in `routes-channels.test.ts`, and the `IngestionRunsResponse` description in
  shared. The function and schema names keep `IngestionRun`; only the URL and tag change.

**Tests** (`openapi.test.ts`): `info.title` equals `Said on Air API`; the set of `doc.tags[].name` equals the set of
tags used across all operations; `post /channels` has a `502` response; `GET /docs` contains
`<title>Said on Air API</title>`; the document has `get /channels/{id}/runs` and no path containing
`ingestion-runs`. The existing assertions stay.

**Done when:** `pnpm check` green; under `wrangler dev`, `curl -s localhost:8787/openapi.json | jq .info.title` prints
the new title and `curl -s localhost:8787/docs | grep -c '<title>Said on Air API</title>'` prints `1`.

### Step 2 — No authorization, error codes as contract, one validation test  (size: M)

**Files:** `apps/api/src/middleware/owner.ts` (deleted), `apps/api/src/do/registry.ts`, `apps/api/src/do/registry/users.ts`,
`apps/api/src/routes/channels.ts`, `apps/api/src/routes/catalog.ts`, `apps/api/src/routes/follows.ts`,
`apps/api/src/lib/openapi.ts`, `apps/api/src/lib/channel-view.ts`, `apps/api/src/lib/episode-view.ts`,
`packages/shared/src/index.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/middleware/errors.ts`,
`apps/api/src/middleware/user.ts`, `apps/api/test/validation.test.ts` (new), `apps/api/test/me.test.ts`,
`apps/api/test/routes-channels.test.ts`, `apps/api/test/routes-follows-digest.test.ts`, the `registry-*` tests,
`apps/api/test/openapi.test.ts`, `AGENTS.md` (the layout line), `apps/api/src/do/registry/types.ts`,
`apps/web/src/components/AddChannel.tsx`.

- 2.0 Remove authorization (owner decision 2026-09-12, PRD §9). Delete `middleware/owner.ts` and every `requireOwner`,
  `assertOwner`, and `isOwner` use in the routes. In `do/registry.ts` delete `#assertOwner` and in
  `do/registry/users.ts` delete `assertOwner`; the facade methods keep their acting-email parameter and record it as
  reviewer, skipper, or requester without checking a role. `lib/errors.ts` and `middleware/errors.ts` lose `NOT_OWNER`;
  `errorResponses` loses its `owner` option. Delete the `middleware/owner.ts` line from the `AGENTS.md` layout.
- 2.0a Remove the owner branch of `POST /channels` (owner decision 2026-09-12): every add creates `requested`, follows
  the caller, and starts nothing; the `isOwner` and `requestIngestion` calls there go, and the Registry's
  `createChannel` loses its `status` and `reviewer` inputs. Web: `AddChannel.tsx` follows a successful add with
  `api.approveChannel` when the session role is `owner`, passing the title and import count the owner entered, so
  the owner's one-step experience stays; the web is otherwise unchanged.
- 2.0b One representation for every caller. `GET /channels` honours `?scope=all` from anyone and returns `management`
  on every row; `GET /channels/:id`, the channel actions, `POST /channels`, and the follow routes build every
  `Channel` through today's `ownerChannel` path, renamed `fullChannel`; `GET /channels/:id/episodes` includes
  summaries, related items, and `processing` for every caller and records read receipts, setting `wasUnread`, only
  when the caller is an active follower of an approved channel (the `includeSummary` and `includeProcessing` flags
  go); `GET /catalog`, `GET /channels/:id/followers`, and `GET /channels/:id/runs` drop their role check. In shared,
  `management` and `processing` become required. The web needs no change: its role gating in `session.tsx` and
  `Nav.tsx` is now the gate, and optional chaining on the two blocks still compiles.

- 2.1 Shared: add `ErrorCodeSchema = z.enum([...]).meta({ id: "ErrorCode", description })` with the four codes and their
  statuses in the description; `ErrorResponseSchema.code` becomes `ErrorCodeSchema.optional()`. `ChannelDeclinedResponse`
  keeps its `z.literal("INVALID_STATE")`.
- 2.2 `lib/errors.ts`: `export type DomainErrorCode = ErrorCode` and `DOMAIN_ERROR_CODES = ErrorCodeSchema.options`.
  The class and `domainErrorCode` are unchanged; the JSDoc on `UPSTREAM_UNAVAILABLE` moves into the schema description.
- 2.3 `middleware/user.ts`: the missing-header response gains `code: "INVALID_INPUT"` (spec §6). `me.test.ts` asserts
  the new body.
- 2.4 `test/validation.test.ts`: the 400 contract in one file, one `it` per case, each asserting status 400 and
  `{ error: expect.stringContaining(<field>), code: "INVALID_INPUT" }`: no header on `GET /me`; `POST /channels` with
  `Content-Type: application/json` and body `not json` ("body must be JSON"); `{}` (names `channelId`); `title: ""`,
  `title: "  "`, `title: null` (each "must be omitted or non-blank"); `GET /channels?scope=bogus`;
  `GET /digest?since=yesterday`; `GET /channels/<A>/episodes?limit=` (after seeding channel A). One `it` proves a
  no-body `POST /channels/<A>/pause` from the owner with no content type is accepted. **Plan decision:** the existing
  scattered 400 assertions in `routes-channels.test.ts` stay where they are; this file is the pinned contract, not a
  relocation.
- 2.5 Tests for no authorization. `routes-channels.test.ts`: the `ownerOnly` table becomes an `anyIdentity` table in
  which each former owner-only operation succeeds for `ALICE`, and approve, decline, and skip record
  `alice@example.com` as reviewer or skipper; `GET /channels?scope=all` from `ALICE` lists declined channels with
  `management`; a non-follower's `GET /channels/:id/episodes` carries `summary` and `processing`, no `wasUnread`, and
  records no receipt, which a later `PUT /follows` shows through `unreadCount`. The `registry-*` tests drop their
  `NOT_OWNER` assertions. `openapi.test.ts`: no operation has a `403`, and `ErrorCode.enum` equals the four. The
  owner's `POST /channels` returns a `requested` channel with `approvedAt: null`, and a following approve makes it
  `approved` with the import started.

**Done when:** `pnpm check` green; `curl -si localhost:8787/me` shows the header 400 with its code.

### Step 3 — The transcript provider's health  (size: S)

**Files:** `apps/api/src/lib/transcripts/status.ts` (new), `apps/api/src/bindings.d.ts`, `apps/api/.dev.vars.example`,
`packages/shared/src/index.ts`, `apps/api/src/routes/catalog.ts`, `apps/api/src/do/registry/catalog.ts` or the route
(wherever `Catalog` is assembled), `apps/api/test/transcripts-status.test.ts` (new), `apps/api/test/routes-channels.test.ts`,
`AGENTS.md` (the `lib/transcripts/` layout line).

- 3.1 `lib/transcripts/status.ts` exports `transcriptProviderHealth(env, deps?)`: `GET https://api.downsub.com/status`
  with `Authorization: Bearer <DOWNSUB_API_KEY>`, a two-second timeout, and one cached result per isolate for five
  minutes. Result `{ remainingCredits: number | null, status: "ok" | "auth_failed" | "unreachable" }`: `ok` with the
  credit count on a 2xx body that carries it; `auth_failed` with null on a 401; `unreachable` with null when no key is
  configured, the call fails, times out, or the body cannot be validated. The JSON is hand-validated for shape, not
  just parsed (AGENTS.md → AI code applies the same rule to external JSON). `deps` carries an injectable `fetch` and
  `now` for tests, the `feedFetcher` pattern. Hard rule 2 already permits this call; the wrapper sends nothing but the
  key. **Plan decision:** the credit field's name in DownSub's response is not recorded in the repo (the 2026-09-08
  probe noted only that `/status` exists and is free); the first `wrangler dev` run with the key fixes it, and the
  validator names it explicitly rather than accepting any number.
- 3.2 `bindings.d.ts` gains `DOWNSUB_API_KEY?: string` (secret; `.dev.vars` locally, `wrangler secret put` deployed) and
  `.dev.vars.example` gains a commented line for it, as AGENTS.md → One-time setup already describes.
- 3.3 Shared: add `TranscriptProviderStatusSchema` and `TranscriptProviderHealthSchema` (spec §5.3, §5.8) and the
  required `transcripts` field on `CatalogSchema`. These survive Step 4's rewrite unchanged.
- 3.4 `GET /catalog` assembles `transcripts` from the wrapper beside the Registry's summary; a wrapper failure can only
  ever produce `unreachable`, so the route never fails because of it.
- 3.5 `AGENTS.md` repo layout: add `status.ts` to the `lib/transcripts/` line.

**Tests:** `transcripts-status.test.ts` with an injected fetch: 2xx with the credit field → `ok` and the number; 401 →
`auth_failed`; network error, non-JSON, a body without the field, and a fetch that never resolves within two seconds →
`unreachable`; a second call within five minutes does not call fetch again and a call after five minutes does (injected
`now`); no key → `unreachable` without calling fetch. `routes-channels.test.ts`: `GET /catalog` under the test
bindings (no key) carries `transcripts: { remainingCredits: null, status: "unreachable" }` and parses with
`CatalogResponseSchema`.

**Done when:** `pnpm check` green; under `wrangler dev` with `DOWNSUB_API_KEY` in `.dev.vars`, `curl -s localhost:8787/catalog
-H 'X-User-Email: …' | jq .catalog.transcripts` shows `status: "ok"` and a number, and with the line commented out shows
`unreachable` and `null`; both legs recorded below.

### Step 4 — Registry schema, read model, and the restated contract  (size: XL, one commit)

**Files:** `apps/api/migrations/registry/0001_init.sql` (rewritten), `apps/api/migrations/registry/0002_drop_lifecycle_version.sql`
(deleted), `apps/api/migrations/registry/index.ts`, `apps/api/src/do/registry.ts` and every module under
`apps/api/src/do/registry/` (`types.ts`, `channels.ts`, `episodes.ts`, `runs.ts`, `catalog.ts`, `followers.ts`, plus a new
`attempts.ts` read side), `packages/shared/src/index.ts` (rewritten), `apps/api/src/lib/channel-view.ts`,
`apps/api/src/lib/episode-view.ts`, `apps/api/src/routes/channels.ts`, `apps/api/src/routes/catalog.ts`,
`apps/api/src/routes/digest.ts`, `apps/api/src/routes/follows.ts`, `apps/api/test/helpers.ts`,
`apps/api/test/registry-migrations.test.ts`, the other `registry-*` tests, the route tests, `apps/api/test/openapi.test.ts`,
and every `apps/web/src` file that imports a changed type (compile-only).

**Why one commit.** The shapes in spec §5.4 to §5.8 are projections of the rewritten Registry: `latestAttempt` reads
`episode_ingestion_attempts`, `feedStatus` and `discoveredCount` read the new `ingestion_runs`, `summaryAvailableAt` and
both derived ingestion times read `episodes.processed_at`. The stores return records typed against the shared module,
and the old shapes (`waiting`, run status, per-run episodes) have no source in the new tables. Splitting the commit
would leave a red gate in the middle. Review it by file group: migration and its test; stores and their tests; shared;
projections and routes; seeds and route tests; web.

- 4.1 **Schema.** Rewrite `0001_init.sql` to PRD §5.1 and §5.3 exactly; delete `0002_drop_lifecycle_version.sql`;
  `migrations/registry/index.ts` lists `0001_init` alone. Both `0001` headers already say governance is open (PRD §5.4).
  - `global_users`, `channel_followers`, `episode_summaries`: unchanged from the 2026-09-10 file.
  - `channels`: unchanged minus `lifecycle_version` and `last_ingested_at`.
  - `episodes`: `video_id` PK, `channel_id` FK, `discovered_by_run_id` FK to `ingestion_runs` (NOT NULL), `title`,
    `published_at`, `status IN ('pending','available','failed','skipped')`, nullable `intent IN
    ('publish','replace')`, `window_started_at?`, `window_deadline_at?`, `next_attempt_at?`,
    `attempt_count DEFAULT 0`, `failure_code?`, `failure_detail?`, nullable `skip_reason IN
    ('SHORT','NON_ENGLISH','UNPLAYABLE','OWNER')`, `skipped_at?`, `skipped_by_email?` FK, `transcript_checked_at?`,
    `chunk_count?`, `vectorized_at?`, `processed_at?`, `active_vector_generation?`, `staged_vector_generation?`,
    `updated_at`, `created_at`. No `waiting_code`. Checks: `available` requires positive `chunk_count`,
    `vectorized_at`, `processed_at`, and `active_vector_generation`; `failure_code` is `INGESTION_TIMEOUT` exactly when
    `failed` and null otherwise; `intent` and its three timestamps all set or all null; `publication` requires
    `pending` and `replacement` requires `available`; `staged_vector_generation` only while a window is open;
    `skipped` and `skip_reason` imply each other, `skipped_at` when skipped, `skipped_by_email` exactly for `OWNER`.
  - `ingestion_runs`: `run_id` PK, `channel_id` FK, `kind IN ('initial','scheduled')`, `feed_status IN
    ('read','unavailable')`, `discovered_count DEFAULT 0`, `episode_limit?`, `started_at`, `finished_at`, `created_at`.
    No status, `workflow_id`, `failure_code`, or `failure_detail`; no run-episode table.
  - `episode_ingestion_attempts`: `attempt_id` PK, `video_id` FK, `trigger IN
    ('channel_ingestion','scheduled_recovery','owner_retry')`, `intent IN ('publish','replace')`,
    `generation_id?`, `staged_chunk_count?`, `workflow_id?` UNIQUE, `requested_by_email?` FK, `status IN
    ('running','available','waiting','failed','skipped','blocked')`, `outcome_code?`, `failure_detail?`, `started_at`,
    `finished_at?`, `created_at`. Checks: `running` has no `finished_at` and every other status has one; `blocked` has
    no `workflow_id`; `owner_retry` has a requester and the other triggers none. **Plan decision:** no `CHECK` on
    `outcome_code` yet; the shared `AttemptOutcomeCode` enum is the contract, and `m3-7-owner-ux-plan.md` Step 3 (formerly `m3-ingestion-plan.md` Step 9) adds
    the `CHECK` once every outcome has run for real (owner request 2026-09-12).
  - Indexes: `channels(status, paused_by)`; `channel_followers(channel_id, unfollowed_at)`;
    `episodes(channel_id, status, published_at)`; `episodes(next_attempt_at)`; `episodes(discovered_by_run_id)`;
    `episodes(channel_id, processed_at)`; `ingestion_runs(channel_id, created_at)`;
    `episode_ingestion_attempts(video_id, created_at)`; `episode_ingestion_attempts(status, started_at)`.
  - After the commit lands locally, the owner wipes `wrangler dev` state with the `clean-local-do` skill (only on the
    owner's word); the already-applied `0001_init` version does not re-run otherwise (AGENTS.md → Data & schema).
- 4.2 **Read model** (`do/registry/*`): episodes with their latest attempt (newest `created_at` per `video_id`), the
  summary read as `Takeaway[]` objects, related ids filtered to the caller's scope; runs newest first as feed history;
  counts by the four statuses per channel and globally; `lastIngestedAt` per channel and `lastSuccessfulIngestionAt`
  as `MAX(processed_at)`; management rows with `latestRun` (newest run) and `neverStarted` (approved, no run row);
  the catalog summary (channels by status and paused, episodes by four statuses, attention counts). Summary and
  related data are returned only when the episode is `available`.
- 4.3 **Route-driven writes on the new tables**, the same operations the registered routes perform today: channel
  create (always `requested`, Step 2), request, approve (first approval sets `approved_at`, review fields, pause
  recomputed), decline, pause, resume; follower records; Skip (`failed → skipped OWNER`, `skipped_by_email` = the
  acting email); Retry re-arms recovery: a `pending`, `failed`, or `skipped` episode returns to `pending` with intent `publish` with
  a fresh 48-hour window, `next_attempt_at` now, `attempt_count` 0, and the skip and failure fields cleared; an
  `available` episode enters `replace` window with its content untouched; refused with `INVALID_STATE` only while
  the episode has a `running` attempt. No attempt row is written and nothing is launched: the starter, pre-flight, the
  one-hour reconcile, and every ingestion write are M3 Step 4 and Step 7, and the existing `requestIngestion` log line
  stays until then.
- 4.4 Rewrite `packages/shared/src/index.ts` top to bottom in spec §5's order, each schema typed from the spec rather
  than edited in place, each section headed by the PRD section it mirrors. Every §5.11 member is gone. M4 shapes (§5.9)
  are written now, unreferenced by any route. **Plan decision:** `ChatExchangeResponse` is `{ chat, userMessage,
  assistantMessage }` as the spec sketches; the M4 plan may change it before any route references it.
- 4.5 `do/registry/types.ts`: `EpisodeProcessingRecord` takes the `EpisodeProcessing` shape (window fields,
  `latestAttempt`, `discoveredByRunId`; no `waitingCode`, no `processedAt`); `IngestionRunRecord` is `IngestionRun`;
  `IngestionRunEpisodeRecord` is deleted; `ChannelManagementRecord` keeps `episodes` (the projection needs it for
  `Channel`) and `latestRun: IngestionRun | null`; `CatalogChannel` loses `lastIngestedAt` and the store returns the
  derived value beside the channel where a route needs it; `CreateChannelInput` has no `status` or `reviewer`.
- 4.6 Projections: `toChannel` reads the derived `lastIngestedAt` from its view argument, not the channel record;
  `toManagement` no longer copies `episodes`; `zeroEpisodeCounts` returns the four counts; `toEpisode` sets
  `summaryAvailableAt`, `waitReason` (through a pure `waitReasonOf(status, latestAttempt)` beside it with the spec
  §5.5 rule), and `processing` for every caller.
- 4.7 Routes reference the new schemas and take their `describeRoute` text from spec §3.3 for the routes registered
  today. `retry` and `skip` return `EpisodeResponse`; M3 Step 7 switches `retry` to `EpisodeRetryResponse` when the
  attempt starter exists. Every caller receives `management` on every `Channel` and `processing` on every `Episode`
  (Step 2). `POST /channels` keeps honouring `title` and `initialImportCount` from any caller.
- 4.8 Web, compile-only: `copy.ts` shrinks `SKIP_REASON_COPY` to the four reasons and re-keys `WAITING_CODE_COPY` as
  `WAIT_REASON_COPY` on `EpisodeWaitReason`, and adds an exhaustive `OUTCOME_CODE_COPY: Record<AttemptOutcomeCode,
  string>` for the owner's attempt phrases; `episodePhrase` reads `episode.waitReason` for every caller and falls
  back to the status phrase (the finished wording is M3 Step 9's); `Digest.tsx` and `EpisodeItem.tsx` render
  `takeaways[].text` and link `startSec` when present; `CatalogHealth.tsx`, `CatalogTable.tsx`, `OwnerChannel.tsx`,
  `ChannelList.tsx` drop `waiting` and `tracked` (summing the four where a total is shown) and read
  `latestRun.feedStatus` / `discoveredCount`. `apps/web` stays typecheck and lint only.
- 4.9 `test/helpers.ts`: `seedRun` writes `kind`, `feed_status`, `discovered_count`, `episode_limit`, `started_at`,
  `finished_at`; `seedEpisode` requires or creates a run for `discovered_by_run_id`, seeds window fields, and loses
  `waitingCode`; new `seedAttempt(videoId, { trigger, status, outcomeCode, … })`. `setChannelState` is unchanged.
- 4.10 `test/registry-migrations.test.ts`: a fresh Registry lists `["0001_init"]` alone; no `ingestion_run_episodes`
  table, no `waiting_code` or `last_ingested_at` column, no `lifecycle_version`; each table check above rejects the
  write it forbids: an approved channel without `approved_at`, a paused channel that is not approved, a `replace`
  window on a `pending` row, a half-set window, a `failed` row without `INGESTION_TIMEOUT`, a skipped
  episode without a reason, an `OWNER` skip without an email, a `running` attempt with `finished_at`, a `blocked`
  attempt with a `workflow_id`, an `owner_retry` attempt without a requester. Store tests: the latest attempt is the
  newest per episode; counts are a plain group-by on status; derived ingestion times equal the `processed_at` maxima;
  runs list newest first; Retry re-arms from each of `pending`, `failed`, `skipped`, and `available` and is refused
  only on a `running` attempt; Skip records the acting email.
- 4.11 `test/openapi.test.ts`: the component list from spec §10.3; the §5.11 assertions (no component of those names;
  `EpisodeSkipReason.enum` equals the four; `IngestionRunKind.enum` equals the two; no property named `waiting`,
  `tracked`, or `waitingCode` on any component; none of `status`, `workflowId`, `failureCode`, `failureDetail`,
  or `episodes` on `IngestionRun`; `AttemptOutcomeCode.enum` equals the fifteen codes of spec §5.3). **Plan decision:**
  the coverage test also carries a literal list of the operations spec §3.3 marks as registered so far, compared for
  equality with `app.routes`; adding or removing a route is then a deliberate one-line test edit, and a PRD row that
  never registers is visible.
- 4.12 Parse assertions: after one successful call each, `expectShape` on `MeResponse`, `CatalogResponse`,
  `ChannelsResponse`, `ChannelResponse`, `ChannelDeclinedResponse` (both routes), `EpisodesResponse`, `EpisodeResponse`,
  `IngestionRunsResponse`, `FollowersResponse`, `FollowsResponse`, `FollowResponse`, `DigestResponse`.
- 4.13 `routes-channels.test.ts`: a follower's episode list carries `waitReason: "CAPTIONS"` for a pending episode whose
  latest attempt is `waiting CAPTIONS`, `"PROVIDER_LIMIT"` for one whose latest attempt is `blocked PROVIDER_LIMIT`,
  and `null` for a `blocked PROVIDER_AUTH`, a `failed PROVIDER_HTTP`, and a `running` latest attempt; the same rows
  give every caller the attempt in `processing.latestAttempt`.
- 4.14 `routes-channels.test.ts` and `routes-follows-digest.test.ts`: `GET /channels` from any identity carries
  `management` on every row and omits declined channels without `?scope=all`; `GET /follows` carries `management`
  inside each `channel`; a user's `POST /channels` with `title` and `initialImportCount` creates the channel with
  both values.

**Done when:** `pnpm check` green with the rewritten `0001`; `pnpm build` then `grep -ril zod apps/web/dist` finds
nothing; after the local state wipe, `curl -s localhost:8787/openapi.json | jq '.components.schemas | keys'` lists the
spec §10.3 names and none from §5.11, and the four screens still load against the empty Registry.

### Step 5 — Documentation and walkthrough  (size: S)

**Files:** `AGENTS.md`, `docs/specs/api-reference.md`, this file.

- Apply spec §11's `AGENTS.md` bullets one at a time, keeping the surrounding text. The PRD bullets are proposals for
  the owner and are not applied here.
- Set the spec and plan status to complete with the date; record the `curl` legs below; leave the browser leg to the
  owner.

**Done when:** `pnpm check` green (docs only, but the gate runs before every finish).

## What the M3 and M4 plans build on this

`m3-2-attempt-ledger-plan.md` (M3.2, formerly `m3-ingestion-plan.md` Step 4, Registry state transitions) starts from this plan's Step 4: the tables, the read model,
and the route-driven writes exist, and it adds the ingestion writes. M3 Step 1 reuses the Step 3 status wrapper for
pre-flight. These routes register in their own plans with the documentation fixed by spec §3.3; the coverage test, the
tag test, and the parse rule fail until each is right, so no step here waits on them.

| Operation | Registered by | Tag | Success | Errors |
|---|---|---|---|---|
| `POST /channels/{id}/episodes/{videoId}/retry` (switch) | M3 Step 7 | episodes | 200 `EpisodeRetryResponse` | 400 404 409 |
| `POST /channels/{id}/runs` | M3 Step 7 | runs | 200 `IngestionRunResponse` | 400 404 409 502 (`errorResponses({ notFound, conflict, upstream })`) |
| `POST /chats`, `GET /chats` | M4 | chats (add the tag) | 201 `ChatResponse`, 200 `ChatsResponse` | 400 |
| `GET /chats/{id}/messages`, `POST /chats/{id}/messages` | M4 | chats | 200 `ChatMessagesResponse`, 200 `ChatExchangeResponse` | 400 404 |
| `GET /preferences`, `PUT /preferences` | M4 | preferences (add the tag) | 200 `PreferencesResponse` | 400 |

Each adds its parse assertion (`expectShape`) in its route test and, for M4, its two tag entries in `lib/openapi.ts`.

## Walkthrough record

Every leg ran under `wrangler dev` with `--persist-to` pointing at a scratch directory under `apps/api/.wrangler/`
(`walkthrough/` for Steps 1–3, `walkthrough-step4/` for the fresh-schema run), so the owner's default Durable Object
state, wiped before Step 1, stayed empty for the rewritten `0001` to run on the next `pnpm dev`. The scratch
directories can stay or go at the owner's discretion; they hold nothing the app needs.

| Step | Request | Result |
|---|---|---|
| 1 | `GET /openapi.json` | `info.title` "Said on Air API"; 8 tags (`catalog`, `channels`, `digest`, `episodes`, `follows`, `health`, `me`, `runs`), every one used; `get /channels/{id}/runs` present and no `ingestion-runs` path; `POST /channels` responses 200, 201, 400, 409, 502; 18 paths |
| 1 | `GET /docs` | 200 `text/html`, `<title>Said on Air API</title>`, zero occurrences of `proxy.scalar.com` |
| 2 | `GET /me` (no header) | 400 `{"error":"X-User-Email header is missing or malformed","code":"INVALID_INPUT"}` |
| 2 | `GET /catalog`, `GET /channels?scope=all` as `alice@example.com` | 200, 200: no role check anywhere |
| 2 | `GET /openapi.json` | 0 operations document a 403; `ErrorCode` enum is the four codes |
| 3 | `GET /catalog` with `DOWNSUB_API_KEY` in `.dev.vars` | `transcripts: { remainingCredits: 2143, status: "ok" }`; the live status call answered in about 0.95 s and cost nothing |
| 3 | `GET /catalog` with `--var DOWNSUB_API_KEY:` (empty) | `transcripts: { remainingCredits: null, status: "unreachable" }` |
| 4 | first request on fresh state | `registry.migrations_applied` with `versions: ['0001_init']` alone |
| 4 | `GET /channels`, `/catalog`, `/follows`, `/digest`, `/channels?scope=all` as `alice@example.com` | 200 each on the empty Registry; catalog keys `attention`, `channels`, `episodes`, `lastSuccessfulIngestionAt`, `transcripts`; episodes `{ available: 0, pending: 0, failed: 0, skipped: 0 }` |
| 4 | `GET /openapi.json` | 29 components, 18 paths; all sixteen of spec §10.3 present, none of §5.11 present; `EpisodeSkipReason` is the four values; `AttemptOutcomeCode` has 15; `EpisodeCounts` has exactly `available`, `pending`, `failed`, `skipped` |
| 4 | `pnpm build` | `grep -ril zod apps/web/dist` finds nothing |

**Browser leg (owner):** `pnpm dev`, open `http://127.0.0.1:8787/docs`, enter an email in the auth field, run
`GET /me`, `GET /channels`, and `POST /channels` with `@veritasium` (expect the 400 with "Copy channel ID"); confirm
the network tab shows requests to `127.0.0.1:8787` only. The four web screens should load against the empty Registry;
the owner's add box should create a requested channel and approve it in one gesture.
