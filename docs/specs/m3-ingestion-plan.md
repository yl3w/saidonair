# Implementation plan — M3 Ingestion

**Implements:** `docs/specs/m3-ingestion.md`, under `AGENTS.md` and
`docs/specs/channel-simplification.md`.
**Written:** 2026-09-08. **Revised:** 2026-09-12 for the approved functional separation of channel discovery and
episode recovery.
**Status:** approved plan; runtime implementation has not started. No new dependencies.

This revision supersedes the earlier hybrid design. An `ingestion_run` is completed RSS discovery history. An
`episode_ingestion_attempt` is the only execution ledger for first processing, automatic recovery, and Owner Retry.
Every unfinished, non-deterministic episode condition shares one 48-hour processing window, regardless of attempt count
or channel state.

**Starting over (owner decision 2026-09-12).** The Registry schema, the Registry DO's store modules, and the API contract are redesigned from scratch to this model rather than evolved under compatibility rules: the Registry's `0001_init.sql` is rewritten a second time before first deployment, `0002_drop_lifecycle_version.sql` is deleted, there is no `0003`, local Durable Object state is wiped, and no shared schema, reader, or route keeps a legacy table, column, or enum value alive. The User DO and its migration are untouched. Neither an additive-only nor a frozen-file rule applies; both were withdrawn on 2026-09-12 (PRD §5.4). The schema, the read model, and the writes the existing routes perform land with `docs/specs/api-reference-plan.md` Step 4 (moved there on 2026-09-12 so that plan depends on nothing here); this plan's Step 4 adds the ingestion writes on top.

The work is split into nine implementation steps. Keep each step narrowly reviewable, run `pnpm check --force`
after it, and exercise Workers runtime behavior under `wrangler dev` before completion.

## Step 0 — Verify platform assumptions  (size: S)

**Files:** this plan's walkthrough record only.

- Confirm the pinned Workers test pool can create and inspect a trivial Workflow instance.
- Confirm `remote: true` AI and Vectorize bindings can coexist with local Durable Objects and Workflows when tests
  use fakes.
- Ask the owner to confirm the existing `media-rag` index is 768-dimensional/cosine and has `channelId` and
  `videoId` metadata indexes. No generation index is needed: retrieval keeps the channel filter and verifies
  generations in code. Do not run the one-time setup commands.

**Done when:** the outcomes are recorded under Walkthrough record. If Workflow simulation is unavailable, test the
attempt orchestration through the in-process step runner while retaining one `wrangler dev` runtime walkthrough.

## Step 1 — Transcript seam and DownSub adapter  (size: M)

**Files:** `apps/api/src/lib/transcripts/types.ts`, `vtt.ts`, `downsub.ts`, `index.ts`, bindings, test fakes, tests.

- Define the transcript contract from `AGENTS.md`: segments, duration, live/upcoming, and caption status.
- Parse WebVTT only. Strip tags, accept dot/comma milliseconds, preserve multiline cues, and ignore empty cues.
- Call only `https://api.downsub.com/download?url=<public YouTube URL>` with the bearer secret. Select manual English,
  then English auto-caption; do not use translated tracks.
- Map provider responses to `UNPLAYABLE`, `PROVIDER_AUTH`, `PROVIDER_LIMIT`, `PROVIDER_RATE_LIMIT`,
  `PROVIDER_HTTP`, or `PROVIDER_PARSE`. Known live/upcoming metadata wins over `UNPLAYABLE`.
- Treat a chosen caption file with no usable cues as `captionStatus: none`.
- Reuse `lib/transcripts/status.ts` from `docs/specs/api-reference-plan.md` Step 3 for episode pre-flight (it already
  serves `GET /catalog`); add a test seam so pre-flight tests can drive `auth_failed` and zero credits.
- Keep `TRANSCRIPTS_FAKE` capable of representing every result and failure, including provider status.

**Tests:** track selection, VTT parsing, found/no-caption/non-English/live/unplayable cases, every HTTP mapping,
empty cues, malformed bodies, and provider health.

