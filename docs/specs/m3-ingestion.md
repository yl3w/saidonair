# Feature spec — M3 Ingestion

**Written:** 2026-09-08, against `main` at `c959cc6`.
**Revised:** 2026-09-10, twice. First after the owner walkthrough: caption and credit waits resume automatically,
summaries publish without a review gate, digest windows use first availability, related episodes are optional
enrichment, and the transcript source reports caption status. Then against `docs/specs/channel-simplification.md`
§12 after that spec merged to `main` at `6e075b1`: channels no longer carry import outcomes, so this document now
describes an episode-level machine.
**Revised again:** 2026-09-11, against `main` at `007b3f3`, after the owner reviewed this spec against the merged
code. Five decisions, taken one at a time: the unit of execution is one Workflow instance per episode while the
Registry keeps one run row per channel (§2 "Unit of execution"); the lifecycle fence is dropped and
`lifecycle_version` leaves the schema through migration `0002` (§2 "Decline mid-run"); lost instances reconcile at
each cron tick with a one-hour grace and no age window on "never started" (§2 "Reconciliation"); a cron tick staggers
its instances and a rate limit never counts as an attempt (§2 "Launch throttle"); Workers Paid is confirmed. The
review's findings are folded in where they belong: what a new feed entry is, how the owner-retry run knows its
episode, account-level provider failures, the verify step and Vectorize's asynchronous writes, the related-episode
method, and the smaller items in §2. Nothing here is a claim that the implementation is complete.
**Status:** proposed; starts on the owner's go. Implements PRD §10 M3 (shared runs and episodes, RSS, transcripts,
chunking, embeddings) plus the summary step that makes an episode `available`.
Plan: `docs/specs/m3-ingestion-plan.md`.
**Owner decisions already made:** transcripts come from DownSub's API (2026-09-08); cron every 6 hours; captionless
fresh uploads are re-checked for 48 hours; videos under 3 minutes are skipped and live or upcoming ones wait;
non-English captions are skipped; takeaways carry timestamps; DownSub credit exhaustion is a wait, not an attempt
(2026-09-08). Technical episode failures are retried on three runs before they reach the owner; a channel nobody
follows is paused, and the one run first approval starts ignores that pause; there is no channel-level failure,
retry, or waiting code; readers see an episode's skip reason (2026-09-10). One Workflow instance per episode with the
run row kept; no fence, `lifecycle_version` removed; reconciliation at each cron tick; handler-computed stagger;
Workers Paid (2026-09-11).
An InnerTube fetcher was built and measured first: it passes from a residential IP and is bot-checked from
Cloudflare's egress in every client tested (30 player calls: 21 `LOGIN_REQUIRED`, 4 hard 403s, 5 OKs on one video).
It was removed rather than kept as a path production never runs; the code survives only on the throwaway branch
`spike/transcript-remote`.

## 1. Summary

