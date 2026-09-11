# Implementation plan — M3 Ingestion

**Implements:** `docs/specs/m3-ingestion.md` under the rules in `AGENTS.md`, on the channel and episode model of
`docs/specs/channel-simplification.md` (merged 2026-09-10).
**Written:** 2026-09-08, against `main` at `c959cc6`. **Revised:** 2026-09-10 against `main` at `6e075b1`: channels
carry no import outcome, requesters follow when they request, episodes are `pending | available | failed | skipped`
with wait and skip reasons and three technical attempts, and the owner's episode retry and skip routes already exist.
**Revised again:** 2026-09-11 against `main` at `007b3f3`, for the owner's five decisions of that day (spec header):
one Workflow instance per episode with the run row kept, no fence and no `lifecycle_version`, reconciliation at each
cron tick, a handler-computed stagger, Workers Paid. Steps 4, 6, 7, and 8 are rewritten; Steps 1, 2, 3, and 5 are
untouched apart from the digest tiebreak in Step 3.
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
  `TranscriptSegment`, `TranscriptError` with the `TranscriptFailure` union, and `chooseTrack(tracks)` implementing
  the English-first rule over `{ code, auto }` pairs, returning no track when captions exist but none is English
  (`captionStatus: "non_english"`, distinct from `"none"`).
- `vtt.ts`: pure WebVTT/SRT cue parser (the spike's `parseCues`, hardened: tag stripping, `.`/`,` millis, blank
  cues skipped). Tests: fixtures for both formats, hours field, multi-line cues, tags.
- `downsub.ts`: `downsubSource(env, fetchImpl)`; state and HTTP mapping from spec §2; VTT preferred, SRT fallback
  if a track lacks VTT; discards `translatedSubtitles`; reports `duration` and `metadata.isLiveContent` (also on the
  `error` state, where live/upcoming wins over `UNPLAYABLE`) so selection can skip Shorts and wait for streams.
  `remainingCredits(env)` wraps `/status` for the catalog with a two-second timeout. Tests with fixtures taken from
  the probe: found, no_subtitles, error, error-but-live, 401/403/429, malformed body; the probe's VTT for
  `jNQXAC9IVRw` parses to its known 6 cues.
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
- Digest basis: `listDigest` filters and orders by `processed_at` (first availability) with `published_at` as the
  tiebreak, `routes/digest.ts` documents it, `EpisodeItem` shows the availability time separately from publication
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
episodes processed in the same minute keep publication order); summary validation covers the shape, the retry, and
the fallback; the web keeps typecheck and lint only.

**Done when:** `pnpm check` green; `summarizeSection` and `embed` called once each under `wrangler dev` with
`remote: true` against a real transcript, output shape verified, cost noted here.

### Step 4 — Registry write side  (size: L)

**Files:** `do/registry/runs.ts`, `episodes.ts`, `channels.ts`, `types.ts`, `do/registry.ts`, tests. No migration:
the schema after `0002` already holds every column this step writes.

- **Runs.** `createRun(channelId, kind, selection, { ignorePause })` in one transaction: refuses a channel that is
  not `approved`, refuses a paused channel unless `ignorePause` (the first-approval run, an owner episode retry, and
  an on-demand start pass it), and returns `null` when a run is queued or running. Otherwise it upserts the feed
  entries in `selection.entries` as `pending` episodes, inserts the run `running` with `started_at`, inserts one
  run-episode `selected` per selected video, and sets `channels.last_checked_at`. For `kind: "owner_retry"` the
  selection is exactly the one video. Run id is one ULID-style string generated here; `workflow_id` is set to the
  same value, since the instances are named from it and nothing else needs the column.
- **Selection helper.** `selectForRun(channelId, kind, entries)` is a pure function over the channel row, the feed
  entries, and the channel's current episodes: `initial` takes the newest `initial_import_count` entries whatever
  their date; `scheduled` takes untracked entries whose `published_at` is later than `approved_at` plus every
  `pending` episode (waiting, or below three attempts); `owner_retry` takes the given video. Cron passes the same
  entries so a channel is selected consistently.
