# Implementation plan — M3 Ingestion

**Implements:** `docs/specs/m3-ingestion.md` under the rules in `AGENTS.md`, on the channel and episode model of
`docs/specs/channel-simplification.md` (merged 2026-09-10).
**Written:** 2026-09-08, against `main` at `c959cc6`. **Revised:** 2026-09-10 against `main` at `6e075b1`: channels
carry no import outcome, requesters follow when they request, episodes are `pending | available | failed | skipped`
with wait and skip reasons and three technical attempts, and the owner's episode retry and skip routes already exist.
**Revised again:** 2026-09-11 against `main` at `007b3f3`, for the owner's five decisions of that day (spec header):
one Workflow instance per episode with the run row kept, no fence and no `lifecycle_version`, reconciliation at each
cron tick, a handler-computed stagger, Workers Paid. Steps 4, 6, 7, and 8 are rewritten; Steps 1, 2, 3, and 5 are
untouched apart from the digest order wording in Step 3.
**Status:** proposed; starts on the owner's go. Plan decisions are marked **plan decision** and can be vetoed before
their step starts. No new dependencies in any step.
**Shape:** preparatory Step 0 plus nine delivery steps, each one commit, `pnpm check` green after each, and anything
touching Workers runtime behaviour exercised under `wrangler dev`. Steps 1–2 add transcript and chunking support;
Step 3 delivers the shared contracts and the AI and Vectorize wrappers; Step 4 adds the Registry write side;
Step 5 adds bindings; Step 6 is the per-episode Workflow; Steps 7–9 wire the start handler, the cron handler with
reconciliation, and the docs.

**Prerequisites (owner):** the Vectorize index and its two metadata indexes exist (AGENTS.md → One-time setup);
`wrangler secret put DOWNSUB_API_KEY`. Workers Paid was confirmed and the reconciliation window decided on
2026-09-11, so nothing else gates Step 4.