**Done when:** `pnpm check --force` passes and one removable `wrangler dev` probe verifies the real adapter shape.

## Step 2 — Deterministic transcript chunking  (size: S)

**Files:** `apps/api/src/lib/chunk.ts`, tests.

- Group consecutive segments to about 60 seconds, split at roughly 400 tokens, overlap one or two segments, and
  never emit more than 480 tokens.
- Split an oversized single segment on sentence, then word boundaries.
- Return `{ index, text, startSec, endSec }[]` with deterministic indices.

**Tests:** empty input, one segment, oversized segment, overlap, token ceiling, timestamps, determinism.

**Done when:** `pnpm check --force` passes.

## Step 3 — Shared contracts and read projections  (struck 2026-09-12)

Delivered by `docs/specs/api-reference-plan.md` Step 3 instead, approved by the owner on 2026-09-12: it rewrites
`packages/shared/src/index.ts` to `docs/specs/api-reference.md` §5, the projections, the route schema references, the
test helpers, and the web's compile-only changes, and lands in the same commit as Step 4 below. Where the bullets
that stood here differed from that spec (`IngestionRunSummary`, `tracked`, `ChannelManagement.episodes`,
`processing.processedAt`, an owner-only `EpisodeProcessing`), the spec wins. Nothing remains to do in this step.

## Step 4 — Registry state transitions  (size: L; after `api-reference-plan.md` Step 4)

**Files:** Registry episode/run/attempt stores and facade, tests.

