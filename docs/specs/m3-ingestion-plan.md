# Implementation plan — M3 Ingestion

**Implements:** `docs/specs/m3-ingestion.md` under the rules in `AGENTS.md`, on the channel and episode model of
`docs/specs/channel-simplification.md` (merged 2026-09-10).
**Written:** 2026-09-08, against `main` at `c959cc6`. **Revised:** 2026-09-10 against `main` at `6e075b1`: channels
carry no import outcome, requesters follow when they request, episodes are `pending | available | failed | skipped`
with wait and skip reasons and three technical attempts, and the owner's episode retry and skip routes already exist.
**Status:** proposed; starts on the owner's go. Plan decisions are marked **plan decision** and can be vetoed before
their step starts. No new dependencies in any step.
**Shape:** preparatory Step 0 plus nine delivery steps, each one commit, `pnpm check` green after each, and anything
touching Workers runtime behaviour exercised under `wrangler dev`. Steps 1–2 add transcript and chunking support;
Step 3 delivers the shared contracts and the AI and Vectorize wrappers; Step 4 adds the Registry write side;
Step 5 adds bindings; Step 6 is the Workflow; Steps 7–9 wire the start points, the cron handler, and the docs.

**Prerequisites (owner):** the Vectorize index and its two metadata indexes exist (AGENTS.md → One-time setup);
`wrangler secret put DOWNSUB_API_KEY`; Workers Paid confirmed or the free-plan CPU limit accepted as a risk; the
reconciliation `TODO(owner)` in spec §2 decided before Step 4.

**What already exists (2026-09-10) and this plan builds on:** the Registry `episodes`, `ingestion_runs`, and
`ingestion_run_episodes` tables with the CHECK constraints of `channel-simplification.md` §6.1; `do/registry/episodes.ts`
with `listByChannel`, `listDigest`, `countByChannel`, `listAvailableVideoIds`, `getEpisode`, `retryEpisode`, `skipEpisode`;
`do/registry/runs.ts` read helpers and `hasActiveRun`; the facade's `retryEpisode`/`skipEpisode`; `lib/ingestion.ts`
`requestIngestion(channelId, reason)` as a log line with reasons `channel_approved` and `episode_retry`; the routes
`POST /channels/:id/episodes/:videoId/retry|skip`; `Episode.skipReason` for readers and `processing.waitingCode` for
the owner; the web copy for every skip and wait reason; and `GET /catalog` with `attention.neverStarted`.

### Step 0 — Two checks before design settles  (size: S)

- Confirm the pinned `@cloudflare/vitest-pool-workers` runs a trivial Workflow (`env.X.create()` then `status()`)
  and tolerates `ai` and `vectorize` bindings with `remote: true` in `wrangler.jsonc` when nothing calls them. If
  either fails, tests drive `ingestChannel()` through the in-process step runner of Step 6 instead, and the bindings
  move to a `wrangler.test.jsonc` the pool loads.
- Confirm the Vectorize index exists: `wrangler vectorize info media-rag` shows 768 / cosine and both metadata indexes.

**Done when:** both outcomes are written at the top of this plan.

### Step 1 — Transcript source seam and the DownSub adapter  (size: M)

**Files:** `lib/transcripts/types.ts`, `lib/transcripts/vtt.ts`, `lib/transcripts/downsub.ts`,
`lib/transcripts/index.ts`, `bindings.d.ts`, `.dev.vars.example`, `vitest.config.ts` (`TRANSCRIPTS_FAKE`), tests.

- `types.ts`: `TranscriptSource` returning
  `TranscriptResult = { segments | null, durationSec | null, isLive, captionStatus: "english" | "none" | "non_english" }`,
  `TranscriptSegment`, `TranscriptError` with the `TranscriptFailure` union, and `chooseTrack(tracks)` implementing
  the English-first rule over `{ code, auto }` pairs, returning no track when captions exist but none is English
  (`captionStatus: "non_english"`, distinct from `"none"`).
- `vtt.ts`: pure WebVTT/SRT cue parser (the spike's `parseCues`, hardened: tag stripping, `.`/`,` millis, blank
  cues skipped). Tests: fixtures for both formats, hours field, multi-line cues, tags.