Approved channels start producing digest content. The first approval of a channel, an owner's retry of one episode,
an owner's on-demand start, or the six-hourly cron creates one ingestion run per channel in the Registry. The code
that creates the run is an ordinary Worker handler, not a Workflow: it reads the RSS feed, decides which episodes
the run will attempt, writes the run and that selection in one Registry transaction, and then creates one Workflow
instance per selected episode. Each instance fetches its episode's transcript, chunks it, embeds and upserts the
chunks into Vectorize under `shared-catalog`, verifies they are retrievable, generates the shared summary, and only
then marks the episode `available`. Episodes that cannot be summarised for a deterministic reason are `skipped` with
that reason; episodes waiting on captions, a live stream, or transcript credits stay `pending` with a wait reason;
technical failures are reattempted on the next runs and become `failed` for the owner on the third. Every instance
ends with one Registry write that records its run-episode outcome, and the Registry closes the run when no
run-episode is still `selected`. The channel's own status never changes because of a run: `requested | approved |
declined` is the owner's answer, and pause is the only run-related flag it carries. Declining a channel does not stop
a run in flight; the run finishes, and eligibility hides what it produced until the channel is approved again.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Unit of execution | **One Workflow instance per episode; one run row per channel** (owner decision 2026-09-11). The handler that starts a run fetches the feed, selects the episodes, and writes `createRun` + `upsertFromFeed` + `recordSelection` in one Registry transaction, then creates an instance per selected episode with id `${runId}.${videoId}` and params `{ runId, videoId, channelId, startDelaySec }`. An instance never fetches the feed, never selects, and never touches channel status. It can make exactly three Registry writes: `markTranscript`, `completeEpisode`, `failEpisode`, each of which updates the episode and its run-episode row together and closes the run when that row was the last one still `selected`. | A lost or stuck instance blocks one episode, not a channel. Episodes process in parallel, so an initial import finishes in the time of one episode. The Workflow is only the pipeline. The run row keeps `ingestion_runs`, the owner's runs screen, `latestRun`, `neverStarted`, and the one-active-run rule exactly as they are, with no migration for this decision. The pure per-episode form would have dropped the one-active-run index and re-pointed those screens for no extra benefit. |
| Where transcripts come from | **DownSub, behind one contract.** `TranscriptSource.fetch(videoId)` returns a `TranscriptResult`: segments when an English track exists, `durationSec`, `isLive` (live or upcoming), and `captionStatus` of `english`, `none`, or `non_english`; or it throws a `TranscriptError` for a provider failure. Tests select a canned fake with the test-only `TRANSCRIPTS_FAKE` binding; everything else uses the DownSub adapter. | The source is the thing most likely to change again. Ingestion must not know which one is in use, and a replacement is one file behind the seam. |
| DownSub specifics | `GET https://api.downsub.com/download?url=<watch URL>` with the `DOWNSUB_API_KEY` secret. `state` `subtitles_found` → pick a track and fetch its **VTT**; `no_subtitles` → `captionStatus: "none"`; `error` → `TranscriptError("UNPLAYABLE", playabilityReason)` unless the body's live/upcoming metadata says the video is waiting, in which case a result with `isLive: true` is returned for classification. HTTP 401 → `PROVIDER_AUTH`, 403 → `PROVIDER_LIMIT`, 429 → `PROVIDER_RATE_LIMIT`, other non-2xx → `PROVIDER_HTTP`, unparsable → `PROVIDER_PARSE`. | Verified 2026-09-08 with a trial key: synchronous, ~0.8 s when captions exist, 1 credit per video that has or lacks captions, 0 for errors and file downloads, fresh uploads (1–2 h old) served. Error states are slow (17–57 s), so the step timeout is generous. |
| Track choice | English-first: a manual `en`/`en-*` track, else `en_auto`/`en-*_auto`; if tracks exist but none is English, return `captionStatus: "non_english"` without downloading anything. The DownSub `code` field decides; labels are unreliable ("undefined (auto-generated)" appears). | Summaries and chat are English; an English auto-caption beats a human caption in another language. There is no non-English or translation fallback. |
| Transcript size ceiling | The transcript step serialises at most 700 KB of segments. A transcript over that ceiling is a deterministic technical failure `TRANSCRIPT_TOO_LARGE`: `markTranscript` records it as `failed` at once, skipping the three-attempt ladder, so it costs one credit and reaches the owner, who can Skip it. | Workflows cap a step result at 1 MiB. Segments for eight hours of speech are roughly that size; the ceiling keeps a multi-day stream from failing on the platform limit after retries. |
| Summary in M3 | **Yes.** `available` requires a stored summary (PRD §4.2, the `episodes` CHECK), so the summarize step is in this milestone. M4 keeps chats, retrieval, citations, and preferences. | Without it no episode could ever be `available` and the digest would stay empty after M3. |
| Publishing without a gate | Summaries publish automatically after JSON validation, one retry, and the raw-text fallback. No manual approval, no quality review. | Owner decision 2026-09-10. A personal tool with a trusted audience; the owner retries an episode if a summary is poor. |
| Related episodes | Optional enrichment. Each embedding step returns, beside its vectors, the running sum of those vectors and their count; the related step averages the sums into the episode's centroid, queries `shared-catalog` with it, excludes the episode's own `videoId`, deduplicates to at most five `available` videos, and stores the ids in `related_video_ids_json`. A failed lookup or no qualifying result stores `[]` and publication proceeds. | Related suggestions must never prevent delivery of the summary. The sum is 768 numbers, so the centroid needs no vector to outlive its upsert step. Display filters titles to the reader's eligible channels and omits an empty section. Owner decision 2026-09-10. |
| Which channels a run touches | Scheduled runs: `status = 'approved'`, `paused_by IS NULL`, no queued or running run. The first-approval run, an owner's episode retry, and an owner's on-demand start ignore `paused_by`. Declined channels are excluded by status; there is no channel failure state to exclude. | `channel-simplification.md` §3.4. Follower count reaches selection only through pause, so a channel nobody follows costs nothing after its initial import. |
| Which episodes a run attempts | First approval: the newest `initial_import_count` feed entries, whatever their publication date. Scheduled and on-demand: **new** feed entries plus every `pending` episode, waiting ones and those below three technical attempts, including selected episodes that have left the feed. A feed entry is new when it is not yet tracked **and** its `published_at` is later than the channel's `approved_at`. Episode retry: exactly the one episode; `createRun` for an `owner_retry` run inserts that episode as the run's only run-episode, so the instance is told which video it owns. Skipped episodes are never re-bought by cron. | PRD §4.2 and `channel-simplification.md` §3.3. The feed carries about fifteen entries and the initial import takes five; without the publication rule the first cron after approval would import the other ten, turning `initial_import_count` into a delay rather than a cap at one credit per video. |
| Fresh uploads without captions | A "no captions" answer for a video published **within the last 48 hours** leaves the episode `pending` with `waiting_code = CAPTIONS` and `transcript_checked_at` set, no attempt counted; each scheduled run re-checks it. At or after 48 hours the video is fetched again, and only another no-caption answer makes it `skipped NO_CAPTIONS`. | YouTube's auto-captions lag an upload by hours; the freshest videos are the point of a digest. Elapsed time alone does not prove captions are absent. Owner decisions 2026-09-08 and 2026-09-10. |
| Shorts, live streams, premieres | Under **180 seconds** → `skipped SHORT`, nothing stored. Live or upcoming → `pending` with `waiting_code = LIVE_OR_UPCOMING`, re-checked like a fresh upload; still live at or after 48 hours → `skipped LIVE_OR_UPCOMING`. Known live metadata wins over an `UNPLAYABLE` answer. `UNPLAYABLE` otherwise → `skipped UNPLAYABLE`. | Shorts clutter a digest; streams cannot be summarised until they end. The feed carries no duration, so the DownSub call is made first and costs its credit; accepted. Owner decision. |
| Non-English videos | `captionStatus: "non_english"` → `skipped NON_ENGLISH`. There is no channel-level consequence: a channel whose videos are all non-English is an approved channel with `episodes.available = 0`, which the owner can pause or decline. | Summaries, embeddings, and chat are English. Owner decision 2026-09-08; the channel code it once implied was removed on 2026-09-10 with every other channel failure code. |
| Episode-level technical failures | `PROVIDER_HTTP`, `PROVIDER_PARSE`, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED` increment `attempt_count` and record `failure_code`. Below three the episode stays `pending` and the next scheduled run reattempts it; the third attempt makes it `failed`. Waiting never counts as an attempt. `TRANSCRIPT_TOO_LARGE` is deterministic and goes to `failed` at once. | Owner decision 2026-09-10: transient provider errors clear themselves, at no credit cost, and only a persistent failure reaches the owner. |
| Account-level provider failures | `PROVIDER_AUTH` (401) and `PROVIDER_RATE_LIMIT` (429 still standing after the step's own retries) are facts about the account, not the video. The instance ends without counting an attempt: the episode stays `pending` with no wait reason, and its run-episode is `not_attempted` with that code. `PROVIDER_LIMIT` (403, credits) is a wait: `pending` with `waiting_code = PROVIDER_LIMIT`, run-episode `waiting`, no attempt. A run whose run-episodes carry any of these three codes closes as `failed` with that code so the owner sees what to fix; otherwise a run closes `completed`. Before launching, the cron handler reads DownSub's `/status` and launches nothing while `remainingCredits` is zero. | A wrong key or a busy minute must not march every episode to `failed` over three cron cycles. Errors and `/status` cost no credits. Owner decision 2026-09-11, with the rate-limit rule. |
| Owner episode actions | `POST /channels/:id/episodes/:videoId/retry` (`failed` or `skipped` → `pending`, attempts and skip fields cleared, one-episode `owner_retry` run) and `…/skip` (`failed` → `skipped OWNER`), both requiring an approved channel with no active run. Implemented on 2026-09-10; M3 makes the retry actually start a run. | `channel-simplification.md` §3.3. The only retry there is; siblings and their summaries are untouched. |
| Takeaways carry timestamps | Each takeaway is `{ text, startSec }`, `startSec` null when the model gives none or it falls outside the episode. The prompt sends `[h:mm:ss]` markers and asks for one per takeaway; `mm:ss` is accepted for episodes under an hour. `EpisodeSummary.takeaways` in `packages/shared` changes from `string[]`; the web renders a `youtu.be/<id>?t=<s>` link per takeaway. No legacy data exists, so no normalisation of string takeaways is needed. | The digest's most useful click is "take me to that moment". Owner decision 2026-09-08; the legacy rule of 2026-09-10 became moot with the pre-production reset. |
| Digest basis | Digest selection and ordering use the episode's first `processed_at`, exposed as `summaryAvailableAt`: 24 hours by default, seven days when expanded, ordered by `processed_at` descending with `published_at` descending as the tiebreak. Reads, refollows, re-approval, and enrichment never reset it; channel history stays publication-ordered. | Owner decision 2026-09-10. A video published a month ago but summarised today belongs in today's digest. An initial import publishes several episodes within minutes, and the tiebreak keeps them in publication order rather than processing order. |
| Channel timestamps | `last_checked_at` is set when a run is created, since that is when the feed was read. `last_ingested_at` is set when a run closes with at least one `available` run-episode. | `GET /follows` sorts by most recent ingestion and the catalog shows "Last ingested"; both need one meaning. |
| Step granularity | One `step.do` per external call inside an instance: the stagger sleep, transcript, each embedding batch, each upsert batch, retrieval verification, each summary map and reduce call, the related query, and each Registry write. Steps return bounded serialisable values; vectors pass from an embedding step to its upsert step and no further, apart from the running sum for the centroid. | AGENTS.md → Ingestion pipeline. Workflows cap a step result at 1 MiB and retry per step. |
| Verify step | After the last upsert, `getByIds` is called in batches of the API's per-call ceiling until every expected id is present. The step's own retry policy (three retries, exponential backoff from five seconds) absorbs Vectorize's asynchronous processing; only after those retries does a missing id count as `VECTORIZE_INCOMPLETE`. | Vectorize applies an upsert asynchronously and returns a mutation id; an immediate read can miss vectors that are on their way. Counting that as an attempt would burn the episode's three chances on timing. PRD §6 still holds: `available` is never set on an accepted upsert alone. |
| Decline mid-run | **Nothing is fenced** (owner decision 2026-09-11, reversing 2026-09-10). Declining a channel is a status change; a run in flight finishes, its episodes are stored as they would have been, and eligibility hides them until the channel is approved again. `lifecycle_version` leaves `channels` and `ingestion_runs` through migration `0002_drop_lifecycle_version.sql`; there is no `cancelled` run in this design. | The fence guarded the earlier model, in which runs wrote channel state and channels could be deleted and restored. Runs now write only episodes, summaries, and two timestamps, none of which is about the approval, and a declined channel keeps everything it produced anyway. Pause already lets a running run finish. The cost of a run outliving a decline is a few credits, bounded by the run's selection. |
| Run gate | An instance's write is accepted only while its run is `queued` or `running`; otherwise the Registry answers `INVALID_STATE` and the instance exits. | Reconciliation can close a run whose instance turns out to be alive, and cron may then start a new run on the same episodes. The gate keeps the stale instance from double-counting an attempt or overwriting the new run's outcome. It is one primary-key lookup and has nothing to do with decline. |
| Publishing | An episode is `available` only after `getByIds` returns every expected vector and the summary row exists, in one Registry write that also sets `processed_at` once and records the run-episode as `available`. | PRD §6: never publish on an accepted asynchronous upsert. |
| Cron | **Every 6 hours**, `0 */6 * * *` UTC, in `triggers.crons`. The `scheduled` handler reconciles, then selects channels, then per channel fetches the feed, selects episodes, writes the run, and creates the instances. It is exercised with `wrangler dev --test-scheduled`. | Owner decision 2026-09-08. A 24-hour digest window reads better when items trickle in than in one daily burst. |
| Launch throttle | The handler numbers the instances it creates during one tick, across every channel, and passes `startDelaySec = k × 3` to the k-th; the instance's first step sleeps that long. A 429 during the transcript step is retried by the step with backoff and never counts as an episode attempt (see account-level failures). | Owner decision 2026-09-11. One tick can start dozens of instances at once; the channel-run model spread them out for free by running episodes sequentially, and the hybrid must spread them deliberately. No new binding. |
| Reconciliation | **At each cron tick, before selection** (owner decision 2026-09-11). The handler records a failed `create()` immediately as a run-episode `failed WORKFLOW_LOST`, and an instance whose step gives up after its retries catches the error and writes `failEpisode` itself, so the sweep is a safety net. The sweep examines runs older than one hour: for each run-episode still `selected` it computes the instance id `${runId}.${videoId}` and asks Workflows for its status. Running, queued, or sleeping instances are left alone; complete, errored, terminated, or missing ones become run-episode `failed WORKFLOW_LOST` with the episode's attempt count untouched, and the run closes when no row is left `selected`. "Approved, never started" means approved with no run row and gets no age window: in this design it arises only when the approve request's feed fetch or run creation failed, and the Start button is the remedy. | Without it a lost instance would hold the channel's one active-run slot forever, so cron would skip the channel and Retry and Skip would answer 409. The two ledgers, SQLite and Workflows, cannot be updated in one transaction. |
| On-demand start | `POST /channels/:id/runs` (owner, `approved`, no active run) creates a `scheduled`-kind run now, ignoring pause. It is what the Needs-attention Start button calls for a never-started channel and the owner's nudge after a credit refill or a run that closed `failed`. The `scheduled` kind is reused because the `kind` CHECK is frozen; the runs screen therefore cannot tell a manual start from cron, which is accepted. | `channel-simplification.md` §3.4 asks for a Start action once a route exists. |
| Long episodes | **Map-reduce over 45-minute sections.** Each section is summarised with its own timestamped takeaways; one final call condenses the section summaries into the episode's summary. An episode with a single section skips the reduce step, so short videos cost one call. | Owner decision 2026-09-08. The model reads 24,000 tokens per call, about 1 h 45 min of speech; sampling would leave long-episode takeaways pointing only at sampled minutes. Cents per long episode. |
| Catalog credits | `GET /catalog` gains `transcripts: { remainingCredits }` from DownSub's `/status`, fetched at most once every five minutes per isolate with a two-second timeout; `null` when the call fails, times out, or the fake source is in use. The catalog response never fails because of it. | The owner sees the balance where the other health numbers are, and Home never waits on a third party. Owner decision 2026-09-08 for the field; the timeout is from the 2026-09-11 review. |
| Workers plan | **Workers Paid**, confirmed 2026-09-11. | Workflows on the free plan allow 10 ms CPU per step and few concurrent instances; parsing a 400 KB DownSub body, chunking an hour of speech, and the sleeping stagger instances all need Paid. |
| Embedding model id | `@cf/baai/bge-base-en-v1.5`, 768 dimensions. | The deployed model id carries `.5` (it is also Vectorize's preset name). |

## 3. Pipeline

```
start point (approve · cron · Start · retry) ──► Worker handler, not a Workflow
   reconcile (cron only)   close run-episodes whose instance is gone; close runs with nothing left selected
   credits (cron only)     DownSub /status; launch nothing while remainingCredits = 0
   fetch-feed              rss.fetchChannelFeed(channelId); failure → no run, logged, channel reads "never started"
   select                  initial: newest N · scheduled/Start: new entries + every pending · retry: the one episode
   write                   Registry.createRun + upsertFromFeed + recordSelection, one transaction, run `running`,
                           last_checked_at set, run-episodes `selected`
   fan out                 INGEST_WORKFLOW.create({ id: `${runId}.${videoId}`, params: { runId, videoId, channelId,
                           startDelaySec: k × 3 } }) per selected episode; a create() that throws → run-episode
                           failed WORKFLOW_LOST at once