- **The three instance writes**, each taking `(runId, videoId, ...)`, each beginning with the run gate (the run row
  must be `queued` or `running`, else `INVALID_STATE`), each updating the episode and its run-episode in one
  transaction, and each ending with the close check:
  - `markTranscript(runId, videoId, outcome)` with outcomes `captions` (no change to the episode; the instance
    continues), `waiting(CAPTIONS | LIVE_OR_UPCOMING | PROVIDER_LIMIT)` which sets `transcript_checked_at` and the
    wait reason without counting an attempt and records the run-episode `waiting`, `skipped(SHORT | NON_ENGLISH |
    NO_CAPTIONS | LIVE_OR_UPCOMING | UNPLAYABLE)` with run-episode `skipped`, `technical(code, detail)` which
    increments `attempt_count`, records the reason, keeps `pending` below three and sets `failed` on the third, with
    run-episode `failed`, `deterministic(TRANSCRIPT_TOO_LARGE)` which sets `failed` at once, and
    `accountLevel(PROVIDER_AUTH | PROVIDER_RATE_LIMIT)` which leaves the episode untouched and records the
    run-episode `not_attempted` with the code. The 48-hour rule lives here: a `waiting CAPTIONS` outcome for a video
    published 48 hours ago or more is a `skipped NO_CAPTIONS` outcome, and the caller must have fetched again to
    reach it.
  - `completeEpisode(runId, videoId, { chunkCount, summary, related })` writes the summary row (takeaways as
    `{ text, startSec }[]`, related ids validated against available episodes), sets `available`, `chunk_count`,
    `vectorized_at`, clears any wait reason, sets `processed_at` only if null, and records the run-episode
    `available`.
  - `failEpisode(runId, videoId, code, detail)` for post-transcript technical failures uses the same attempt rule and
    records the run-episode `failed`.
  - **Close check:** when no run-episode of the run is still `selected`, the run becomes `failed` with
    `PROVIDER_LIMIT`, `PROVIDER_AUTH`, or `PROVIDER_RATE_LIMIT` if any run-episode carries one of those codes, else
    `completed`; `finished_at` is set; `channels.last_ingested_at` is set when at least one run-episode is
    `available`. `recordCreateFailure(runId, videoId)` marks a run-episode `failed WORKFLOW_LOST` for a `create()`
    that threw and runs the same close check.
- **Channels.** No new transition. `declineChannel` already stopped bumping anything on 2026-09-11; nothing in this
  step touches channel status, and there is no failure code and no waiting code on channels.
- **Reconciliation helpers.** `listOpenRunEpisodes(olderThanMs)` returns `(runId, videoId)` pairs still `selected`
  on runs created before the cutoff; `closeLostRunEpisode(runId, videoId)` marks the pair `failed WORKFLOW_LOST`,
  leaves the episode's attempt count alone, and runs the close check. Step 8 drives them.
- **Plan decision:** instance ids are `${runId}.${videoId}`, computed and never stored, so reconciliation can name
  every instance from the run-episode row alone.

**Tests:** extend `registry-runs`, `registry-episodes`, `registry-channels`: one active run per channel; `createRun`
refuses declined, requested, and paused channels and honours `ignorePause`; `selectForRun` takes the newest N for
`initial`, only entries published after `approved_at` for `scheduled`, every pending episode including ones no longer
in the feed, and never a skipped or failed one; the run gate rejects a write against a completed or failed run;
`completeEpisode` sets `processed_at` once and never on retry; `markTranscript` waiting outcomes count no attempt,
technical outcomes count one and flip to `failed` on the third, account-level outcomes count none and leave the
episode `pending` with no wait reason, skipped outcomes carry their reason; the close check derives `completed`,
`failed PROVIDER_LIMIT`, and `failed PROVIDER_AUTH` from the run-episodes and sets `last_ingested_at` only when
something became available; the 48-hour boundary exactly; declining an approved channel mid-run changes no run or
episode row, and the run's later writes still succeed; the channel row's status never changes because of a run.