- `downsub.ts`: `downsubSource(env, fetchImpl)`; state and HTTP mapping from spec §2; VTT preferred, SRT fallback
  if a track lacks VTT; discards `translatedSubtitles`; reports `duration` and `metadata.isLiveContent` (also on the
  `error` state, where live/upcoming wins over `UNPLAYABLE`) so selection can skip Shorts and wait for streams.
  `remainingCredits(env)` wraps `/status` for the catalog. Tests with fixtures taken from the probe: found,
  no_subtitles, error, error-but-live, 401/403/429, malformed body; the probe's VTT for `jNQXAC9IVRw` parses to its
  known 6 cues.
- `index.ts`: `transcriptSource(env)`: `TRANSCRIPTS_FAKE` → canned (`{ [videoId]: TranscriptResult | { reason } }`);
  else the DownSub adapter, which throws `PROVIDER_AUTH` at first use when the key is missing. The fake mirrors
  `feedFetcher` and covers duration, live/upcoming, and every caption status, so tests can drive the exact 180-second
  and 48-hour boundaries, unknown duration, and no-captions versus non-English.

**Done when:** `pnpm check` green; under `wrangler dev` a throwaway call for one video matches the probe's numbers
(6 segments for `jNQXAC9IVRw`, first cue at 1.2 s), then is removed.

### Step 2 — Chunking  (size: S)

**Files:** `lib/chunk.ts`, tests. Pure function per spec §3.1. Tests: empty, one segment, very long single segment,
overlap, the 480-token ceiling, deterministic indices.

### Step 3 — Shared contracts, AI and Vectorize wrappers  (size: L)

**Files:** `lib/ai.ts`, `lib/vectorize.ts`, `prompts/summary.ts`, `bindings.d.ts`, `vitest.config.ts`,
`packages/shared/src/index.ts`, `lib/episode-view.ts`, `do/registry/episodes.ts` (summary reader), `routes/digest.ts`,
web `EpisodeItem`, fixtures and tests.

- `packages/shared`: `EpisodeSummary.takeaways` becomes `{ text: string; startSec: number | null }[]`; `Episode`
  gains `summaryAvailableAt: UnixMs | null` (the first `processed_at`, null until available); `CatalogSchema` gains
  `transcripts: { remainingCredits: number | null }`. No legacy normalisation: there is no pre-reset data.
- `lib/ai.ts`: `embed(texts)` (batches ≤ 20, 768-dim check), `summarizeSection(section)` and `reduceSummaries(sections)`
  returning `{ format: "structured", ... } | { format: "raw_fallback", rawText }` with JSON validation and the single
  retry; `AI_FAKE` selects deterministic embeddings (hash of text) and canned summaries, with `AI_FAKE=invalid_json`
  to exercise the fallback. Route code never touches `env.AI`. Publication follows validation with no gate.
- `lib/vectorize.ts`: `VectorStore` with `upsert`, `getByIds`, `query`, every method taking the namespace
  explicitly and asserting `shared-catalog`; id ownership enforced for id-based calls (hard rule 3). `VECTORIZE_FAKE`
  is an in-memory store with cosine search. Filters are split under 2048 bytes and merged by score.
- `prompts/summary.ts`: the template functions; text below, `prompt_version: "2026-09-08.1"`.
- Digest basis: `listDigest` filters and orders by `processed_at` (first availability), `routes/digest.ts` documents
  it, `EpisodeItem` shows the availability time separately from publication time, and takeaways with a valid
  `startSec` link to `youtu.be/<id>?t=<startSec>`.

**Prompt (for approval):**
> You summarise one episode of a YouTube channel for a reader who has not watched it. Return only JSON with three
> fields: `executiveSummary` (at most three sentences, plain prose, no hype), `takeaways` (three to five objects
> `{ "text", "at" }`: `text` is one concrete claim, example, or recommendation from the episode; `at` is the `[mm:ss]`
> marker nearest to where it is said, or null), `topicTags` (one to eight short lowercase tags). Use only what the
> transcript supports; do not invent names, numbers, or timestamps. Transcript follows, with `[mm:ss]` markers.

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
but processed inside the window appears; reading does not move it; two readers keep independent receipts); summary
validation covers the shape, the retry, and the fallback; the web keeps typecheck and lint only.

**Done when:** `pnpm check` green; `summarizeSection` and `embed` called once each under `wrangler dev` with
`remote: true` against a real transcript, output shape verified, cost noted here.

