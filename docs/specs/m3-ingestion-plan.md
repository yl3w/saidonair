# Implementation plan — M3 Ingestion
> **Superseded in part (2026-09-10):** channel states, requests, follows, deletion, and episode statuses are now defined by docs/specs/channel-simplification.md; sections describing channel_requests, deleted_at, channel failure codes, channel retry, or the automatic follow are historical. The M3 documents need revision against that spec's §12 before implementation.

**Implements:** `docs/specs/m3-ingestion.md` under the rules in `AGENTS.md`.
**Written:** 2026-09-08, against `main` at `c959cc6`. **Status:** proposed; starts on the owner's go. Plan decisions are marked **plan decision**
and can be vetoed before their step starts. No new dependencies in any step.
**Shape:** nine steps, each one commit, `pnpm check` green after each, and anything touching Workers runtime behaviour
exercised under `wrangler dev`. Steps 1–4 are pure or Registry-only and leave HTTP behaviour unchanged. Step 5 adds
bindings. Step 6 is the Workflow. Steps 7–9 wire the start points, the cron handler, and the docs.

**Prerequisites (owner):** the Vectorize index and its two metadata indexes exist (AGENTS.md → One-time setup);
`wrangler secret put DOWNSUB_API_KEY`; Workers Paid confirmed or the free-plan CPU limit accepted as a risk.

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

- `types.ts`: `TranscriptSource` returning `TranscriptResult = { segments | null, durationSec | null, isLive }`,
  `TranscriptSegment`, `TranscriptError` with the `TranscriptFailure` union, and `chooseTrack(tracks)` implementing
  the English-first rule over `{ code, auto }` pairs, returning `null` (→ `NON_ENGLISH`) when no English track exists.
- `vtt.ts`: pure WebVTT/SRT cue parser (the spike's `parseCues`, hardened: tag stripping, `.`/`,` millis, blank
  cues skipped). Tests: fixtures for both formats, hours field, multi-line cues, tags.
- `downsub.ts`: `downsubSource(env, fetchImpl)`; state mapping and HTTP mapping from spec §2; VTT preferred, SRT
  fallback if a track lacks VTT; discards `translatedSubtitles`; reports `duration` and `metadata.isLiveContent`
  (also on the `error` state) so selection can skip Shorts and wait for streams. `remainingCredits(env)` wraps
  `/status` for the catalog. Tests with fixtures taken from the probe:
  found, no_subtitles, error, 401/403/429, malformed body; the probe's VTT for `jNQXAC9IVRw` parses to its known 6 cues.
- `index.ts`: `transcriptSource(env)`: `TRANSCRIPTS_FAKE` → canned (`{ [videoId]: segments | null | { reason } }`);
  else the DownSub adapter, which throws `PROVIDER_AUTH` at first use when the key is missing. The fake mirrors
  `feedFetcher`.

**Done when:** `pnpm check` green; under `wrangler dev` a throwaway call for one video matches the probe's numbers
(6 segments for `jNQXAC9IVRw`, first cue at 1.2 s), then is removed.

### Step 2 — Chunking  (size: S)

**Files:** `lib/chunk.ts`, tests. Pure function per spec §3.1. Tests: empty, one segment, very long single segment,
overlap, the 480-token ceiling, deterministic indices.

### Step 3 — AI and Vectorize wrappers  (size: M)

**Files:** `lib/ai.ts`, `lib/vectorize.ts`, `prompts/summary.ts`, `bindings.d.ts`, `vitest.config.ts`, tests.

- `lib/ai.ts`: `embed(texts)` (batches ≤ 20, 768-dim check), `summarize(input)` returning
  `{ format: "structured", ... } | { format: "raw_fallback", rawText }` with JSON validation and the single retry;
  `AI_FAKE` selects deterministic embeddings (hash of text) and canned summaries, with `AI_FAKE=invalid_json` to
  exercise the fallback. Route code never touches `env.AI`.