### Step 5 — Bindings  (size: S)

**Files:** `wrangler.jsonc`, `bindings.d.ts`, `vitest.config.ts`. `ai` and `vectorize` with `remote: true`,
`workflows` with `IngestWorkflow`, cron placeholder comment. Verified by `wrangler dev` starting and `pnpm check`
passing (Step 0's finding decides whether tests see these bindings).

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
- `NonRetryableError` for `UNPLAYABLE`, `no_subtitles`, `PROVIDER_AUTH`, `PROVIDER_LIMIT`, `TRANSCRIPT_TOO_LARGE`,
  and a refused Registry write. Step retries and timeouts per spec §3. The episode's `attempt_count` is the
  cross-run retry; step retries are within one instance.
- The body of `run` wraps everything after `classify` in a try/catch: when a step gives up after its retries, the
  instance calls `failEpisode` with the step's code (`VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`,
  `AI_SUMMARY_FAILED`) and ends. A refused write, meaning the run was closed under it, is logged and swallowed.
- Transcript text never logged; logs carry `{ event, runId, channelId, videoId, step, outcome }`.
- Tests drive `ingestEpisode` with an in-process `StepRunner` (runs each step once, records names, skips sleeps) and
  the fakes: happy path to `available` with `processed_at` set and the run closing `completed` when it was the last
  selected row; fresh no-captions to `pending CAPTIONS` and, with the clock moved 48 hours, a second fetch to
  `skipped NO_CAPTIONS`; a short video to `skipped SHORT`; non-English to `skipped NON_ENGLISH`; a transport failure
  to `pending` with one attempt, then `failed` on the third run; a 401 to `pending` with no attempt and run-episode
  `not_attempted PROVIDER_AUTH`; `verify` missing an id past its retries → `VECTORIZE_INCOMPLETE` attempt, and an id
  that appears on the second try → no attempt; invalid model JSON → `raw_fallback`; related-query failure →
  published summary with `[]`; a 403 → `pending PROVIDER_LIMIT` and the run closing `failed PROVIDER_LIMIT`; a
  write against a run that reconciliation closed → refused, instance exits, nothing changes. If Step 0 showed the
  pool runs Workflows, one test also goes through `env.INGEST_WORKFLOW.create()`.

### Step 7 — The start handler  (size: M)

**Files:** `lib/ingestion.ts`, `routes/channels.ts`, `routes/catalog.ts`, `lib/youtube/rss.ts` (the feed fake grows
entries), `vitest.config.ts`, `packages/shared/src/index.ts`, tests.

- `startRun(env, channelId, kind, { ignorePause, videoId?, stagger })` replaces the log-only `requestIngestion`:
  fetch the feed with `feedFetcher(env)`, compute the selection, call `registry.createRun`, then for each selected
  video call `INGEST_WORKFLOW.create({ id: `${runId}.${videoId}`, params })` with `startDelaySec` taken from the
  `stagger` counter (`k × 3` across everything created in this invocation); a `create()` that throws is recorded at
  once with `registry.recordCreateFailure`. Returns the run or `null` when one was already open. A feed that cannot
  be fetched logs `{ event: "ingestion.feed_unavailable", channelId }` and returns `null`; the caller's own
  response is unaffected.
- Callers: `POST /channels` (owner add) and `POST /channels/:id/approve` on first approval, `kind: "initial"`,
  `ignorePause`, after the approval has committed, so approval never fails because YouTube did not answer;
  `POST /channels/:id/episodes/:videoId/retry`, `kind: "owner_retry"`, the one video, `ignorePause`.
- **Plan decision:** add `POST /channels/:id/runs` (owner; `approved`; 409 while a run is open) creating a
  `scheduled`-kind run now, ignoring pause, and returning `{ run }`. It is the Start action for a never-started
  channel and the owner's nudge after a credit refill or a run that closed `failed`. Shared
  `IngestionRunResponse { run: IngestionRun }`.