**What already exists (2026-09-11) and this plan builds on:** the Registry `episodes`, `ingestion_runs`, and
`ingestion_run_episodes` tables with the CHECK constraints of `channel-simplification.md` §6.1, minus
`lifecycle_version`, which migration `0002_drop_lifecycle_version.sql` removed on 2026-09-11 together with every
`lifecycleVersion` field in the API and the web; `do/registry/episodes.ts` with `listByChannel`, `listDigest`,
`countByChannel`, `listAvailableVideoIds`, `getEpisode`, `retryEpisode`, `skipEpisode`; `do/registry/runs.ts` read
helpers and `hasActiveRun`; the facade's `retryEpisode`/`skipEpisode`; `lib/ingestion.ts` `requestIngestion(channelId,
reason)` as a log line with reasons `channel_approved` and `episode_retry`; the routes
`POST /channels/:id/episodes/:videoId/retry|skip`; `Episode.skipReason` for readers and `processing.waitingCode` for
the owner; the web copy for every skip and wait reason; and `GET /catalog` with `attention.neverStarted`.

### Step 0 — Two checks before design settles  (size: S)

- Confirm the pinned `@cloudflare/vitest-pool-workers` runs a trivial Workflow (`env.X.create()` then `status()`)
  and tolerates `ai` and `vectorize` bindings with `remote: true` in `wrangler.jsonc` when nothing calls them. The
  installed miniflare ships a Workflows simulator and the pool carries remote-binding support, so both are expected
  to pass; if either fails, tests drive `ingestEpisode()` through the in-process step runner of Step 6 instead, and
  the bindings move to a `wrangler.test.jsonc` the pool loads.
- Confirm the Vectorize index exists: `wrangler vectorize info media-rag` shows 768 / cosine and both metadata indexes.

**Done when:** both outcomes are written at the top of this plan.

### Step 1 — Transcript source seam and the DownSub adapter  (size: M)

**Files:** `lib/transcripts/types.ts`, `lib/transcripts/vtt.ts`, `lib/transcripts/downsub.ts`,
`lib/transcripts/index.ts`, `bindings.d.ts`, `.dev.vars.example`, `vitest.config.ts` (`TRANSCRIPTS_FAKE`), tests.

- `types.ts`: `TranscriptSource` returning
  `TranscriptResult = { segments | null, durationSec | null, isLive, captionStatus: "english" | "none" | "non_english" }`,
  `TranscriptSegment`, `TranscriptError` with the `TranscriptFailure` union (the reason is also the message prefix
  and `transcriptFailure(error)` recovers it, so it survives a Workflow step boundary), and `chooseTrack(tracks)` implementing
  the English-first rule over `{ code, auto }` pairs, returning no track when captions exist but none is English
  (`captionStatus: "non_english"`, distinct from `"none"`).
- `vtt.ts`: pure WebVTT/SRT cue parser (the spike's `parseCues`, hardened: tag stripping, `.`/`,` millis, blank
  cues skipped). Tests: fixtures for both formats, hours field, multi-line cues, tags.
- `downsub.ts`: `downsubSource(env, fetchImpl)`; state and HTTP mapping from spec §2; VTT preferred, SRT fallback
  if a track lacks VTT; discards `translatedSubtitles`; reports `duration` and `metadata.isLiveContent` (also on the
  `error` state, where live/upcoming wins over `UNPLAYABLE`) so selection can skip Shorts and wait for streams. A
  chosen track whose file parses to zero usable cues is reported as `captionStatus: "none"` with `segments: null`,
  never as `"english"` with an empty array, so the 48-hour rule applies to it and nothing downstream ever sees an
  empty transcript (decided 2026-09-11; a `PROVIDER_PARSE` was considered and rejected because the file did parse
  and step retries would re-buy a deterministic empty file). `providerStatus(env)` wraps `/status` for the catalog and the cron's pre-flight gate with a two-second timeout,
  returning `{ remainingCredits: number | null, status: "ok" | "auth_failed" | "unreachable" }`. Tests with fixtures taken from
  the probe: found, no_subtitles, error, error-but-live, 401/403/429, malformed body, and a found track whose VTT
  is a header with no cues, which comes back as `"none"`; the probe's VTT for `jNQXAC9IVRw` parses to its known 6
  cues.
- `index.ts`: `transcriptSource(env)`: `TRANSCRIPTS_FAKE` → canned (`{ [videoId]: TranscriptResult | { reason } }`,
  plus an optional `status: { remainingCredits, status }` that `providerStatus(env)` answers with, `unreachable`
  and `null` when absent, so the pre-flight gate and the catalog can be driven in tests);
  else the DownSub adapter, which throws `PROVIDER_AUTH` at first use when the key is missing. The fake mirrors
  `feedFetcher` and covers duration, live/upcoming, and every caption status, so tests can drive the exact 180-second
  and 48-hour boundaries, unknown duration, and no-captions versus non-English.

**Done when:** `pnpm check` green; under `wrangler dev` a throwaway call for one video matches the probe's numbers
(6 segments for `jNQXAC9IVRw`, first cue at 1.2 s), then is removed.

### Step 2 — Chunking  (size: S)

**Files:** `lib/chunk.ts`, tests. Pure function per spec §3.1. Tests: empty (returns no chunks; the pipeline never
calls it with an empty transcript because the adapter reports one as no captions, but the function stays total),
one segment, very long single segment, overlap, the 480-token ceiling, deterministic indices.

### Step 3 — Shared contracts, AI and Vectorize wrappers  (size: L)

**Files:** `lib/ai.ts`, `lib/vectorize.ts`, `prompts/summary.ts`, `bindings.d.ts`, `vitest.config.ts`,
`packages/shared/src/index.ts`, `lib/episode-view.ts`, `do/registry/episodes.ts` (summary reader), `routes/digest.ts`,
web `EpisodeItem`, fixtures and tests.

- `packages/shared`: `EpisodeSummary.takeaways` becomes `{ text: string; startSec: number | null }[]`; `Episode`
  gains `summaryAvailableAt: UnixMs | null` (the first `processed_at`, null until available); `CatalogSchema` gains
  `transcripts: { remainingCredits: number | null, status: "ok" | "auth_failed" | "unreachable" }`.
  `IngestionRunStatusSchema`'s description says `queued`, `failed`, and `cancelled` exist only because the CHECK is
  frozen and are never written: a run is `running` and then `completed`; `IngestionRunEpisodeStatusSchema` says the
  same of `not_attempted`. No legacy normalisation: there is no
  pre-reset data.
- `lib/ai.ts`: `embed(texts)` (batches ≤ 20, 768-dim check, returns the vectors plus their running sum and count for
  the centroid), `summarizeSection(section)` and `reduceSummaries(sections)` returning
  `{ format: "structured", ... } | { format: "raw_fallback", rawText }` with JSON validation and the single
  retry; `AI_FAKE` selects deterministic embeddings (hash of text) and canned summaries, with `AI_FAKE=invalid_json`
  to exercise the fallback. Route code never touches `env.AI`. Publication follows validation with no gate.
- `lib/vectorize.ts`: `VectorStore` with `upsert`, `getByIds`, `query`, every method taking the namespace
  explicitly and asserting `shared-catalog`; id ownership enforced for id-based calls (hard rule 3); `getByIds`
  batches ids at the API's per-call ceiling. `VECTORIZE_FAKE` is an in-memory store with cosine search and a
  configurable "not yet visible" delay so the verify step's retries can be exercised. Filters are split under
  2048 bytes and merged by score.
- `prompts/summary.ts`: the template functions; text below, `prompt_version: "2026-09-08.1"`. Markers are
  `[h:mm:ss]`, and the `at` parser accepts `mm:ss` too.
- Digest basis: `listDigest` filters and orders by `processed_at` (first availability) descending, `video_id` as
  the only tiebreak, `routes/digest.ts` documents it, `EpisodeItem` shows the availability time separately from publication
  time, and takeaways with a valid `startSec` link to `youtu.be/<id>?t=<startSec>`.

**Prompt (for approval):**
> You summarise one episode of a YouTube channel for a reader who has not watched it. Return only JSON with three
> fields: `executiveSummary` (at most three sentences, plain prose, no hype), `takeaways` (three to five objects
> `{ "text", "at" }`: `text` is one concrete claim, example, or recommendation from the episode; `at` is the
> `[h:mm:ss]` marker nearest to where it is said, or null), `topicTags` (one to eight short lowercase tags). Use only
> what the transcript supports; do not invent names, numbers, or timestamps. Transcript follows, with `[h:mm:ss]`
> markers.

**Long episodes (owner decision 2026-09-08): map-reduce.** The orchestration splits chunks into sections of at most
45 minutes, runs one step per section, and runs the reduce step only when there is more than one section. The reduce
prompt (also for approval):

> You are given summaries of consecutive sections of one YouTube episode, each with timestamped takeaways. Return only
> JSON with the same three fields for the whole episode: `executiveSummary` (at most three sentences), `takeaways`
> (three to five, chosen or merged from the sections, each keeping the `at` timestamp of the section takeaway it comes
> from), `topicTags` (one to eight). Do not add anything the sections do not say.

A raw fallback applies per call: if a section's map call fails validation twice, its raw text stands in as that
section's summary; if the reduce call fails twice, the episode stores `raw_fallback` with the concatenated section
summaries.

**Tests:** `registry-episodes` and `routes-follows-digest` cover the availability basis (a video published long ago
but processed inside the window appears; reading does not move it; two readers keep independent receipts; two
episodes processed a second apart list newest availability first whatever their publication dates); summary
validation covers the shape, the retry, and
the fallback; the web keeps typecheck and lint only.

**Done when:** `pnpm check` green; `summarizeSection` and `embed` called once each under `wrangler dev` with
`remote: true` against a real transcript, output shape verified, cost noted here.

### Step 4 — Registry write side  (size: L)

**Files:** `do/registry/runs.ts`, `episodes.ts`, `channels.ts`, `types.ts`, `do/registry.ts`, tests. No migration:
the schema after `0002` already holds every column this step writes.

- **Runs.** `createRun(channelId, kind, selection, { ignorePause })` in one transaction: refuses a channel that is
  not `approved`, refuses a paused channel unless `ignorePause` (the first-approval run, an owner episode retry, and
  an on-demand start pass it), and returns `null` when a run is queued or running, which the start handler reports
  as `run_open` and the route as 409. An empty selection inserts the run already `completed`, `started_at =
  finished_at = now`, with no run-episodes; `selection.feedRead` decides whether `last_checked_at` moves, so a run
  recorded because the feed could not be read leaves it alone. Otherwise it upserts **only**
  `selection.selectedEntries` as `pending` episodes, inserts the run `running` with `started_at` and `episode_limit`
  (the import count on `initial` runs, null otherwise), inserts one run-episode `selected` per selected video, and
  sets `channels.last_checked_at`. The full feed never reaches the Registry: an entry the selection did not take
  is neither tracked nor remembered, so the ten older videos an initial import leaves behind do not exist as
  episodes and cannot be picked up by a later run's "every pending episode" clause. For `kind: "owner_retry"` the
  selection is exactly the one video. Run id is one ULID-style string generated here; `workflow_id` is set to the
  same value, since the instances are named from it and nothing else needs the column.
- **Selection helper.** `selectForRun(channelId, kind, feedEntries)` is a pure function over the channel row, the
  full feed, and the channel's current episodes, returning `{ selectedEntries, reselectedVideoIds, feedRead }`:
  `initial` takes the newest `initial_import_count` feed entries whatever their date; `scheduled` takes untracked
  feed entries whose `published_at` is later than `approved_at` as `selectedEntries`, plus every `pending` episode
  (waiting, or below three attempts) as `reselectedVideoIds`; `owner_retry` takes the given video. Cron passes the
  same feed so a channel is selected consistently. The kind is chosen before selection: `owner_retry` for the retry
  route; otherwise `initial` while no run has selected an episode for the channel (no `ingestion_run_episodes` row
  for any of its runs) and `scheduled` after that, so the first run that does any work is always the initial
  import, whoever creates it, even after empty runs recorded for a feed that could not be read.
- **The three instance writes**, each taking `(runId, videoId, ...)`, each beginning with the run gate (the run row
  must be `queued` or `running`, else `INVALID_STATE`), each updating the episode and its run-episode in one
  transaction, and each ending with the close check:
  - `markTranscript(runId, videoId, outcome)` with outcomes `captions` (sets `transcript_checked_at`, clears
    `waiting_code`, and the instance continues, so the row stops saying "waiting" while the summary is being made),
    `waiting(CAPTIONS | LIVE_OR_UPCOMING | PROVIDER_LIMIT)` which sets `transcript_checked_at` and the wait reason
    without counting an attempt and records the run-episode `waiting`, `skipped(SHORT | NON_ENGLISH | NO_CAPTIONS |
    LIVE_OR_UPCOMING | UNPLAYABLE)` with run-episode `skipped`, `technical(code, detail)` which increments
    `attempt_count`, records the reason, keeps `pending` below three and sets `failed` on the third, with
    run-episode `failed`, and `deterministic(TRANSCRIPT_TOO_LARGE)` which increments `attempt_count` once, since one
    fetch occurred, records the code, and sets `failed` at once whatever the count. `PROVIDER_AUTH`
    and `PROVIDER_RATE_LIMIT` are `technical` like any other provider error: one rule, no account-level family.
    The 48-hour rule lives here: a `waiting CAPTIONS` outcome for a video
    published 48 hours ago or more is a `skipped NO_CAPTIONS` outcome, and the caller must have fetched again to
    reach it.
  - `completeEpisode(runId, videoId, { chunkCount, summary, related })` writes the summary row (takeaways as
    `{ text, startSec }[]`, related ids validated against available episodes), sets `available`, `chunk_count`,
    `vectorized_at`, sets `processed_at` only if null, records the run-episode `available`, and moves
    `channels.last_ingested_at` forward to that `processed_at` (`MAX` of the two, so an out-of-order retry never
    moves it back), in the same transaction, so "Last ingested" and the follows order change the moment a summary
    is readable rather than when the run's slowest sibling finishes.
  - `failEpisode(runId, videoId, code, detail)` for post-transcript technical failures uses the same attempt rule and
    records the run-episode `failed`.
  - **Transition cleanup.** Every write that records an outcome clears the families that describe outcomes it
    supersedes, so one row never tells two stories (reviewer finding, 2026-09-11). `attempt_count` is history and
    only Retry resets it; the other families are current state:

    | Outcome | Sets | Clears | Leaves |
    |---|---|---|---|
    | `captions`, continue | `transcript_checked_at` | `waiting_code` | failure fields, until publish clears or a new failure overwrites them |
    | `waiting` | `waiting_code`, `transcript_checked_at` | `failure_code`, `failure_detail` | `attempt_count` |
    | `technical`, `deterministic`, `failEpisode`, `closeLostRunEpisode`, `recordCreateFailure` | `attempt_count + 1`, `failure_code`, `failure_detail`, `transcript_checked_at` where a fetch happened | `waiting_code` | |
    | `skipped` | skip fields, `transcript_checked_at` | `waiting_code`, `failure_code`, `failure_detail` | `attempt_count` |
    | `completeEpisode` | availability fields, `processed_at` once | `waiting_code`, `failure_code`, `failure_detail` | `attempt_count`, as how many tries it took |
    | owner Retry (exists) | `pending`, `attempt_count` 0 | every wait, failure, and skip field | |
  - **Close check:** when no run-episode of the run is still `selected`, the run closes `completed` with
    `finished_at` set and `failure_code` null; it touches no channel column, since `completeEpisode` already moved
    `last_ingested_at`. `recordCreateFailure(runId, videoId)` marks a run-episode `failed WORKFLOW_LOST` for a `create()`
    that threw, counts one attempt on the episode through the same rule as `failEpisode`, and runs the close check.
  - **Catalog figure:** `catalog.summarize` computes `lastSuccessfulIngestionAt` as `MAX(channels.last_ingested_at)`
    and `runs.lastCompletedFinishedAt` goes, so the health strip reads "when was a summary last published anywhere"
    and a lost instance never drags it backwards.
- **Channels.** No new transition and no separate write: `createRun` sets `last_checked_at` when the feed was read,
  and nothing else in this step touches the channel. `declineChannel` already stopped bumping anything on
  2026-09-11, and there is no failure code and no waiting code on channels.
- **Reconciliation helpers.** `listOpenRunEpisodes(olderThanMs)` returns `(runId, videoId)` pairs still `selected`
  on runs created before the cutoff; `closeLostRunEpisode(runId, videoId)` marks the pair `failed WORKFLOW_LOST`,
  counts one attempt on the episode (`failed` on the third), and runs the close check. Step 8 drives them.
- **Plan decision:** instance ids are `${runId}-${videoId}`, computed and never stored, so reconciliation can name
  every instance from the run-episode row alone. Workflows accepts ids matching `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` up
  to 100 characters (confirmed against Cloudflare's docs 2026-09-11); a ULID, a dash, and an 11-character video id
  is 38 characters and starts with the ULID, so a video id beginning with `-` or `_` is fine. A period was the
  original choice and is not allowed.

**Tests:** extend `registry-runs`, `registry-episodes`, `registry-channels`: one active run per channel; `createRun`
refuses declined, requested, and paused channels and honours `ignorePause`; an empty selection inserts a
`completed` run with no rows and moves `last_checked_at` only when `feedRead` is true; `selectForRun` takes the
newest N for `initial`, only entries published after `approved_at` for `scheduled`, every pending episode including
ones no longer in the feed, and never a skipped or failed one; **the initial-import boundary end to end:** a fifteen
-entry feed and `initial_import_count` 5 leave exactly five episode rows after `createRun`, the other ten are absent
from `episodes`, and a following `scheduled` `createRun` over the same feed selects none of them and creates no rows
for them; the run gate rejects a write against a completed or failed run;
`completeEpisode` sets `processed_at` once and never on retry; `markTranscript` waiting outcomes count no attempt,
technical outcomes count one and flip to `failed` on the third, `PROVIDER_AUTH` and `PROVIDER_RATE_LIMIT` among
them, a deterministic outcome counts one and is `failed` at once from any starting count, skipped outcomes carry
their reason; the close check closes the run `completed` whatever its rows say, a
lost row counts one attempt, and `last_ingested_at` moves at each `completeEpisode`, to that episode's
`processed_at`, while a sibling row is still `selected`, and never backwards; the catalog's `lastSuccessfulIngestionAt` equals
the newest channel `last_ingested_at` and ignores run status (`registry-management`); the 48-hour boundary exactly;
**outcomes that change family across successive writes leave no stale field**: waiting then technical clears the
wait, technical then waiting clears the failure code, waiting then captions then a failed summary ends `pending`
with `AI_SUMMARY_FAILED` and no wait, technical then available ends with no failure code and `attempt_count`
still 1, technical then skipped ends with the skip reason alone; declining an approved channel mid-run changes no run or
episode row, and the run's later writes still succeed; the channel row's status never changes because of a run.

### Step 5 — Bindings  (size: S)

**Files:** `wrangler.jsonc`, `bindings.d.ts`, `vitest.config.ts`, `lib/workflows.ts`, tests. `ai` and `vectorize`
with `remote: true`, `workflows` with `IngestWorkflow`, cron placeholder comment. `WORKFLOW_FAKE` joins the test-only
bindings in `vitest.config.ts` and `bindings.d.ts`, never set in `.dev.vars` or deployed.

- `lib/workflows.ts`: `ingestLauncher(env): { create(id, params), status(id) }`, the only path to `INGEST_WORKFLOW`
  (owner decision 2026-09-11). The real launcher wraps the binding and folds the engine's statuses into `active`
  (queued, running, paused, waiting), `gone` (complete, errored, terminated), or `missing` when `get` throws
  not-found. With `WORKFLOW_FAKE` set, a JSON object of instance id → one of those three, a `default` for unknown
  ids, and a `createFails` list, `create()` is a no-op or throws as instructed and `status()` answers from the map.
  The stagger delays and the id pattern are unit tests of the pure `instanceId` and `startDelaySec` helpers, so the
  fake never has to remember what was created.

Verified by `wrangler dev` starting and `pnpm check` passing. Step 0's finding no longer gates the tests; it decides
only whether one Step 6 test goes through a real instance.

### Step 6 — The per-episode Workflow  (size: L)

**Files:** `workflows/ingest.ts`, `lib/ingest/episode.ts` (the orchestration as a function over a `StepRunner`),
`index.ts` (export the class), tests.

- `ingestEpisode(params, steps, deps)` performs the instance half of spec §3 with `steps.do(name, config, fn)` and
  `steps.sleep(name, seconds)`; `IngestWorkflow.run` adapts `step.do` and `step.sleep`. Params are
  `{ runId, videoId, channelId, startDelaySec }`. Deps are the transcript source, `lib/ai`, `lib/vectorize`, and the
  Registry stub. Nothing in the instance fetches the feed, selects, touches a User DO, or touches channel status.
- Steps in order: `stagger` (sleep `startDelaySec`), `transcript`, `classify` (the `markTranscript` write; any
  outcome but `captions` ends the instance), `embed[i]` and `upsert[i]` per batch of ≤ 20 chunks, `verify`
  (batched `getByIds`, its own retry policy of three from five seconds), `summarize[s]` per section, `reduce` when
  there is more than one section, `related`, `publish` (the `completeEpisode` write).
- `NonRetryableError` for `UNPLAYABLE`, `PROVIDER_AUTH`, `PROVIDER_LIMIT`, `TRANSCRIPT_TOO_LARGE`, and a refused
  Registry write. Step retries and timeouts per spec §3. The episode's `attempt_count` is the cross-run retry; step
  retries are within one instance.
- **Two catch regions, the write chosen by the stage that failed.** Stage 1 is the transcript: `run` awaits the
  transcript step inside a try/catch; a result is classified (`captions`, `waiting`, `skipped`, `deterministic`)
  and a thrown `TranscriptError`, whether non-retryable or thrown after the step's retries, is classified from its
  reason (`technical` for `PROVIDER_HTTP`, `PROVIDER_PARSE`, `PROVIDER_AUTH`, and `PROVIDER_RATE_LIMIT`,
  `waiting PROVIDER_LIMIT`, `skipped UNPLAYABLE`). Either way the outcome reaches
  `markTranscript`, which is itself a `step.do` so a replay never writes it twice, and its answer decides whether the
  instance continues. Stage 2 wraps everything after that: when a step gives up after its retries, the instance
  calls `failEpisode`, also as a step, with the stage's code (`VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`,
  `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED`) and ends. No exception may escape `run`: an instance that errors out
  leaves its run-episode `selected` for the sweep to mislabel as `WORKFLOW_LOST`.
- A refused write, meaning the run was closed under the instance, is logged and ends the instance; it is never
  turned into `failEpisode`, which would be another refused write.
- `TranscriptError` carries its reason as the message prefix, as `DomainError` carries its code, and
  `transcriptFailure(error)` recovers it the way `domainErrorCode` does: an error thrown inside a step reaches the
  catch after the engine has serialised it, and the class and custom fields may not survive.
- Transcript text never logged; logs carry `{ event, runId, channelId, videoId, step, outcome }`.
- Tests drive `ingestEpisode` with an in-process `StepRunner` (runs each step once, records names, skips sleeps) and
  the fakes: happy path to `available` with `processed_at` set and the run closing `completed` when it was the last
  selected row; fresh no-captions to `pending CAPTIONS` and, with the clock moved 48 hours, a second fetch to
  `skipped NO_CAPTIONS`; a short video to `skipped SHORT`; non-English to `skipped NON_ENGLISH`; a transport failure
  to `pending` with one attempt, then `failed` on the third run, reached through `markTranscript` when the
  transcript step is what gave up and through `failEpisode` when a later step did; a 401, and a 429 still standing after the step's retries, each → `pending` with one attempt and run-episode
  `failed` with the code, exactly like a 500; `verify` missing an id past its retries → `VECTORIZE_INCOMPLETE` attempt, and an id
  that appears on the second try → no attempt; invalid model JSON → `raw_fallback`; related-query failure →
  published summary with `[]`; a 403 → `pending PROVIDER_LIMIT`, run-episode `waiting`, and the run closing `completed`; a
  write against a run that reconciliation closed → refused, instance exits, nothing changes. If Step 0 showed the
  pool runs Workflows, one test also goes through `env.INGEST_WORKFLOW.create()`.

### Step 7 — The start handler  (size: M)

**Files:** `lib/ingestion.ts`, `routes/channels.ts`, `routes/catalog.ts`, `lib/youtube/rss.ts` (the feed fake grows
entries), `vitest.config.ts`, `packages/shared/src/index.ts`, tests.

- `startRun(env, channelId, { ignorePause, videoId?, stagger, feed? })` replaces the log-only `requestIngestion`.
  It begins with the pre-flight gate for every caller: `providerStatus(env)`, cached five minutes per isolate; on
  `auth_failed` or `remainingCredits === 0` it returns `{ outcome: "provider_blocked", status }` at once, having
  fetched nothing and recorded nothing (`unreachable` and unknown credits do not block). The kind is `owner_retry`
  when `videoId` is given; otherwise `initial` while no run has selected an episode for the channel and `scheduled`
  after that, read from the Registry before the feed is fetched. Then: an owner retry fetches no feed, since its selection is exactly the one video, which may have left the feed. Otherwise fetch the
  feed with `feedFetcher(env)` unless the caller passed one, and compute the selection. Call `registry.createRun` in
  every case: an empty selection, or a feed that could not be read, records a run already `completed` with no
  run-episodes, with `feedRead` false in the second case so `last_checked_at` stays. For a non-empty selection, for
  each selected video call `ingestLauncher(env).create(`${runId}-${videoId}`, params)` with `startDelaySec` taken
  from the `stagger` counter (`k × 3` across everything created in this invocation); a `create()` that throws is
  recorded at once with `registry.recordCreateFailure`. **Every way `startRun` can end is a named outcome**, so no
  caller has to interpret `null`:
  - `{ outcome: "started", run }` for any run it recorded, empty or not;
  - `{ outcome: "run_open" }` when a run is already queued or running;
  - `{ outcome: "feed_unavailable", run }` when the feed could not be read: the empty run has been recorded and
    `{ event: "ingestion.feed_unavailable", channelId }` logged, and the caller decides whether that is an error
    for it;
  - `{ outcome: "provider_blocked", status }` when the pre-flight gate refused: nothing fetched, nothing recorded.
- Callers: `POST /channels` (owner add, passing the feed it already fetched for the title, so no second request)
  and `POST /channels/:id/approve` on first approval resolve to `initial` with `ignorePause`, run after the approval
  has committed, and answer with the channel as usual whatever the outcome; on `provider_blocked` the channel simply
  has no run row and reads "approved, never started" until the key or the balance is fixed.
  `POST /channels/:id/episodes/:videoId/retry` passes the one video (`owner_retry`, `ignorePause`, no feed) and on
  `provider_blocked` answers with the episode, now `pending` with attempts cleared, which the next unblocked start
  picks up. Cron (Step 8) logs each outcome and moves on.
- **Plan decision:** add `POST /channels/:id/runs` (owner; channel must be `approved`, else 409 `INVALID_STATE`)
  creating a run now, ignoring pause, `initial` or `scheduled` by the rule above. Responses:
  - 200 `{ run }` for `started`; a run with no run-episodes and status `completed` tells the owner the feed had
    nothing new and nothing is pending;
  - 409 `INVALID_STATE` for `run_open`;
  - 502 `UPSTREAM_UNAVAILABLE` for `feed_unavailable`, the same error `POST /channels` already returns for a feed it
    cannot read, after the empty run has been recorded;
  - 502 `UPSTREAM_UNAVAILABLE` for `provider_blocked`, with the message naming the reason, "transcript key
    rejected" or "no transcript credits", and nothing recorded.
  Shared `IngestionRunResponse { run: IngestionRun }`. It is the Start action for a never-started channel and the
  owner's nudge after a credit refill.
- `GET /catalog` gains `transcripts: { remainingCredits, status }` from `providerStatus(env)`, cached for five
  minutes per isolate, two-second timeout; `status` is `ok`, `auth_failed`, or `unreachable`, and `remainingCredits`
  is `null` when the call fails, times out, or the fake source is in use. The response never fails because of it.
- `YOUTUBE_FEEDS_FAKE` accepts `channelId → { title, entries: { videoId, title, publishedAt }[] }` beside the
  existing string form, so route tests can seed a feed with a Short, a fresh upload, and an old entry.
- Route tests assert exactly one run row with the right run-episodes after first approval, after
  `POST /channels/:id/runs`, and after an episode retry (one run-episode, that video, no feed request recorded by
  the fake, and a video absent from the feed still selected); a Start on a channel none of whose runs
  selected anything creates an `initial` run selecting the newest N regardless of date, and on a channel with a run
  that did a `scheduled` one; none after re-approval of a previously approved channel; Start answers 200 with the
  run, 409 for a second start while one is open, 200 with an empty `completed` run and a moved `lastCheckedAt` when
  the seeded feed has nothing new and nothing is pending, and 502 with an empty `completed` run recorded and an
  unmoved `lastCheckedAt` when the feed fake answers 500, and 502 naming the reason with no run row at all when the
  transcripts fake reports `auth_failed` or zero credits; under that same fake an approve still approves and leaves
  the channel never-started, and a retry leaves the episode `pending` with attempts cleared and no run; the catalog
  carries credits (`null` and `unreachable` with the fake, the seeded values otherwise); the first-approval run is
  created while the channel is
  system-paused; a `create()` that `WORKFLOW_FAKE` is
  told to throw for is recorded as run-episode `failed WORKFLOW_LOST` at once; an approve whose feed fetch fails
  still approves, records an empty `completed` run, and the next tick gives that channel an `initial` run;
  instances created in one call carry delays 0, 3, 6, … s and ids that
  match Workflows' `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`, including a video id that starts with `-`.

### Step 8 — Cron handler and reconciliation  (size: M)

**Files:** `index.ts` (the default export becomes `{ fetch: app.fetch, scheduled }`), `lib/ingestion.ts`
(`runScheduledTick(env)`, `reconcileRuns(env)`), tests.

Order inside one tick: reconcile, select channels, start runs. The pre-flight gate lives inside `startRun`, so the
tick meets it on its first channel; because the wrapper is cached, that is one real `/status` call per tick.

- `reconcileRuns(env)`: for every `(runId, videoId)` from `listOpenRunEpisodes(now − 1 h)`, ask
  `ingestLauncher(env).status(`${runId}-${videoId}`)`. `active` → leave it. `gone` or `missing` →
  `closeLostRunEpisode`. Logs `{ event: "ingestion.reconciled", runId, videoId, status }`.
- Pre-flight: when the first `startRun` of the tick answers `provider_blocked`, log
  `{ event: "ingestion.tick_skipped", reason }` and stop the tick; the remaining channels would get the same cached
  answer. `unreachable` and unknown credits do not block.
- Selection: channels with `status = 'approved'`, `paused_by IS NULL`, and no open run; for each, `startRun(env,
  channelId, { stagger })` with one stagger counter shared across the whole tick, which creates an `initial` run while
  nothing has been selected for the channel and a `scheduled` one after that. Each call sits in its own try/catch
  so one channel's unexpected error never stops the others; `feed_unavailable` and `run_open` are logged and need
  no action, and an empty run is the record that the tick looked. Selection inside
  `startRun` resumes persisted `pending` work (waiting and attempts below three, including episodes no longer in
  the feed) and never touches `skipped` or `failed` episodes. Feed fetches run in batches of five with
  `Promise.all`; the whole tick sits inside the cron trigger's 15-minute wall clock, ample at this catalog size.
- Verified with `wrangler dev --test-scheduled` and `curl "http://127.0.0.1:8787/__scheduled?cron=0+*/6+*+*+*"`.
  `triggers.crons` becomes `["0 */6 * * *"]` (owner decision 2026-09-08).

**Tests:** a seeded open run older than an hour whose instance `WORKFLOW_FAKE` reports `gone` closes
`failed WORKFLOW_LOST` with one attempt added to the episode, and a `missing` one closes the same way; a run
younger than an hour is left alone; an `active` instance is left alone; the tick skips paused channels and channels with an open run; a channel with
nothing new and nothing pending gets an empty `completed` run and its `lastCheckedAt` moves; one whose feed answers
500 gets an empty `completed` run with `lastCheckedAt` unmoved; a channel whose runs never selected anything gets an
`initial` run from the tick; with the provider status
`auth_failed` or credits `0` nothing starts, and with `unreachable` the tick proceeds; delays increase across channels within one tick.

### Step 9 — Owner and reader touches, walkthrough, docs  (size: M)

- Web: **Start** on never-started rows in `AttentionList` and in the catalog table, calling `POST /channels/:id/runs`
  and showing the run on the row: "Started, N episodes", or "Nothing new to import" when the run came back with no
  episodes, and the API's message for 409 and 502 through the existing row error, so "YouTube did not answer" reads
  the same as it does when adding a channel; the runs list renders an empty run as one quiet line, since a channel
  gets up to four a day, and the latest one says which kind it was: `lastCheckedAt` equal to the run's `startedAt`
  reads "no episodes · nothing new", an older `lastCheckedAt` reads "no episodes · feed could not be read since
  [last checked]", derived in `copy.ts` from the two fields the management block already carries, with the same
  phrase in the catalog table's Latest run cell; `lastCheckedAt` on the owner detail header and as a Last checked
  column in the catalog table; the credits figure and the transcript key status on the catalog health strip; the digest's
  three empty states and its availability-time label (spec §2, AGENTS.md Screens); a **Refresh** control beside
  "Show last 7 days" that runs the existing list reload, which re-fetches the digest after the lists so NEW markers
  and unread counts still describe one moment, because polling stops at approval and ingestion finishes minutes
  later with no other way for a reader to ask again short of reloading the page (there is still no poll beyond the
  requested-channel one); takeaway timestamp links; owner
  phrases for the technical codes in `copy.ts`. `apps/web` stays typecheck and lint only.
- `wrangler dev` end to end per spec §7, recorded below: first approval with no followers starts the import while
  paused → a follow resumes scheduling → captioned video `available`, fresh captionless `pending CAPTIONS`, short
  `skipped SHORT` → a forced transport failure counts an attempt → decline mid-run changes nothing and the run
  closes `completed` with its summaries hidden → re-approve shows them and starts nothing → `/__scheduled` starts
  staggered runs → credits shown on the catalog.
- Docs: PRD §4.2 and §4.4 wording for the digest basis; PRD §7 Screens (Start on never-started rows, the health
  strip's credits and key status, the empty-run line in the runs list) and the PRD §7 route table
  (`POST /channels/:id/runs` with its three answers, `GET /catalog`'s `transcripts` block); AGENTS.md's API table,
  where the Start route moves from "planned" to a row of its own; `channel-simplification.md` §5's catalog row; `home-read-experience.md` §8, whose owner detail wireframe and
  runs paragraph were brought to the run-carries-no-verdict model on 2026-09-11 and take whatever the walkthrough
  changes; spec and plan status set for work actually completed.

## Walkthrough record

_Filled in at Step 9._