**Precondition:** `docs/specs/api-reference-plan.md` Step 4 has landed: the rewritten `0001`, the read model, the
route-driven writes (channel transitions, follower records, Skip, Retry's re-opening of the window), and the seeds. This
step adds the ingestion writes and their state-machine rules on top; it creates no table and changes no column.

### Schema (moved)

The DDL, the migration index, and `test/registry-migrations.test.ts` are `api-reference-plan.md` Step 4.1 and 4.10;
the logical schema is PRD §5. Nothing about the schema remains to do here.

### Discovery writes

- `recordDiscovery(channelId, kind, feedResult, selectedEntries, ignorePause)` validates the channel rules and writes
  one already-completed run.
- On a successful read, update `last_checked_at`, select only eligible untracked entries, and insert each episode with
  immutable `discovered_by_run_id` and `publish` window initialized for 48 hours.
- On feed failure, write `feed_status = unavailable`, `discovered_count = 0`, leave `last_checked_at` unchanged, and
  create no episodes.
- The first successful discovery uses `initial_import_count`; later successful discoveries use entries newer than
  first approval. Empty/unavailable prior history does not consume the initial selection.

### Attempt writes

- `beginAttempt(videoId, trigger, requestedByEmail?)` requires no running attempt for that episode and never checks
  channel status or pause. It creates one running attempt and a fresh staged generation id, and returns the
  episode's last staged generation with its recorded chunk count when that generation never became active, so the
  instance can delete it before writing.
- `markStaged(attemptId, chunkCount)` records how many ids the attempt is about to write, before the first upsert.
- First processing uses `intent = publish`. Retry on available content uses `replacement` and leaves all
  current content fields intact.
- `finishAttempt` records one of available, waiting, failed, skipped, or blocked and updates only the matching
  episode recovery. The reason stays on the attempt: the schema has no `waiting_code` column, and
  `failure_code`/`failure_detail` are written once, at the timeout, as `INGESTION_TIMEOUT` and the latest attempt's
  reason.
- Every launched attempt increments diagnostic `attempt_count`; a `blocked` attempt never does, and the count never
  controls status.
- `recordBlockedAttempt(videoId, trigger, reason, requestedByEmail?)` writes one finished `blocked` attempt with
  `PROVIDER_AUTH` or `PROVIDER_LIMIT` for every blocked start, automatic or owner (2026-09-12 review); for an automatic
  block it also moves `next_attempt_at` six hours later or, at the deadline, closes the window.
- Non-deterministic unfinished outcomes finish the attempt with the reason and set the episode's `next_attempt_at`
  six hours later, capped at the deadline. This includes captions, live/upcoming, provider failures/limits, transcript size, AI, Vectorize, and
  `WORKFLOW_LOST`.
- At/after the deadline, pre-flight permits one final attempt. A provider block first records its `blocked` attempt;
  that block or an unsuccessful final attempt then sets publication to `failed INGESTION_TIMEOUT`, copying the latest
  attempt's reason into `failure_detail`, which therefore always exists. Replacement
  simply closes the window and leaves the available content active.
- Deterministic `SHORT`, `NON_ENGLISH`, and `UNPLAYABLE` outcomes are intent-aware (2026-09-12 review): under
  `publication` they set the episode `skipped` with the reason; under `replacement` they finish the attempt `skipped`,
  clear the window fields, and leave the episode `available` with every content field intact. Owner Skip sets
  `OWNER`.
- Retry's re-opening of the window and the Skip transition exist from `api-reference-plan.md` Step 4.3; this step adds the
  pre-flight and running-attempt behaviour around them. When its pre-flight permits work, Owner Retry resets the window's
  start/deadline and attempt count. A blocked Retry
  records the action but changes no episode or window field. Owner Skip is `failed → skipped OWNER`. Both work under
  any channel status; Retry is refused only while that episode has a running attempt, and `beginAttempt` reports
  that attempt's id and age so the caller can reconcile an old one inline (Step 7).

### Publication

- `completeAttempt(attemptId, generation, chunkCount, summary, related)` verifies the attempt and generation are
  current, writes/replaces the summary, sets `chunk_count`, then activates the staged generation in the same Registry
  transaction, and returns the previous active generation with its chunk count so the instance can delete it.
- First publication sets `processed_at` once. Replacement preserves it and all users' read receipts.
- A stale or closed attempt cannot update the episode.

**Tests:** immutable discovery provenance; feed
read/unavailable
history; universal 48-hour boundaries; diagnostic attempts beyond three; every failure family, none of them writing a
pre-timeout `failure_code`; no `waiting` count anywhere; a blocked automatic start writing a `blocked` attempt without moving `attempt_count`, and
an episode blocked for its whole window timing out with `PROVIDER_LIMIT` in `failure_detail`; deterministic skips
under publication, and a
replacement attempt that classifies `UNPLAYABLE` leaving the episode available with its summary and active generation;
Retry/Skip under requested, approved, paused, and declined channels; replacement preservation and the
previous-generation handoff from `completeAttempt`; stale attempt refusal;
and no channel timestamp other than `last_checked_at` ever written.

**Done when:** `pnpm check --force` passes.

## Step 5 — AI, Vectorize, and Workflow bindings  (size: L)

**Files:** `apps/api/src/lib/ai.ts`, `lib/vectorize.ts`, `prompts/summary.ts`, bindings, Wrangler config, fakes, tests.

- Add Workers AI embedding and map/reduce summary wrappers with deterministic fakes.
- Validate structured summaries; retry invalid JSON once, then use raw-text fallback.
- Split long transcripts into sections of at most 45 minutes on chunk boundaries. One section skips reduce; multiple
  sections get a final reduce call that preserves takeaway timestamps.
- Keep related-episode lookup optional; failure publishes with `[]`.
- Require explicit `shared-catalog` namespace on every Vectorize operation; the `VectorStore` has `upsert`,
  `getByIds`, `query`, and `deleteByIds`, with id ownership enforced on the id-based calls (hard rule 3).
- Generate vector ids as `${videoId}:${generationId}:${chunkIndex}`. Metadata always includes `channelId`,
  `videoId`, and `generationId`; only the first two are filter fields.
- Upsert and verify the complete staged generation before publication. **One generation rule:** the index holds one
  active generation per episode plus what an attempt is staging. The attempt deletes the previous generation after
  activation and an abandoned staged generation before writing (Step 6). Retrieval (M4) keeps
  `filter: { channelId: { $in } }`, and in the Registry check that already validates availability and eligibility
  it parses the generation out of each id, drops vectors whose generation is not the episode's active one, and
  fetches more candidates to fill the gap. There is no generation metadata index and no per-episode filter: that
  would put one id per eligible episode under the 2 KB filter cap.
- Add `INGEST_WORKFLOW` plus `AI`, `VECTORS`, and test fakes without new packages.

**Approved map prompt:**

> You summarise one episode of a YouTube channel for a reader who has not watched it. Return only JSON with three
> fields: `executiveSummary` (at most three sentences, plain prose, no hype), `takeaways` (three to five objects
> `{ "text", "at" }`: `text` is one concrete claim, example, or recommendation from the episode; `at` is the
> `[h:mm:ss]` marker nearest to where it is said, or null), `topicTags` (one to eight short lowercase tags). Use only
> what the transcript supports; do not invent names, numbers, or timestamps. Transcript follows, with `[h:mm:ss]`
> markers.

**Approved reduce prompt:**

> You are given summaries of consecutive sections of one YouTube episode, each with timestamped takeaways. Return
> only JSON with the same three fields for the whole episode: `executiveSummary` (at most three sentences),
> `takeaways` (three to five, chosen or merged from the sections, each keeping the `at` timestamp of the section
> takeaway it comes from), `topicTags` (one to eight). Do not add anything the sections do not say.

**Tests:** dimension checks, explicit namespace enforcement, generation ids, delayed Vectorize visibility, complete
generation verification, `deleteByIds` on the fake store, summary validation/fallback, related-query failure, and
the retrieval generation check dropping a stale hit and refilling.

**Done when:** `pnpm check --force` passes and AI/Vectorize calls are exercised under `wrangler dev`.

## Step 6 — One Workflow per episode attempt  (size: L)

**Files:** `apps/api/src/workflows/ingest.ts`, `lib/workflows.ts`, transcript/AI/Vectorize helpers, tests.

- Workflow params are `{ attemptId, videoId, channelId, startDelaySec }`. The first step sleeps `startDelaySec`.
  Load the attempt and exit if it is no longer running.
- Put each external call in its own `step.do`: transcript, each embedding batch, each upsert batch, vector
  verification, each map/reduce summary call, related lookup, and Registry writes.
- Classify `SHORT`, `NON_ENGLISH`, and `UNPLAYABLE` as deterministic results: `finishAttempt` skips a publication and
  leaves a replacement's episode available (Step 4). Classify every other unfinished result
  through the universal recovery rule.
- Keep transcript results below the 700 KB step-result ceiling. `TRANSCRIPT_TOO_LARGE` ends this attempt and schedules
  recovery; it is not immediately terminal.
- Chunk inline; `discard` the episode's abandoned staged generation when `beginAttempt` named one; `markStaged`
  with the chunk count; stage generation-specific vectors; verify every expected id; summarize; publish; then
  `cleanup` the previous generation `completeAttempt` returned. A `discard` or `cleanup` failure is logged and
  does not change the attempt's outcome: publication stands and retrieval's generation check hides the leftovers.
- If any step exhausts retries, finish this attempt with its specific reason. Do not inspect or update the discovery
  run or channel.
- `ingestLauncher(env)` is the only Workflow binding seam and supports active/gone/missing test states.

**Tests:** all transcript classifications; technical failures at every stage; large transcript recovery; successful
publication; safe replacement, after which the fake store holds only the new generation; a second attempt after a
failed one deletes exactly the abandoned ids; a failed cleanup leaves the publication in place; related failure;
stale attempt; and a Workflow fake round trip if supported.

**Done when:** `pnpm check --force` passes and one complete attempt is exercised under `wrangler dev`.

## Step 7 — Discovery start points and Owner episode actions  (size: M)

**Files:** `apps/api/src/lib/ingestion.ts`, channel/catalog routes, RSS fake, shared contracts, tests.

- Replace the channel half of the log-only helper with `startDiscovery(env, channelId, { ignorePause, feed? })`.
  It never calls DownSub pre-flight.
- Fetch RSS, decide initial versus scheduled from whether an episode has ever been discovered, call
  `recordDiscovery`, then invoke the common attempt starter for each created episode. Failure to start one episode
  is recorded on that episode and does not change the completed discovery run.
- First approval starts initial discovery after the channel transition (the owner's add no longer approves,
  2026-09-12). The initial discovery ignores a
  system pause. Re-approval starts nothing.
- `POST /channels/:id/runs` means “check this feed now.” It requires approved status, ignores pause, and returns the
  completed discovery run. Return 502 after recording `feed_status = unavailable`; zero discoveries is a normal 200.
- Build one common `startEpisodeAttempt` for discovery, scheduled recovery, and Owner Retry. It takes the attempt's
  position in its batch and passes `startDelaySec = k × 3` (owner decision 2026-09-11, restored 2026-09-12); a
  discovery numbers its new episodes, the recovery tick numbers every attempt it starts across all channels, and an
  owner Retry is a batch of one with delay 0. The delay comes from a pure `startDelaySec(k)` helper with its own
  unit test.
  - Automatic provider block records a finished `blocked` attempt (`PROVIDER_AUTH` or `PROVIDER_LIMIT`) and
    schedules the next recovery time.
  - Owner Retry block creates/returns a finished blocked attempt.
  - Otherwise create a running attempt and launch the Workflow.
- `POST /channels/:id/episodes/:videoId/retry` validates episode/channel identity, but not channel status or the
  caller's role (the API enforces no authorization, PRD §9). When pre-flight permits, it resets the 48-hour window; it always returns `{ episode, attempt }`, including
  a blocked attempt that leaves the window unchanged. A running attempt refuses it with 409 `INVALID_STATE`, except
  that when the attempt is older than one hour the route first asks `ingestLauncher(env).status(attemptId)`:
  `active` keeps the 409; `gone` or `missing` calls the Step 8 `closeLostEpisodeAttempt` helper and the Retry
  proceeds (owner decision 2026-09-12), so a dead instance never holds Retry until the next recovery tick. Under
  one hour the refusal stands unconditionally, since a healthy attempt can take that long.
- The skip route also drops the approved-channel and open-run preconditions. It keeps `failed → skipped OWNER`.
- `GET /catalog` adds transcript provider health without making its response depend on that provider.

**Tests:** discovery with new/empty/unavailable feeds; immutable run ids; immediate first attempts with increasing
start delays; DownSub block not
blocking RSS; initial discovery while system-paused; no discovery after decline; Retry/Skip in every channel status;
blocked automatic and Owner starts each recording a finished `blocked` attempt with the provider reason; same-episode running guard, including a running attempt older than an
hour whose fake instance is `gone` being reconciled inline with the Retry proceeding while an `active` one is still
refused; siblings untouched; available replacement;
no RSS request on recovery/Retry; and no channel/run mutation from an episode action.

**Done when:** `pnpm check --force` passes and routes are exercised under `wrangler dev`.

## Step 8 — Two independent six-hour schedulers and reconciliation  (size: M)

**Files:** `apps/api/src/index.ts`, `lib/ingestion.ts`, `wrangler.jsonc`, tests.

- Configure discovery at `0 */6 * * *` UTC and recovery at `30 */6 * * *` UTC.
- Dispatch by the cron expression in the scheduled handler.
- Discovery selects approved, unpaused channels and calls `startDiscovery`. Each channel is isolated from another
  channel's feed error.
- Recovery first reconciles running attempts older than one hour. Active instances stay running; gone/missing ones
  finish `WORKFLOW_LOST` and remain in their existing window. The same `closeLostEpisodeAttempt` helper serves the
  Retry route's inline reconciliation (Step 7).
- Recovery then selects all due episodes across every channel status and pause state. It does not fetch RSS or ask
  whether a discovery run is open. It numbers the attempts it starts across the whole tick, so the k-th sleeps
  k × 3 s first.
- For a due episode at/after its deadline, make the final attempt when pre-flight permits; do not fail captions/live
  from elapsed time alone.
- Before the deadline, a provider block records one `blocked` attempt per due episode with the provider reason and
  schedules the next check. At the deadline it records that attempt and closes the window rather than scheduling
  beyond 48 hours, so `failure_detail` names the block.
- Keep “approved, never started” as discovery information for channels with no run row.

**Tests:** cron dispatch, channel selection, independent recovery selection under approved/paused/declined/requested,
final deadline attempt, provider blocking, one-hour attempt reconciliation, stale write refusal, RSS outage not
affecting recovery, start delays increasing across the tick, and both Wrangler cron expressions.

**Done when:** `pnpm check --force` passes and both crons are exercised with `wrangler dev --test-scheduled`.

## Step 9 — Owner/read UX, full walkthrough, and final alignment  (size: M)

**Files:** Owner web screens/components, `apps/web/src/lib/copy.ts`, affected specs, tests.

- Catalog latest-run copy is one of:
  - “N episodes discovered”
  - “Nothing new”
  - “Feed unavailable”
- Owner channel detail shows discovery history separately from each episode's content and recovery state.
- Episode copy shows publication versus replacement, the last reason read from the latest attempt, next attempt,
  deadline, and the count of launched attempts beside the latest attempt, so a blocked latest attempt explains a
  zero count; a `blocked` attempt uses the same wait phrase as the matching in-flight provider reason, and the health
  strip shows no `waiting` number. It makes clear that a replacement leaves current content available.
- Retry appears for every episode and is disabled while that episode's attempt has been running under an hour; an
  older running attempt leaves Retry enabled, since the route reconciles a dead instance before answering, and the
  row says how long the attempt has been running. Skip appears on
  failed episodes. Neither control changes based on channel status or a discovery run.
- Needs attention contains publication recoveries that exhausted 48 hours, grouped by channel with last reason,
  Retry, and Skip. Replacement timeout is informational because content remains available.
- Start remains an approved-channel action and reports discovery only.
- Keep catalog provider health, takeaway timestamp links, digest availability labels, and the manual Refresh control.
- Add the `CHECK` on `episode_ingestion_attempts.outcome_code` (owner request 2026-09-12): once the walkthrough below
  has run every attempt outcome for real, edit `0001_init.sql` so the column accepts exactly the fifteen
  `AttemptOutcomeCode` values of `api-reference.md` §5.3 or null, mirror the row into PRD §5.3's `CHECK` table, add
  the rejecting write to `test/registry-migrations.test.ts`, and wipe local Durable Object state on the owner's word
  so the edited file re-runs. Governance is open (PRD §5.4), so this is an edit of `0001`, not a new file. Until
  then the shared enum is the contract (`api-reference-plan.md` Step 4.1).

### End-to-end walkthrough

1. First approval while system-paused discovers episodes and immediately starts their attempts.
2. Captioned content becomes available; captionless/live/provider/technical/large-transcript cases recover every six
   hours and do not fail on attempt count.
3. Decline the channel during recovery. No new discovery occurs, but the old episode keeps recovering and can publish;
   readers regain access after re-approval.
4. Advance to the 48-hour boundary. Confirm the final attempt occurs and unfinished publication becomes
   `INGESTION_TIMEOUT` with the last reason visible.
5. Retry that failed episode while the channel is declined. Confirm a new 48-hour window starts, no RSS fetch occurs,
   and no channel/discovery record changes.
6. Retry an available episode. Confirm old summary/vectors remain active until the replacement generation succeeds,
   `processed_at` plus read receipts do not move, and the previous generation's ids are gone from the index
   afterwards.
7. Exhaust provider credits. Confirm discovery still records new episodes, every automatic and owner start records a
   `blocked PROVIDER_LIMIT` attempt without touching `attempt_count`, the health strip shows no `waiting` number, and
   later recovery resumes.
8. Confirm Owner discovery history reads discovered count/nothing new/feed unavailable and never shows attempt
   outcome counts.

**Done when:** `pnpm check --force` and `git diff --check` pass, runtime paths have been exercised under
`wrangler dev`, the walkthrough result is recorded below, and the contract docs match the shipped behavior.

## Walkthrough record

_Fill in during Step 9 implementation. This documentation update does not claim the runtime work is complete._