- `GET /catalog` gains `transcripts: { remainingCredits: number | null }` from the DownSub `/status` wrapper, cached
  for five minutes per isolate, two-second timeout, and `null` when the call fails, times out, or the fake source is
  in use. The response never fails because of it.
- `YOUTUBE_FEEDS_FAKE` accepts `channelId → { title, entries: { videoId, title, publishedAt }[] }` beside the
  existing string form, so route tests can seed a feed with a Short, a fresh upload, and an old entry.
- Route tests assert exactly one run row with the right run-episodes after first approval, after
  `POST /channels/:id/runs`, and after an episode retry (one run-episode, that video); none after re-approval of a
  previously approved channel; 409 for a second start while one is open; the catalog carries credits (`null` with the
  fake); the first-approval run is created while the channel is system-paused; an approve whose feed fetch fails
  still approves and leaves the channel never-started; instances created in one call carry delays 0, 3, 6, … s.

### Step 8 — Cron handler and reconciliation  (size: M)

**Files:** `index.ts` (the default export becomes `{ fetch: app.fetch, scheduled }`), `lib/ingestion.ts`
(`runScheduledTick(env)`, `reconcileRuns(env)`), tests.

Order inside one tick: reconcile, check credits, select channels, start runs.

- `reconcileRuns(env)`: for every `(runId, videoId)` from `listOpenRunEpisodes(now − 1 h)`, ask
  `env.INGEST_WORKFLOW.get(`${runId}.${videoId}`).status()`. Running, queued, paused, or sleeping → leave it. Complete,
  errored, terminated, or not found → `closeLostRunEpisode`. Logs `{ event: "ingestion.reconciled", runId, videoId,
  status }`.
- Credits: `remainingCredits(env)`; when it is `0`, log `{ event: "ingestion.tick_skipped", reason: "no_credits" }`
  and start nothing. `null` (unknown) does not block.
- Selection: channels with `status = 'approved'`, `paused_by IS NULL`, and no open run; for each, `startRun(env,
  channelId, "scheduled", { stagger })` with one stagger counter shared across the whole tick. Selection inside
  `startRun` resumes persisted `pending` work (waiting and attempts below three, including episodes no longer in
  the feed) and never touches `skipped` or `failed` episodes.
- Verified with `wrangler dev --test-scheduled` and `curl "http://127.0.0.1:8787/__scheduled?cron=0+*/6+*+*+*"`.
  `triggers.crons` becomes `["0 */6 * * *"]` (owner decision 2026-09-08).

**Tests:** a seeded open run older than an hour whose instance the fake Workflow binding reports as errored closes
`failed WORKFLOW_LOST` with the episode's attempt count unchanged; a run younger than an hour is left alone; a
running instance is left alone; the tick skips paused channels and channels with an open run; with the credits
wrapper returning `0` nothing starts; delays increase across channels within one tick.

### Step 9 — Owner and reader touches, walkthrough, docs  (size: M)

- Web: **Start** on never-started rows and on approved rows whose latest run is `failed` in `AttentionList` and the
  catalog table, calling `POST /channels/:id/runs`; the credits figure on the catalog health strip; the digest's
  three empty states and its availability-time label (spec §2, AGENTS.md Screens); takeaway timestamp links; owner
  phrases for the technical codes in `copy.ts`. `apps/web` stays typecheck and lint only.
- `wrangler dev` end to end per spec §7, recorded below: first approval with no followers starts the import while
  paused → a follow resumes scheduling → captioned video `available`, fresh captionless `pending CAPTIONS`, short
  `skipped SHORT` → a forced transport failure counts an attempt → decline mid-run changes nothing and the run
  closes `completed` with its summaries hidden → re-approve shows them and starts nothing → `/__scheduled` starts
  staggered runs → credits shown on the catalog.
- PRD §4.2 and §4.4 wording for the digest basis; spec and plan status set for work actually completed.

## Walkthrough record

_Filled in at Step 9._