- `lib/vectorize.ts`: `VectorStore` with `upsert`, `getByIds`, `query`, every method taking the namespace
  explicitly and asserting `shared-catalog`; id ownership enforced for id-based calls (hard rule 3). `VECTORIZE_FAKE`
  is an in-memory store with cosine search. Filters are split under 2048 bytes and merged by score.
- `prompts/summary.ts`: the template function; text below, `prompt_version: "2026-09-08.1"`.

**Prompt (for approval):**
> You summarise one episode of a YouTube channel for a reader who has not watched it. Return only JSON with three
> fields: `executiveSummary` (at most three sentences, plain prose, no hype), `takeaways` (three to five objects
> `{ "text", "at" }`: `text` is one concrete claim, example, or recommendation from the episode; `at` is the `[mm:ss]`
> marker nearest to where it is said, or null), `topicTags` (one to eight short lowercase tags). Use only what the
> transcript supports; do not invent names, numbers, or timestamps. Transcript follows, with `[mm:ss]` markers.

**Long episodes (owner decision 2026-09-08): map-reduce.** `lib/ai.ts` exposes `summarizeSection(section)` and
`reduceSummaries(sections)`; the orchestration splits chunks into sections of at most 45 minutes, runs one step per
section, and runs the reduce step only when there is more than one section. The reduce prompt (also for approval):

> You are given summaries of consecutive sections of one YouTube episode, each with timestamped takeaways. Return only
> JSON with the same three fields for the whole episode: `executiveSummary` (at most three sentences), `takeaways`
> (three to five, chosen or merged from the sections, each keeping the `at` timestamp of the section takeaway it comes
> from), `topicTags` (one to eight). Do not add anything the sections do not say.

A raw fallback applies per call: if a section's map call fails validation twice, its raw text stands in as that
section's summary; if the reduce call fails twice, the episode stores `raw_fallback` with the concatenated section
summaries.

**Done when:** `pnpm check` green; `summarize` and `embed` called once each under `wrangler dev` with `remote: true`
against a real transcript, output shape verified, cost noted here.

### Step 4 — Registry write side  (size: L)

**Files:** `do/registry/runs.ts`, `episodes.ts`, `channels.ts`, `requests.ts`, `types.ts`, `do/registry.ts`, tests.

- Runs: `createRun(channelId, kind, episodeLimit)` (refuses when the channel is deleted or failed for scheduled
  runs; returns `null` when a run is queued or running), `startRun`, `recordSelection`, `finishRun` (a
  `PROVIDER_LIMIT` outcome ends the run `failed` with that code, leaves untouched episodes `pending`, and never fails
  the channel). Run id = Workflow instance id, one ULID-style string.
- Channels: `NON_ENGLISH` joins the failure codes chosen by `finishRun` when every attempted episode lacked an English
  track.
- Episodes: `upsertFromFeed`, `markTranscript` (outcomes: captions, `no_transcript`, **not-yet** which sets
  `transcript_checked_at` without counting an attempt, `SKIPPED_SHORT`, `NON_ENGLISH`, `LIVE_OR_UPCOMING`, failure),
  `completeEpisode`, `failEpisode`, all taking `lifecycleVersion` and throwing `INVALID_STATE` on a fence mismatch or
  a deleted channel; `completeEpisode` writes the summary row (takeaways as `{ text, startSec }[]`) and the episode in
  one transaction and flips a pending channel to `available` with `available_at`. Selection treats a `pending` episode
  with `transcript_checked_at` newer than 48 h after `published_at` as "not yet", older as `no_transcript`.
- Channels: `failChannel(channelId, fence, code, detail)` for the end of an initial or retry run without a processed
  episode; `touchChecked`.
- Requests: `listPendingAutoFollows(channelId)`, `ackAutoFollow(requestId)`.
- **Plan decision:** run ids are generated in the Registry so `workflow_id = run_id`, and the Workflow is created
  with that id; a duplicate `create` is therefore impossible.