### Step 4 — Registry write side  (size: L)

**Files:** `do/registry/runs.ts`, `episodes.ts`, `channels.ts`, `types.ts`, `do/registry.ts`, tests. No migration:
the schema of `channel-simplification.md` §6.1 already holds every column this step writes.

- Runs: `createRun(channelId, kind, episodeLimit, { ignorePause })` refuses a channel that is not `approved`, refuses
  a paused channel unless `ignorePause` (the first-approval run, an owner episode retry, and an on-demand start pass
  it), and returns `null` when a run is queued or running; `startRun`, `recordSelection` (run episodes `selected`),
  `finishRun` (a `PROVIDER_LIMIT` outcome ends the run `failed` with that code, leaves untouched selected episodes
  `pending` with `waiting_code = PROVIDER_LIMIT`, and marks their run episodes `not_attempted`). Run id = Workflow
  instance id, one ULID-style string.
- Episodes: `upsertFromFeed`, `markTranscript(videoId, fence, outcome)` with outcomes `captions`, `waiting(CAPTIONS |
  LIVE_OR_UPCOMING)` which sets `transcript_checked_at` and the wait reason without counting an attempt,
  `skipped(SHORT | NON_ENGLISH | NO_CAPTIONS | LIVE_OR_UPCOMING | UNPLAYABLE)`, and `technical(code, detail)` which
  increments `attempt_count`, records the reason, keeps `pending` below three and sets `failed` on the third;
  `completeEpisode` writes the summary row (takeaways as `{ text, startSec }[]`) and the episode in one transaction,
  clears any wait reason, and sets `processed_at` only if null; `failEpisode` for post-transcript technical failures
  uses the same attempt rule. Every write takes `lifecycleVersion` and throws `INVALID_STATE` on a fence mismatch or
  a channel that is not `approved`. The 48-hour rule lives here: a `waiting CAPTIONS` outcome for a video published
  48 hours ago or more is a `skipped NO_CAPTIONS` outcome, and the caller must have fetched again to reach it.
- Channels: `touchChecked(channelId, fence)` and `touchIngested(channelId, fence)` only. No status change, no failure
  code, no waiting code: `channels.ts` keeps the transitions of `channel-simplification.md` §3.1 and nothing else.
- Reconciliation: `listOpenRuns()` and `closeLostRun(runId, code = "WORKFLOW_LOST")` for Step 8, using the
  owner-decided window from spec §2.
- **Plan decision:** run ids are generated in the Registry so `workflow_id = run_id`, and the Workflow is created
  with that id. Handle an ambiguous create response by checking that id; identity alone does not guarantee startup.
  Definitive creation failure and abandoned starts transition through reconciliation, not by staying queued forever.

**Tests:** extend `registry-runs`, `registry-episodes`, `registry-channels`: one active run per channel; `createRun`
refuses declined, requested, and paused channels and honours `ignorePause`; the fence rejects a stale version and a
declined channel; `completeEpisode` sets `processed_at` once and never on retry; `markTranscript` waiting outcomes
count no attempt, technical outcomes count one and flip to `failed` on the third, skipped outcomes carry their
reason; `finishRun` with `PROVIDER_LIMIT` leaves waits and `not_attempted` rows; the 48-hour boundary exactly;
the channel row's status never changes.

### Step 5 — Bindings  (size: S)