one instance per episode:
   stagger        step.sleep(startDelaySec)
   transcript     source.fetch(videoId)                    → TranscriptResult | TranscriptError
   classify       Registry.markTranscript(runId, videoId, outcome)
                    english captions → continue; waiting (fresh no-captions, live, credits) → pending + waiting_code,
                    run-episode waiting; short / non-English / no captions ≥ 48 h / live ≥ 48 h / unplayable →
                    skipped + reason, run-episode skipped; episode-level technical → attempt +1, pending below three,
                    failed on the third, run-episode failed; account-level (AUTH, RATE_LIMIT) → pending, no attempt,
                    run-episode not_attempted; anything but "continue" ends the instance here
   embed[i]       ai.embed(chunk texts, batch of ≤ 20)     → vectors + running sum (vectors stay in this step)
   upsert[i]      vectors.upsert(ns, ids, vectors, metadata)
   verify         vectors.getByIds(ns, ids) in batches until every id is present; step retries absorb the async lag
   summarize[s]   ai.summarize(section s) per ≤45-minute section       (invalid JSON: one retry, then fallback)
   reduce         ai.reduce(section summaries) when there is more than one section
   related        centroid query, exclude own videoId → up to 5 distinct available videos; failure → []
   publish        Registry.completeEpisode(runId, videoId, { chunkCount, summary, related }) → available,
                  processed_at set once, run-episode available
   on any step giving up after its retries: Registry.failEpisode(runId, videoId, code, detail)