**Tests:** extend `registry-runs`, `registry-episodes`, `registry-management`: one active run per channel; fence
rejects a stale version and a deleted channel; first `completeEpisode` makes the channel available and later
failures do not revoke it; `finishRun` picks `NO_TRANSCRIPTS` / `NO_EPISODES` / `INITIAL_IMPORT_FAILED` correctly;
retry reuses processed episodes and reattempts `no_transcript`; scheduled selection skips `no_transcript` and
episodes with 3 attempts.

### Step 5 — Bindings  (size: S)

**Files:** `wrangler.jsonc`, `bindings.d.ts`, `vitest.config.ts`. `ai` and `vectorize` with `remote: true`,
`workflows` with `IngestWorkflow`, cron placeholder comment. Verified by `wrangler dev`
starting and `pnpm check` passing (Step 0's finding decides whether tests see these bindings).

### Step 6 — The Workflow  (size: L)

**Files:** `workflows/ingest.ts`, `lib/ingest/run.ts` (the orchestration as a function over a `StepRunner`),
`index.ts` (export the class), tests.

- `ingestChannel(params, steps, deps)` performs spec §3 with `steps.do(name, config, fn)`; `IngestWorkflow.run`
  adapts `step.do`. Deps are the transcript source, `lib/ai`, `lib/vectorize`, the Registry stub, `USER_DO`.
- `NonRetryableError` for `UNPLAYABLE`, `PROVIDER_AUTH`, fencing, and no captions; retries and timeouts per spec §3.
- Transcript text never logged; logs carry `{ event, runId, channelId, videoId, step, outcome }`.
- Tests drive `ingestChannel` with an in-process `StepRunner` (runs each step once, records names) and the fakes:
  happy path to `available`; all-no-captions to `NO_TRANSCRIPTS`; a transport failure to `INITIAL_IMPORT_FAILED`;
  delete mid-run → `cancelled` and nothing published; `verify` missing an id → `VECTORIZE_INCOMPLETE`; invalid model
  JSON → `raw_fallback`; auto-follow delivered once and never over an unfollow. If Step 0 showed the pool runs
  Workflows, one test also goes through `env.INGEST_WORKFLOW.create()`.

### Step 7 — Start points and the auto-follow sweep on approval  (size: S)

**Files:** `lib/ingestion.ts`, `routes/channels.ts`, `routes/channel-requests.ts`, tests.

`requestIngestion(env, channelId, reason)` becomes `createRun` + `INGEST_WORKFLOW.create({ id: runId, params })`,
returning the run or `null`. Approval of a request whose channel is already available runs the auto-follow sweep
inline. `GET /catalog` gains `transcripts: { remainingCredits: number | null }` from the DownSub `/status` wrapper,
cached for five minutes per isolate and `null` when the call fails. Route tests assert a run row appears (and only
one) after add, approve, retry, and that the catalog carries the credits field (fake source → null).

### Step 8 — Cron handler  (size: S)

**Files:** `index.ts` (`scheduled`), `lib/ingestion.ts` (`startScheduledRuns(env)`), tests.

Selects available, non-deleted channels without an active run and starts a `scheduled` run for each. Verified
with `wrangler dev --test-scheduled` and `curl "http://127.0.0.1:8787/__scheduled?cron=0+*/6+*+*+*"`.
`triggers.crons` becomes `["0 */6 * * *"]` (owner decision 2026-09-08).

### Step 9 — Walkthrough and docs  (size: S)

`wrangler dev` end to end per spec §7, recorded below; `AGENTS.md` edits from spec §8 not already applied; web:
`lib/copy.ts` phrases for the new codes (`SKIPPED_SHORT`, `LIVE_OR_UPCOMING`, `NON_ENGLISH`, `PROVIDER_*`), the
`NON_ENGLISH` channel phrase, takeaway rendering with `youtu.be/<id>?t=<startSec>` links, and the credits figure on
the catalog health strip; spec and plan status set.

## Walkthrough record

_Filled in at Step 9._