**Files:** `wrangler.jsonc`, `bindings.d.ts`, `vitest.config.ts`. `ai` and `vectorize` with `remote: true`,
`workflows` with `IngestWorkflow`, cron placeholder comment. Verified by `wrangler dev` starting and `pnpm check`
passing (Step 0's finding decides whether tests see these bindings).

### Step 6 — The Workflow  (size: L)

**Files:** `workflows/ingest.ts`, `lib/ingest/run.ts` (the orchestration as a function over a `StepRunner`),
`index.ts` (export the class), tests.

- `ingestChannel(params, steps, deps)` performs spec §3 with `steps.do(name, config, fn)`; `IngestWorkflow.run`
  adapts `step.do`. Deps are the transcript source, `lib/ai`, `lib/vectorize`, and the Registry stub. Nothing in the
  run touches a User DO or the channel's status.
- `NonRetryableError` for `UNPLAYABLE`, `PROVIDER_AUTH`, fencing, and no captions; step retries and timeouts per
  spec §3. The episode's `attempt_count` is the cross-run retry; step retries are within one run.
- Transcript text never logged; logs carry `{ event, runId, channelId, videoId, step, outcome }`.
- Tests drive `ingestChannel` with an in-process `StepRunner` (runs each step once, records names) and the fakes:
  happy path to `available` with `processed_at` set; fresh no-captions to `pending CAPTIONS` and, with the clock
  moved 48 hours, a second fetch to `skipped NO_CAPTIONS`; a short video to `skipped SHORT`; non-English to `skipped
  NON_ENGLISH`; a transport failure to `pending` with one attempt, then `failed` on the third run; decline mid-run →
  `cancelled` and nothing published; `verify` missing an id → `VECTORIZE_INCOMPLETE` attempt; invalid model JSON →
  `raw_fallback`; related-query failure → published summary with `[]`; `PROVIDER_LIMIT` → run failed, remaining
  episodes waiting. If Step 0 showed the pool runs Workflows, one test also goes through `env.INGEST_WORKFLOW.create()`.

### Step 7 — Start points  (size: M)

**Files:** `lib/ingestion.ts`, `routes/channels.ts`, `routes/catalog.ts`, `packages/shared/src/index.ts`, tests.

- `requestIngestion(env, channelId, reason)` becomes `createRun` + `INGEST_WORKFLOW.create({ id: runId, params })`,
  returning the run or `null`. Reasons: `channel_approved` (first approval; `kind: "initial"`, `ignorePause`),
  `episode_retry` (`kind: "owner_retry"`, the one episode, `ignorePause`), and `owner_start` (below). A definitive
  create failure records the run as `failed WORKFLOW_LOST` so the channel does not read "never started" forever.
- **Plan decision:** add `POST /channels/:id/runs` (owner; `approved`; 409 while a run is active) creating a
  `scheduled`-kind run now, ignoring pause, and returning `{ run }`. It is the Start action for a never-started
  channel and the owner's manual nudge after a credit refill. Shared `IngestionRunResponse { run: IngestionRun }`.
- `GET /catalog` gains `transcripts: { remainingCredits: number | null }` from the DownSub `/status` wrapper, cached
  for five minutes per isolate and `null` when the call fails or the fake source is in use.
- Route tests assert exactly one run row after first approval, after `POST /channels/:id/runs`, and after an
  episode retry; none after re-approval of a previously approved channel; 409 for a second start while one is
  active; the catalog carries credits (`null` with the fake); the first-approval run is created while the channel
  is system-paused.

### Step 8 — Cron handler and reconciliation  (size: M)

**Files:** `index.ts` (`scheduled`), `lib/ingestion.ts` (`startScheduledRuns(env)`, `reconcileRuns(env)`), tests.

Selects channels with `status = 'approved'`, `paused_by IS NULL`, and no active run, and starts a `scheduled` run
for each; selection inside the run resumes persisted `pending` work (waiting and attempts below three, including
episodes no longer in the feed) and never touches `skipped` or `failed` episodes. Before starting, reconcile: close
queued or running runs whose Workflow is missing or failed as `WORKFLOW_LOST` within the owner-decided window.
Verified with `wrangler dev --test-scheduled` and `curl "http://127.0.0.1:8787/__scheduled?cron=0+*/6+*+*+*"`.
`triggers.crons` becomes `["0 */6 * * *"]` (owner decision 2026-09-08).

### Step 9 — Owner and reader touches, walkthrough, docs  (size: M)

- Web: **Start** on never-started rows in `AttentionList` calling `POST /channels/:id/runs`; the credits figure on
  the catalog health strip; the digest's three empty states and its availability-time label (spec §2, AGENTS.md
  Screens); takeaway timestamp links. `apps/web` stays typecheck and lint only.
- `wrangler dev` end to end per spec §7, recorded below: first approval with no followers starts the import while
  paused → a follow resumes scheduling → captioned video `available`, fresh captionless `pending CAPTIONS`, short
  `skipped SHORT` → a forced transport failure counts an attempt → decline mid-run cancels → re-approve resumes on
  the next `/__scheduled` → credits shown on the catalog.
- PRD §4.2 and §4.4 wording for the episode machine and the digest basis; spec and plan status set for work actually
  completed.

## Walkthrough record

_Filled in at Step 9._