Registry, inside each of the three writes: refuse unless the run is queued or running; update the episode and its
run-episode; if no run-episode is still `selected`, close the run (`failed` with an account-level code if any
run-episode carries one, else `completed`), and set channels.last_ingested_at when at least one became available.
```

Retry policy per step: transport failures retry 3 times with exponential backoff from 10 seconds; `UNPLAYABLE`,
`no_subtitles`, `PROVIDER_AUTH`, `PROVIDER_LIMIT`, and a refused Registry write are non-retryable inside the run (the
episode's own attempt count is the cross-run retry). Transcript step timeout 2 minutes (DownSub's error paths take up
to a minute). AI steps timeout 3 minutes. The verify step retries 3 times from 5 seconds before a missing id counts.

There is no approval path in this pipeline. Requesters follow a channel at the moment they request it
(`channel-simplification.md` §3.2), so nothing is handed off when it becomes readable.

### 3.1 Chunking (`lib/chunk.ts`, pure)

The hybrid strategy from AGENTS.md: group consecutive segments to about 60 seconds; split a group on segment
boundaries when it exceeds ~400 tokens (`chars / 4`); overlap consecutive chunks by one or two segments; never emit
more than 480 tokens; a single segment over the cap is split on sentence, then word boundaries. Output:
`{ index, text, startSec, endSec }[]`. Vector id `${videoId}:${index}`; metadata
`{ videoId, channelId, channelTitle, title, startSec, endSec, text, publishedAt }` with `channelId` and `videoId`
always present.

### 3.2 Summary (`prompts/summary.ts`, `lib/ai.ts`)

Model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON output requested, validated against
`{ executiveSummary: string (≤ 3 sentences), takeaways: { text: string, at: "h:mm:ss" | "mm:ss" | null }[3..5], topicTags: string[1..8] }`,
with `at` mapped to `startSec` against the episode's duration (null when absent or out of range). On invalid output
retry once with a stricter instruction; on a second failure store `raw_fallback` with the model's text. Long
episodes: the transcript is split into sections of at most 45 minutes on chunk boundaries; each section gets a
"map" call producing the same shape with timestamps; when there is more than one section a "reduce" call condenses
the section summaries into the final shape, keeping each takeaway's timestamp. Every call is its own Workflow step.
The model has no JSON mode, so the JSON is requested in the prompt and validated. Prompt text is in the plan for
approval; `prompt_version` is stored with each summary, and changing the prompt bumps it. Publication follows
validation directly: there is no review gate.

### 3.3 Episode outcomes

Every outcome lands on the episode row (`channel-simplification.md` §3.3, §6.1). Channels carry none of them.

| Outcome | Column | Values | Owner action |
|---|---|---|---|
| Waiting | `status = 'pending'`, `waiting_code` | `CAPTIONS` (no captions, video under 48 h old), `LIVE_OR_UPCOMING` (still live, under 48 h), `PROVIDER_LIMIT` (credits exhausted) | None; the next cron re-checks |
| Skipped | `status = 'skipped'`, `skip_reason`, `skipped_at` | `SHORT` (under 180 s), `NON_ENGLISH`, `NO_CAPTIONS` (re-fetched at or after 48 h), `LIVE_OR_UPCOMING` (at or after 48 h), `UNPLAYABLE`; `OWNER` with `skipped_by_email` when the owner skips | Retry reopens it |
| Technical attempt | `status = 'pending'`, `attempt_count` 1–2, `failure_code`, `failure_detail` | `PROVIDER_HTTP`, `PROVIDER_PARSE`, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED` | None; the next cron reattempts |
| Account-level stop | `status = 'pending'`, no wait reason, attempt count unchanged | run-episode `not_attempted` with `PROVIDER_AUTH` or `PROVIDER_RATE_LIMIT` | Fix the key or wait; the next cron reattempts |
| Failed | `status = 'failed'`, `attempt_count = 3`, `failure_code` | the same technical codes; `TRANSCRIPT_TOO_LARGE` arrives here directly | Retry or Skip (Needs attention) |
| Available | `status = 'available'`, `chunk_count`, `vectorized_at`, `processed_at` | | |
| Run | `ingestion_runs.status`, `failure_code` | `completed`; `failed` with `PROVIDER_LIMIT`, `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, or `WORKFLOW_LOST` (reconciled) | None; runs are history. Start when the cause is fixed |
| Run episode | `ingestion_run_episodes.status` | `selected`, `available`, `failed`, `skipped`, `waiting`, `not_attempted` | |

A feed that cannot be fetched creates no run: the handler logs `{ event: "ingestion.feed_unavailable", channelId }`
and the channel reads "never started" if it has no earlier run. The `cancelled` run status exists in the frozen
CHECK constraint and is not written by this design.

Readers see `status` and a top-level `skipReason` on every episode; `waitingCode`, attempts, and technical codes are
in the owner's `processing` block. `apps/web/src/lib/copy.ts` already carries the phrases for every value above
except the technical codes, which the owner sees raw.

### 3.4 Waiting, failure, and recovery

| Situation | Episode and channel behaviour | Next action |
|---|---|---|
| Fresh video without captions, or live/upcoming, under 48 h | Episode `pending` with the wait reason, no attempt counted; the channel is unchanged | Next six-hour cron re-checks the persisted selection, even if the video has left the feed |
| Same, at or after 48 h | Fetched once more; a fresh no-caption or still-live answer makes it `skipped` with the matching reason | Owner Retry if captions appear later |
| Credits exhausted | Each instance that meets the 403 leaves its episode `pending PROVIDER_LIMIT`, no attempt counted; the run closes `failed PROVIDER_LIMIT` | Cron checks `/status` first and launches nothing until credits exist; then it resumes them |
| Bad key, or rate-limited after the step's retries | The instance ends without an attempt; run-episode `not_attempted` with the code; the run closes `failed` with it | Fix the key; the next cron reattempts. A 429 clears itself |
| Technical error, attempts 1–2 | Episode stays `pending`, reason recorded | Next cron reattempts it |
| Technical error, third attempt | Episode `failed` | Owner Retry or Skip; other episodes and the channel are unaffected |
| First approval with no followers | The channel is system-paused at approval, and the initial import still runs once | Scheduled runs wait for a follower |
| Owner declines an approved channel mid-run | Nothing stops. The run finishes and publishes as usual; eligibility hides the channel's summaries from digest, channel history, and chat while it is declined | Re-approval restores access to everything, including what landed after the decline, and starts no new import |
| An instance never starts, or dies after its step retries | A `create()` that throws is recorded at once; an instance that catches its own step exhaustion writes `failEpisode`; anything else is found by the sweep at the next tick and closed `failed WORKFLOW_LOST`, attempt counts untouched | Next cron reattempts; Start if the owner is in a hurry |
| The approve request's feed fetch fails | The channel is approved with no run row and reads "approved, never started" | Start, or the next cron, unless the channel is paused for having no followers, in which case Start |
| Related lookup fails | Summary publishes with `[]` | None |

Precedence within one instance: a wait, a skip, or an account-level stop ends the instance at the classify step; a
run with only waiting episodes completes normally and records them as `waiting`; the channel-level count of waiting
episodes (`episodes.waiting`) is what readers and the owner see, never a channel waiting code.

### 3.5 Selection contract

The adapter and the fake both return the full `TranscriptResult`: duration, live/upcoming flag, and `captionStatus`,
with English segments when present. Known live/upcoming state is classified before duration and caption checks,
including provider `error` bodies carrying that state; other errors throw. For non-live results: known duration
below 180 seconds skips, non-English captions skip, no captions follow the 48-hour rule, and English captions
process. Unknown duration must not imply a short video; use the transcript's end for timestamp bounds when possible,
otherwise keep uncertain timestamps null. Test the exact 180-second and 48-hour boundaries.

## 4. Configuration

| Name | Kind | Value |
|---|---|---|
| `AI` | binding, `remote: true` | Workers AI |
| `VECTORS` | binding `vectorize`, index `media-rag`, `remote: true` | created once by the owner (AGENTS.md → One-time setup) |
| `INGEST_WORKFLOW` | binding `workflows`, class `IngestWorkflow` | one instance per episode, id `${runId}.${videoId}` |
| `DOWNSUB_API_KEY` | secret | `wrangler secret put` when deployed; `.dev.vars` locally |
| `TRANSCRIPTS_FAKE`, `AI_FAKE`, `VECTORIZE_FAKE` | test-only bindings in `vitest.config.ts` | canned `TranscriptResult` values by video id; deterministic embeddings and canned summaries; an in-memory vector store |
| `YOUTUBE_FEEDS_FAKE` | test-only binding, already present | grows from `channelId → title` to `channelId → { title, entries[] }`, keeping the string form, so tests can drive selection and the 48-hour boundary |
| `triggers.crons` | wrangler | `["0 */6 * * *"]` |

`remote: true` lets local `wrangler dev` reach the real Workers AI and Vectorize, which have no local simulation,
while Durable Objects and the Workflow stay local. Tests never reach them: the fakes are the only seam that works
end to end in the pinned pool. The stagger has no configuration; three seconds per instance is a constant.

## 5. Dependencies

None new. Workflows, Workers AI, and Vectorize are Cloudflare bindings. DownSub is an HTTPS API called with `fetch`.

## 6. Out of scope

Chats, retrieval for chat, preferences (M4). A retention policy. Re-embedding when the model changes. Non-English
channels (skipped per video, not processed). Any channel-level failure state, channel retry, or automatic follow:
those concepts were removed on 2026-09-10. Fencing runs against channel state changes: removed on 2026-09-11.
Vectorize deletion when a channel is declined (PRD §6: not required; eligibility excludes the channel). A Queue or
any binding beyond the three above.

## 7. Acceptance criteria

1. First approval and the owner's on-demand start each create one run row with its selected run-episodes and one
   Workflow instance per selected episode; a second start while a run is open creates nothing; re-approving a
   declined channel that had been approved before starts nothing.
2. Under `wrangler dev` with the DownSub key in `.dev.vars`, an approved channel with captioned recent videos gets
   its episodes `available` with chunk counts set, vectors present in the real index, and structured summaries
   stored; a video without captions published this week stays `pending CAPTIONS`; one under three minutes is
   `skipped SHORT` with nothing stored; DownSub's `/status` shows one credit per attempted video and `GET /catalog`
   reports it; the run closes `completed` when the last instance reports.
3. Declining the channel mid-run stops nothing: the run finishes and closes `completed`, the episodes it published
   after the decline are stored, none of them appears in any digest, channel history, or chat while the channel is
   declined, and all of them appear after re-approval, which leaves `approved_at` alone and starts no run.
4. A transport failure leaves the episode `pending` with `attempt_count` 1, the next run reattempts it, and the
   third failure makes it `failed`; the owner's Retry returns it to `pending` and starts a one-episode run whose
   only run-episode is that video, leaving its siblings' summaries untouched.
5. With the DownSub key pointed at an exhausted account, the affected episodes read `pending PROVIDER_LIMIT`, no
   attempt is counted, the run closes `failed PROVIDER_LIMIT`, and the next tick launches nothing until `/status`
   shows credits, then resumes them. Verified with the fake; confirmed by hand the first time it happens for real.
6. With a wrong key, every instance ends without an attempt, run-episodes read `not_attempted PROVIDER_AUTH`, and
   the run closes `failed PROVIDER_AUTH`; fixing the key and running again picks every episode up.
7. `wrangler dev --test-scheduled` plus a request to `/__scheduled` starts runs for approved, unpaused channels
   only, skips paused ones, reconciles before selecting, numbers its instances across channels with start delays of
   3 s apart, and `wrangler.jsonc` schedules it every 6 hours.
8. The first-approval run starts while the channel is system-paused for having no followers.
9. The first cron after approval imports no feed entry published before the channel's `approved_at`; a new upload
   after it is imported.
10. A captionless video re-checked at or after 48 hours is fetched again before being `skipped NO_CAPTIONS`; a
    non-English video is `skipped NON_ENGLISH`; a live stream waits and then skips the same way.
11. Every structured summary's takeaways carry `startSec` where the model gave a timestamp, and the digest links them.
12. The digest selects and orders by `summaryAvailableAt`: a video published a month ago and summarised today
    appears in today's digest; reading it does not move it; two episodes published minutes apart keep publication
    order.
13. A related-lookup failure still publishes the summary with `related: []`.
14. A run-episode whose instance is missing or errored reconciles to `failed WORKFLOW_LOST` at the next tick once
    the run is an hour old, the episode's attempt count is unchanged, the run closes, and a write from a stale
    instance against a closed run is refused. "Approved, never started" reads only when the channel has no run row.
15. Migration `0002_drop_lifecycle_version` applies on a fresh Registry and on one that already ran `0001`; neither
    table has the column afterwards; `_migrations` lists both versions.
16. `pnpm check` green; the coverage in AGENTS.md → Testing exists for lifecycle, attempts, the run gate, chunking,
    VTT parsing, summary validation, and the M3 items it lists.
17. AGENTS.md and the PRD carry these decisions (§8).

## 8. `AGENTS.md` and PRD alignment

Applied on 2026-09-10:

- **Transcript contract:** `TranscriptResult.captionStatus`, the live-over-unplayable rule, the fake returning full
  results, and the English-only track choice with `skipped NON_ENGLISH`.
- **AI usage:** publication without a gate; digest windows by `summaryAvailableAt`; related episodes as optional
  enrichment.
- **Ingestion pipeline:** episodes that left the feed stay in the selection; a fresh no-caption result is re-fetched
  at 48 hours; the first-approval run ignores pause.
- **API shape:** top-level `skipReason` on every episode; digest by first availability; the planned
  `POST /channels/:id/runs`.
- **Screens:** the digest's availability basis and its three empty states.

Applied on 2026-09-11 with this revision:

- **Ingestion pipeline:** the handler fetches and selects, one instance per episode, the three Registry writes, the
  count-down close, the run gate, the definition of a new feed entry, account-level provider failures, the stagger,
  reconciliation at each cron tick with no age window, and the removal of every fencing sentence.
- **Catalog:** decline no longer bumps anything; a run in flight finishes.
- **Data & schema conventions:** the one owner-approved drop, migration `0002_drop_lifecycle_version.sql`.
- **API shape and Screens:** `lifecycleVersion` leaves `ChannelManagement`, `IngestionRun`, and the owner detail
  header.
- **Testing:** the fence bullets become the run-gate and decline-finishes bullets.
- **Open decisions:** the Workers plan and the reconciliation window are decided.
- **PRD** §4.1, §4.2, §5.1, §5.3, §7, §8, and §9 carry the same changes; `channel-simplification.md` §3.1, §3.3,
  §3.4, §5, §7, and §9 and `home-read-experience.md` lose their fence sentences.

Still to apply with the code, per plan step: `EpisodeSummary.takeaways` as `{ text, startSec }[]` and
`summaryAvailableAt` on episodes (Step 3), `transcripts.remainingCredits` on the catalog (Step 7), PRD §4.2 and §4.4
wording for the digest basis (Step 9).
