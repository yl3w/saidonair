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
its instances (§2 "Launch throttle"); Workers Paid is confirmed. The same evening the outcome families were
collapsed to one attempt rule behind a pre-flight check (§2 "Technical failures" and "Pre-flight gate"). The
review's findings are folded in where they belong: what a new feed entry is, how the owner-retry run knows its
episode, the verify step and Vectorize's asynchronous writes, the related-episode
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
a run in flight; the run finishes, and eligibility hides what it produced from readers until the channel is approved
again, while the owner keeps seeing it in the management views.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Unit of execution | **One Workflow instance per episode; one run row per channel** (owner decision 2026-09-11). The handler that starts a run fetches the feed, selects the episodes, and writes `createRun` + `upsertFromFeed` + `recordSelection` in one Registry transaction, then creates an instance per selected episode with id `${runId}-${videoId}` and params `{ runId, videoId, channelId, startDelaySec }`. An instance never fetches the feed, never selects, and never touches channel status. It can make exactly three Registry writes: `markTranscript`, `completeEpisode`, `failEpisode`, each of which updates the episode and its run-episode row together and closes the run when that row was the last one still `selected`. | A lost or stuck instance blocks one episode, not a channel. Episodes process in parallel, so an initial import finishes in the time of one episode. The Workflow is only the pipeline. The run row keeps `ingestion_runs`, the owner's runs screen, `latestRun`, `neverStarted`, and the one-active-run rule exactly as they are, with no migration for this decision. The pure per-episode form would have dropped the one-active-run index and re-pointed those screens for no extra benefit. |
| Where transcripts come from | **DownSub, behind one contract.** `TranscriptSource.fetch(videoId)` returns a `TranscriptResult`: segments when an English track exists, `durationSec`, `isLive` (live or upcoming), and `captionStatus` of `english`, `none`, or `non_english`; or it throws a `TranscriptError` for a provider failure. Tests select a canned fake with the test-only `TRANSCRIPTS_FAKE` binding; everything else uses the DownSub adapter. | The source is the thing most likely to change again. Ingestion must not know which one is in use, and a replacement is one file behind the seam. |
| DownSub specifics | `GET https://api.downsub.com/download?url=<watch URL>` with the `DOWNSUB_API_KEY` secret. `state` `subtitles_found` → pick a track and fetch its **VTT**, and if the chosen track parses to zero usable cues, report `captionStatus: "none"` exactly as if no track existed, since an empty caption file is no captions in every sense a reader cares about (decided 2026-09-11); `no_subtitles` → `captionStatus: "none"`; `error` → `TranscriptError("UNPLAYABLE", playabilityReason)` unless the body's live/upcoming metadata says the video is waiting, in which case a result with `isLive: true` is returned for classification. HTTP 401 → `PROVIDER_AUTH`, 403 → `PROVIDER_LIMIT`, 429 → `PROVIDER_RATE_LIMIT`, other non-2xx → `PROVIDER_HTTP`, unparsable → `PROVIDER_PARSE`. | Verified 2026-09-08 with a trial key: synchronous, ~0.8 s when captions exist, 1 credit per video that has or lacks captions, 0 for errors and file downloads, fresh uploads (1–2 h old) served. Error states are slow (17–57 s), so the step timeout is generous. |
| Track choice | English-first: a manual `en`/`en-*` track, else `en_auto`/`en-*_auto`; if tracks exist but none is English, return `captionStatus: "non_english"` without downloading anything. The DownSub `code` field decides; labels are unreliable ("undefined (auto-generated)" appears). | Summaries and chat are English; an English auto-caption beats a human caption in another language. There is no non-English or translation fallback. |
| Transcript size ceiling | The transcript step serialises at most 700 KB of segments. A transcript over that ceiling is a deterministic technical failure `TRANSCRIPT_TOO_LARGE`: `markTranscript` increments `attempt_count` once, for the fetch that happened, and records it as `failed` at once, skipping the rest of the three-attempt ladder, so it costs one credit and reaches the owner, who can Skip it. | Workflows cap a step result at 1 MiB. Segments for eight hours of speech are roughly that size; the ceiling keeps a multi-day stream from failing on the platform limit after retries. |
| Summary in M3 | **Yes.** `available` requires a stored summary (PRD §4.2, the `episodes` CHECK), so the summarize step is in this milestone. M4 keeps chats, retrieval, citations, and preferences. | Without it no episode could ever be `available` and the digest would stay empty after M3. |
| Publishing without a gate | Summaries publish automatically after JSON validation, one retry, and the raw-text fallback. No manual approval, no quality review. | Owner decision 2026-09-10. A personal tool with a trusted audience; the owner retries an episode if a summary is poor. |
| Related episodes | Optional enrichment. Each embedding step returns, beside its vectors, the running sum of those vectors and their count; the related step averages the sums into the episode's centroid, queries `shared-catalog` with it, excludes the episode's own `videoId`, deduplicates to at most five `available` videos, and stores the ids in `related_video_ids_json`. A failed lookup or no qualifying result stores `[]` and publication proceeds. | Related suggestions must never prevent delivery of the summary. The sum is 768 numbers, so the centroid needs no vector to outlive its upsert step. Display filters titles to the reader's eligible channels and omits an empty section. Owner decision 2026-09-10. |
| Which channels a run touches | Scheduled runs: `status = 'approved'`, `paused_by IS NULL`, no queued or running run. The first-approval run, an owner's episode retry, and an owner's on-demand start ignore `paused_by`. Declined channels are excluded by status; there is no channel failure state to exclude. | `channel-simplification.md` §3.4. Follower count reaches selection only through pause, so a channel nobody follows costs nothing after its initial import. |
| Which episodes a run attempts | The first run that selects anything is `initial`, whoever creates it: the approve request normally, or Start or cron when no run has selected an episode for the channel yet, because the approve-time feed fetch failed or found nothing. It takes the newest `initial_import_count` feed entries, whatever their publication date. Every later run is `scheduled`, Start included, and takes **new** feed entries plus every `pending` episode, waiting ones and those below three technical attempts, including selected episodes that have left the feed. A feed entry is new when it is not yet tracked **and** its `published_at` is later than the channel's `approved_at`. Episode retry: exactly the one episode; `createRun` for an `owner_retry` run inserts that episode as the run's only run-episode, so the instance is told which video it owns. Skipped episodes are never re-bought by cron. **Only selected entries become episode rows**: the feed's other entries are neither tracked nor remembered, so an initial import's leftovers cannot be swept up by a later run's "every pending episode" clause. **Every start the pre-flight gate admits records a run**; a blocked start records nothing, see "Pre-flight gate". Feed discovery and pending recovery are separate inputs: a feed that could not be read empties only the first, so every persisted `pending` episode, waiting or below three attempts, is still selected and launched during an RSS outage, since resuming it needs nothing but its video id (reviewer finding, 2026-09-11). Only when there is nothing to launch, an empty selection or an unreadable feed with nothing pending, is the run inserted already `completed` with no run-episodes, so the runs list shows that the tick looked at the channel and found nothing to do; absence of run-episodes is the whole signal, whatever the reason (owner decision 2026-09-11, evening). `ingestion_runs.episode_limit` records `initial_import_count` on `initial` runs and is null otherwise, since the API and the runs screen show it. After a long decline, re-approval lets the next scheduled run import every untracked entry newer than the first approval, at most the fifteen or so the feed shows; accepted. | PRD §4.2 and `channel-simplification.md` §3.3. The feed carries about fifteen entries and the initial import takes five; without the publication rule the first cron after approval would import the other ten, turning `initial_import_count` into a delay rather than a cap at one credit per video. |
| Fresh uploads without captions | A "no captions" answer for a video published **within the last 48 hours** leaves the episode `pending` with `waiting_code = CAPTIONS` and `transcript_checked_at` set, no attempt counted; each scheduled run re-checks it. At or after 48 hours the video is fetched again, and only another no-caption answer makes it `skipped NO_CAPTIONS`. | YouTube's auto-captions lag an upload by hours; the freshest videos are the point of a digest. Elapsed time alone does not prove captions are absent. Owner decisions 2026-09-08 and 2026-09-10. |
| Shorts, live streams, premieres | Under **180 seconds** → `skipped SHORT`, nothing stored. Live or upcoming → `pending` with `waiting_code = LIVE_OR_UPCOMING`, re-checked like a fresh upload; still live at or after 48 hours → `skipped LIVE_OR_UPCOMING`. Known live metadata wins over an `UNPLAYABLE` answer. `UNPLAYABLE` otherwise → `skipped UNPLAYABLE`. | Shorts clutter a digest; streams cannot be summarised until they end. The feed carries no duration, so the DownSub call is made first and costs its credit; accepted. Owner decision. |
| Non-English videos | `captionStatus: "non_english"` → `skipped NON_ENGLISH`. There is no channel-level consequence: a channel whose videos are all non-English is an approved channel with `episodes.available = 0`, which the owner can pause or decline. | Summaries, embeddings, and chat are English. Owner decision 2026-09-08; the channel code it once implied was removed on 2026-09-10 with every other channel failure code. |
| Technical failures: one rule | **Every outcome that is not a success, a wait, or a deterministic skip counts one attempt**, and the third makes the episode `failed` for the owner's Retry (owner decision 2026-09-11, evening). That covers `PROVIDER_HTTP`, `PROVIDER_PARSE`, `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED`, and `WORKFLOW_LOST` alike: `attempt_count` goes up by one and `failure_code` records the reason; below three the episode stays `pending` and the next scheduled run reattempts it. Waits (`CAPTIONS`, `LIVE_OR_UPCOMING`, `PROVIDER_LIMIT`) never count. `TRANSCRIPT_TOO_LARGE` is deterministic: it counts its one attempt and goes to `failed` at once. There is no separate account-level family and no run-level failure code. | Outcomes live on episodes only, the principle of 2026-09-10. An earlier draft of this day kept a wrong key or a rate limit off the attempt count and put the signal on the run instead, which needed a precedence list, a fourth attention count, and a group on the Owner page. One rule is what a new engineer can hold in their head; the two cases that would have hurt at scale, a bad key and an empty balance, are stopped before they touch an episode by the pre-flight gate below. The price is that a throttle or an outage lasting three ticks sends its episodes to the owner as `failed`, one Retry each. |
| Pre-flight gate | Every start, whoever asks for it, first reads DownSub's `/status` through the wrapper the catalog uses, cached for five minutes per isolate so the cost is one real call however many channels start. A 401 or `remainingCredits` of zero means nothing is launched and no run is recorded: cron logs `{ event: "ingestion.tick_skipped", reason }` and skips the tick, Start answers 502 `UPSTREAM_UNAVAILABLE` naming the reason, approve and the owner's add still approve and leave the channel "approved, never started", and retry still resets the episode to `pending` and starts nothing. An unreachable `/status` does not block. The gate applied to cron only until a reviewer noted the same day that a manual start with a known-bad key would cost every selected episode an attempt. `PROVIDER_LIMIT` (403, credits) met inside a run is a wait: `pending` with `waiting_code = PROVIDER_LIMIT`, run-episode `waiting`, no attempt. A run closes `completed` once every run-episode has an outcome; `ingestion_runs.failure_code` is never written. | A wrong key or an empty balance would otherwise burn one attempt per episode per tick. Checking once per tick, with a call that costs no credits, keeps both away from the episodes without a special outcome family. A key that breaks after the check reaches a few episodes as one attempt each, which the one rule handles. The catalog's `transcripts` block carries the check's answer so the owner sees a rejected key on the health strip. |
| Owner episode actions | `POST /channels/:id/episodes/:videoId/retry` (`failed` or `skipped` → `pending`, attempts and skip fields cleared, one-episode `owner_retry` run) and `…/skip` (`failed` → `skipped OWNER`), both requiring an approved channel with no active run. Implemented on 2026-09-10; M3 makes the retry actually start a run. | `channel-simplification.md` §3.3. The only retry there is; siblings and their summaries are untouched. |
| Takeaways carry timestamps | Each takeaway is `{ text, startSec }`, `startSec` null when the model gives none or it falls outside the episode. The prompt sends `[h:mm:ss]` markers and asks for one per takeaway; `mm:ss` is accepted for episodes under an hour. `EpisodeSummary.takeaways` in `packages/shared` changes from `string[]`; the web renders a `youtu.be/<id>?t=<s>` link per takeaway. No legacy data exists, so no normalisation of string takeaways is needed. | The digest's most useful click is "take me to that moment". Owner decision 2026-09-08; the legacy rule of 2026-09-10 became moot with the pre-production reset. |
| Digest basis | Digest selection and ordering use the episode's first `processed_at`, exposed as `summaryAvailableAt`: 24 hours by default, seven days when expanded, ordered strictly by `processed_at` descending, `video_id` as the only tiebreak so the order is stable. Reads, refollows, re-approval, and enrichment never reset it; channel history stays publication-ordered. | Owner decision 2026-09-10, order confirmed 2026-09-11. A video published a month ago but summarised today belongs in today's digest. Episodes that became available within the same minutes, an initial import for instance, list in the order their summaries landed: independent instances finish milliseconds apart, so a publication tiebreak on equal timestamps would never fire, and the owner chose strict availability over a bucketed order. |
| Channel timestamps | `last_checked_at` moves inside `createRun` whenever the feed was actually read, whether the selection was empty or not. A run recorded because the feed could not be read leaves it where it was. `last_ingested_at` is written by `completeEpisode`, the moment a summary becomes readable, to that episode's `processed_at` and only forward, never at run close: with one instance per episode the first summary of a run can be readable for minutes while a long sibling is still being summarised, and the catalog and the follows order must not say nothing happened in between (reviewer finding, 2026-09-11). | An empty run is inserted already `completed`, so it never sits `running` and holds nothing open. Because the check time moves only on a real read, a persistently unreadable feed shows as runs that keep appearing while `last_checked_at` stands still, with no extra state. The web turns that into words rather than a comparison, for the latest run whether or not it has rows: with `lastCheckedAt` equal to the run's `startedAt` an empty run renders "no episodes · nothing new" and a run with rows renders its outcome counts; with an older `lastCheckedAt` the line gains "· feed could not be read since [last checked]", so pending work relaunched during an outage reads, say, "2 waiting · feed could not be read since 9h ago"; with a null `lastCheckedAt`, the feed never having been read since approval, it gains "· feed never read successfully"; in the catalog table's Latest run cell and the owner detail's runs list (decided 2026-09-11). Older empty runs render as plain "no episodes", since only the latest check time is kept. `GET /follows` sorts by most recent ingestion and the catalog shows "Last ingested"; both need one meaning. |
| Catalog health figure | `GET /catalog`'s `lastSuccessfulIngestionAt` becomes `MAX(channels.last_ingested_at)`: when a summary was last published anywhere (owner decision 2026-09-11). | It was the newest `finished_at` among `completed` runs, written on 2026-09-10 when the run was the unit of success. Runs no longer carry success or failure, only their episodes do, so the figure comes from the channels and means what the health strip's "Last ingestion" says. |
| Step granularity | One `step.do` per external call inside an instance: the stagger sleep, transcript, each embedding batch, each upsert batch, retrieval verification, each summary map and reduce call, the related query, and each Registry write. Steps return bounded serialisable values; vectors pass from an embedding step to its upsert step and no further, apart from the running sum for the centroid. | AGENTS.md → Ingestion pipeline. Workflows cap a step result at 1 MiB and retry per step. |
| Verify step | After the last upsert, `getByIds` is called in batches of the API's per-call ceiling until every expected id is present. The step's own retry policy (three retries, exponential backoff from five seconds) absorbs Vectorize's asynchronous processing; only after those retries does a missing id count as `VECTORIZE_INCOMPLETE`. | Vectorize applies an upsert asynchronously and returns a mutation id; an immediate read can miss vectors that are on their way. Counting that as an attempt would burn the episode's three chances on timing. PRD §6 still holds: `available` is never set on an accepted upsert alone. |
| Decline mid-run | **Nothing is fenced** (owner decision 2026-09-11, reversing 2026-09-10). Declining a channel is a status change; a run in flight finishes, its episodes are stored as they would have been, and eligibility hides them from readers until the channel is approved again; the owner, whose episode reads ignore channel status, sees them throughout. `lifecycle_version` leaves `channels` and `ingestion_runs` through migration `0002_drop_lifecycle_version.sql`; there is no `cancelled` run in this design. | The fence guarded the earlier model, in which runs wrote channel state and channels could be deleted and restored. Runs now write only episodes, summaries, and two timestamps, none of which is about the approval, and a declined channel keeps everything it produced anyway. Pause already lets a running run finish. The cost of a run outliving a decline is a few credits, bounded by the run's selection. |
| Run gate | An instance's write is accepted only while its run is `queued` or `running`; otherwise the Registry answers `INVALID_STATE` and the instance exits. | Reconciliation can close a run whose instance turns out to be alive, and cron may then start a new run on the same episodes. The gate keeps the stale instance from double-counting an attempt or overwriting the new run's outcome. It is one primary-key lookup and has nothing to do with decline. |
| Publishing | An episode is `available` only after `getByIds` returns every expected vector and the summary row exists, in one Registry write that also sets `processed_at` once and records the run-episode as `available`. | PRD §6: never publish on an accepted asynchronous upsert. |
| Cron | **Every 6 hours**, `0 */6 * * *` UTC, in `triggers.crons`. The `scheduled` handler reconciles, then selects channels, then per channel fetches the feed, selects episodes, writes the run, and creates the instances. It is exercised with `wrangler dev --test-scheduled`. | Owner decision 2026-09-08. A 24-hour digest window reads better when items trickle in than in one daily burst. |
| Launch throttle | The handler numbers the instances it creates during one tick, across every channel, and passes `startDelaySec = k × 3` to the k-th; the instance's first step sleeps that long. A 429 during the transcript step is retried by the step with backoff; one that outlasts the retries counts an attempt like any other error. | Owner decision 2026-09-11. One tick can start dozens of instances at once; the channel-run model spread them out for free by running episodes sequentially, and the hybrid must spread them deliberately. No new binding. |
| Reconciliation | **At each cron tick, before selection** (owner decision 2026-09-11). The handler records a failed `create()` immediately as a run-episode `failed WORKFLOW_LOST` (one attempt on the episode), and an instance whose step gives up after its retries catches the error and writes `failEpisode` itself, so the sweep is a safety net. The sweep examines runs older than one hour: for each run-episode still `selected` it computes the instance id `${runId}-${videoId}` and asks Workflows for its status through `lib/workflows.ts`, which folds the engine's answers into `active` (queued, running, paused, waiting), `gone` (complete, errored, terminated), or `missing`. Active instances are left alone; gone or missing ones become run-episode `failed WORKFLOW_LOST`, one attempt on the episode like any other failure, and the run closes when no row is left `selected`. "Approved, never started" means approved with no run row and gets no age window: since even an unreadable feed records a run, it arises only when the approve request's run creation itself failed, and the Start button is the remedy. | Without it a lost instance would hold the channel's one active-run slot forever, so cron would skip the channel and Retry and Skip would answer 409. The two ledgers, SQLite and Workflows, cannot be updated in one transaction. |
| On-demand start | `POST /channels/:id/runs` (owner, `approved`) creates a run now, ignoring pause: `initial` while no run has selected an episode for the channel, so a channel whose approve-time feed fetch failed still gets its initial import, and `scheduled` after that. Responses, checked in this order so a provider problem never masks a state answer: 404 for an unknown channel; 409 `INVALID_STATE` while the channel is not approved or a run is open; 502 `UPSTREAM_UNAVAILABLE` when the pre-flight gate is blocked, nothing recorded; then 200 `{ run }`, where a run with no run-episodes and status `completed` means the feed had nothing new and nothing is pending, or 502 when YouTube did not answer, after the empty run has been recorded. It is what the Needs-attention Start button calls for a never-started channel and the owner's nudge after a credit refill. The `scheduled` kind is reused for the manual case because the `kind` CHECK is frozen; the runs screen therefore cannot tell a manual start from cron, which is accepted. | `channel-simplification.md` §3.4 asks for a Start action once a route exists. A run with no episodes is itself the answer that nothing was there; a feed that cannot be read is the same 502 `POST /channels` already returns. |
| Long episodes | **Map-reduce over 45-minute sections.** Each section is summarised with its own timestamped takeaways; one final call condenses the section summaries into the episode's summary. An episode with a single section skips the reduce step, so short videos cost one call. | Owner decision 2026-09-08. The model reads 24,000 tokens per call, about 1 h 45 min of speech; sampling would leave long-episode takeaways pointing only at sampled minutes. Cents per long episode. |
| Catalog credits and key status | `GET /catalog` gains `transcripts: { remainingCredits, status }` from DownSub's `/status`, fetched at most once every five minutes per isolate with a two-second timeout: `status` is `ok`, `auth_failed` on a 401, or `unreachable` when the call fails, times out, or the fake source is in use, and `remainingCredits` is `null` in the last case. The catalog response never fails because of it. Every start's pre-flight gate reads the same wrapper, so the health strip and the gate always agree. | The owner sees the balance and a rejected key where the other health numbers are, and Home never waits on a third party. Owner decision 2026-09-08 for the credits; the timeout and the status are from the 2026-09-11 review. |
| Workers plan | **Workers Paid**, confirmed 2026-09-11. | Workflows on the free plan allow 10 ms CPU per step; parsing a 400 KB DownSub body and chunking an hour of speech need Paid. Concurrency is not the constraint: only actively running instances count toward the cap (100 on Free, 50,000 on Paid, per Cloudflare's limits page on 2026-09-11), and instances that are sleeping or retrying do not, so the stagger costs nothing there. |
| Embedding model id | `@cf/baai/bge-base-en-v1.5`, 768 dimensions. | The deployed model id carries `.5` (it is also Vectorize's preset name). |

## 3. Pipeline

```
start point (approve · cron · Start · retry) ──► Worker handler, not a Workflow
   reconcile (cron only)   close run-episodes whose instance is gone; close runs with nothing left selected
   pre-flight (every start) DownSub /status through the cached wrapper; on 401 or remainingCredits = 0 nothing is
                           launched and no run is recorded: cron logs and skips, Start answers 502, approve and
                           retry answer as usual and leave the channel or episode for a later start
   fetch-feed              rss.fetchChannelFeed(channelId); failure → selectedEntries is empty and last_checked_at
                           stays, but persisted pending episodes are still selected and launched as a normal run
                           (Start answers 200 with it); only with nothing pending is an empty completed run recorded,
                           and Start then answers 502; cron and approve log the failure either way; skipped for an
                           owner retry, whose one video is already tracked and may have left the feed
   kind                    owner_retry for the retry route; otherwise initial while no run has ever selected an
                           episode for the channel, scheduled after that
   select                  initial: newest N, dates ignored · scheduled: new entries + every pending · retry: the one episode
   nothing selected        Registry.createRun records the run already `completed` with no run-episodes and
                           last_checked_at moved: the tick looked and found nothing to do
   write                   Registry.createRun + upsertFromFeed(selectedEntries only) + recordSelection, one transaction, run `running`,
                           last_checked_at set, run-episodes `selected`
   fan out                 INGEST_WORKFLOW.create({ id: `${runId}-${videoId}`, params: { runId, videoId, channelId,
                           startDelaySec: k × 3 } }) per selected episode; a create() that throws → run-episode
                           failed WORKFLOW_LOST at once

one instance per episode:
   stagger        step.sleep(startDelaySec)
   transcript     source.fetch(videoId)                    → TranscriptResult | TranscriptError
   classify       Registry.markTranscript(runId, videoId, outcome)
                    english captions → continue; waiting (fresh no-captions, live, credits) → pending + waiting_code,
                    run-episode waiting; short / non-English / no captions ≥ 48 h / live ≥ 48 h / unplayable →
                    skipped + reason, run-episode skipped; episode-level technical → attempt +1, pending below three,
                    failed on the third, run-episode failed (PROVIDER_AUTH and PROVIDER_RATE_LIMIT included);
                    anything but "continue" ends the instance here
   chunk          lib/chunk.ts inline, not a step: pure and deterministic, so a replay recomputes the same chunks
   embed[i]       ai.embed(chunk texts, batch of ≤ 20)     → vectors + running sum (vectors stay in this step)
   upsert[i]      vectors.upsert(ns, ids, vectors, metadata)
   verify         vectors.getByIds(ns, ids) in batches until every id is present; step retries absorb the async lag
   summarize[s]   ai.summarize(section s) per ≤45-minute section       (invalid JSON: one retry, then fallback)
   reduce         ai.reduce(section summaries) when there is more than one section
   related        centroid query, exclude own videoId → up to 5 distinct available videos; failure → []
   publish        Registry.completeEpisode(runId, videoId, { chunkCount, summary, related }) → available,
                  processed_at set once, run-episode available
   transcript step ends any way but a result: its TranscriptError, non-retryable or thrown after the step's
                  retries, is classified and written by markTranscript like a result would be
   any later step giving up after its retries: Registry.failEpisode(runId, videoId, code, detail)
   a refused write (the run was closed under the instance): log and end; no exception ever escapes run

Registry, inside each of the three writes: refuse unless the run is queued or running; update the episode and its
run-episode; in completeEpisode also move channels.last_ingested_at forward to the episode's processed_at; if no
run-episode is still `selected`, close the run `completed`.
```

Retry policy per step: transport failures retry 3 times with exponential backoff from 10 seconds; `UNPLAYABLE`,
`PROVIDER_AUTH`, `PROVIDER_LIMIT`, `TRANSCRIPT_TOO_LARGE`, and a refused Registry write are non-retryable inside the
run (the episode's own attempt count is the cross-run retry). A `TranscriptError` carries its reason as the message
prefix, as `DomainError` carries its code, so the reason survives the step boundary and the instance can classify it. Transcript step timeout 2 minutes (DownSub's error paths take up
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
| Technical attempt | `status = 'pending'`, `attempt_count` 1–2, `failure_code`, `failure_detail` | `PROVIDER_HTTP`, `PROVIDER_PARSE`, `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED`, `WORKFLOW_LOST` | None; the next cron reattempts |
| Failed | `status = 'failed'`, `attempt_count` 3, `failure_code` | the same technical codes | Retry or Skip (Needs attention) |
| Failed at once | `status = 'failed'`, `attempt_count` one higher than before, `failure_code` | `TRANSCRIPT_TOO_LARGE`: deterministic, so the ladder is skipped, but the one fetch that happened is counted | Retry or Skip; Skip is the usual answer |
| Available | `status = 'available'`, `chunk_count`, `vectorized_at`, `processed_at` | | |

Each write clears the fields of the outcomes it supersedes, so a row never tells two stories: finding captions or a
technical failure clears `waiting_code`; a wait clears `failure_code` and `failure_detail`; a skip and a publication
clear both; `attempt_count` is history and only Retry resets it. The matrix is in the plan's Step 4 (reviewer
finding, 2026-09-11).

| Outcome | Column | Values | Owner action |
|---|---|---|---|
| Run | `ingestion_runs.status` | `running` from creation, `completed` once every run-episode has an outcome; `failure_code` stays null | None; runs are history, and their run-episodes say what happened |
| Run episode | `ingestion_run_episodes.status` | `selected`, `available`, `failed`, `skipped`, `waiting`, `not_attempted` | |

A feed that cannot be fetched still records a run, already `completed` with no run-episodes and `last_checked_at`
untouched, and the handler logs `{ event: "ingestion.feed_unavailable", channelId }`; an empty selection records the
same run with `last_checked_at` moved. The `queued`, `failed`, and `cancelled` run statuses
exist in the frozen CHECK constraint and in the shared enum and are not written by this design: a run is `running`
from creation and `completed` once accounted for; outcomes live on the run-episodes and the episodes. The run-episode
status `not_attempted` is in the same position: it served account-level stops and cancelled runs, both gone. The enum's description in `packages/shared` says so (plan Step 3).

Readers see `status` and a top-level `skipReason` on every episode; `waitingCode`, attempts, and technical codes are
in the owner's `processing` block. `apps/web/src/lib/copy.ts` already carries the phrases for every value above
except the technical codes, which the owner sees raw.

### 3.4 Waiting, failure, and recovery

| Situation | Episode and channel behaviour | Next action |
|---|---|---|
| Fresh video without captions, or live/upcoming, under 48 h | Episode `pending` with the wait reason, no attempt counted; the channel is unchanged | Next six-hour cron re-checks the persisted selection, even if the video has left the feed |
| Same, at or after 48 h | Fetched once more; a fresh no-caption or still-live answer makes it `skipped` with the matching reason | Owner Retry if captions appear later |
| Credits exhausted | Each instance that meets the 403 leaves its episode `pending PROVIDER_LIMIT`, no attempt counted; the run closes `completed` with those rows `waiting` | The pre-flight check launches nothing until `/status` shows credits; then cron resumes them |
| Bad key | The pre-flight check answers 401, the tick launches nothing, and the health strip reads the key as rejected. A key that breaks after the check costs each affected episode one attempt, like any other error | Fix the key; the next tick runs |
| Rate-limited after the step's retries | One attempt on the episode, like any other error; the stagger and the backoff make it rare | Nothing; the next cron reattempts. Three in a row reach the owner as a `failed` episode with Retry |
| Technical error, attempts 1–2 | Episode stays `pending`, reason recorded | Next cron reattempts it |
| Technical error, third attempt | Episode `failed` | Owner Retry or Skip; other episodes and the channel are unaffected |
| First approval with no followers | The channel is system-paused at approval, and the initial import still runs once | Scheduled runs wait for a follower |
| Owner declines an approved channel mid-run | Nothing stops. The run finishes and publishes as usual; eligibility hides the channel's summaries from readers' digest, channel history, and chat while it is declined, and the owner still sees them on the channel's episodes with `processing` | Re-approval restores readers' access to everything, including what landed after the decline, and starts no new import |
| An instance never starts, or dies after its step retries | A `create()` that throws is recorded at once; an instance that catches its own step exhaustion writes `failEpisode`; anything else is found by the sweep at the next tick and closed `failed WORKFLOW_LOST`, one attempt on the episode; the run closes `completed` | Next cron reattempts; Start if the owner is in a hurry. Three lost in a row reach the owner as a `failed` episode |
| The approve request's feed fetch fails | An empty `completed` run is recorded with `last_checked_at` untouched; the channel has a run row, so it is not "never started" | The next cron, or Start, creates the `initial` run since nothing has been selected yet, so the newest N are still imported; a channel paused for having no followers waits for Start |
| Cron finds nothing new and nothing pending | An empty `completed` run is recorded and `last_checked_at` moves | None; the next tick looks again |
| Cron cannot read the feed | Persisted `pending` episodes are still selected and launched as a normal run; `last_checked_at` stays. With nothing pending, an empty `completed` run is recorded instead | None; waits and attempts resume regardless of RSS. A run whose start outruns `last_checked_at` is how an unreadable feed shows |
| Related lookup fails | Summary publishes with `[]` | None |

Within one instance a wait or a skip ends it at the classify step; a
run with only waiting episodes, `PROVIDER_LIMIT` waits included, completes normally and records them as `waiting`,
since runs carry no verdict of their own; the channel-level count of waiting
episodes (`episodes.waiting`) is what readers and the owner see, never a channel waiting code.

### 3.5 Selection contract

The adapter and the fake both return the full `TranscriptResult`: duration, live/upcoming flag, and `captionStatus`,
with English segments when present. `captionStatus: "english"` always comes with at least one segment: a chosen
English track whose file yields no usable cues is reported as `"none"`, so the classify step never continues with
an empty transcript and the `chunk_count > 0` requirement on `available` can never be met by accident. Known
live/upcoming state is classified before duration and caption checks,
including provider `error` bodies carrying that state; other errors throw. For non-live results: known duration
below 180 seconds skips, non-English captions skip, no captions follow the 48-hour rule, and English captions
process. Unknown duration must not imply a short video; use the transcript's end for timestamp bounds when possible,
otherwise keep uncertain timestamps null. Test the exact 180-second and 48-hour boundaries.

## 4. Configuration

| Name | Kind | Value |
|---|---|---|
| `AI` | binding, `remote: true` | Workers AI |
| `VECTORS` | binding `vectorize`, index `media-rag`, `remote: true` | created once by the owner (AGENTS.md → One-time setup) |
| `INGEST_WORKFLOW` | binding `workflows`, class `IngestWorkflow` | one instance per episode, id `${runId}-${videoId}` |
| `DOWNSUB_API_KEY` | secret | `wrangler secret put` when deployed; `.dev.vars` locally |
| `TRANSCRIPTS_FAKE`, `AI_FAKE`, `VECTORIZE_FAKE` | test-only bindings in `vitest.config.ts` | canned `TranscriptResult` values by video id; deterministic embeddings and canned summaries; an in-memory vector store |
| `WORKFLOW_FAKE` | test-only binding in `vitest.config.ts` | instance id → `active` \| `gone` \| `missing`, a default for unknown ids, and the ids whose `create()` should throw. `lib/workflows.ts` `ingestLauncher(env)` is the only path to `INGEST_WORKFLOW`; it selects this fake when set and otherwise wraps the binding, folding the engine's statuses into those three (owner decision 2026-09-11) |
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
those concepts were removed on 2026-09-10. Fencing runs against channel state changes: removed on 2026-09-11. A
separate outcome family for account-level provider failures, run-level failure codes, and a failed-runs attention
count: folded into the one attempt rule and the pre-flight gate the same evening.
Vectorize deletion when a channel is declined (PRD §6: not required; eligibility excludes the channel). A Queue or
any binding beyond the three above.

## 7. Acceptance criteria

1. First approval and the owner's on-demand start each create one run row with its selected run-episodes and one
   Workflow instance per selected episode, and Start answers with the run; a second start while a run is open is
   409 and creates nothing; a start with nothing new and nothing pending records an empty `completed` run and moves
   `last_checked_at`; a start while YouTube does not answer still launches every persisted pending episode and
   answers 200 with that run, leaving `last_checked_at` alone, and with nothing pending records an empty
   `completed` run and answers 502; re-approving a declined channel that had been approved before starts
   nothing.
2. Under `wrangler dev` with the DownSub key in `.dev.vars`, an approved channel with captioned recent videos gets
   its episodes `available` with chunk counts set, vectors present in the real index, and structured summaries
   stored; a video without captions published this week stays `pending CAPTIONS`; one under three minutes is
   `skipped SHORT` with nothing stored; DownSub's `/status` shows one credit per attempted video and `GET /catalog`
   reports it; the run closes `completed` when the last instance reports.
3. Declining the channel mid-run stops nothing: the run finishes and closes `completed`, the episodes it published
   after the decline are stored, none of them appears in any reader's digest, channel history, or chat while the
   channel is declined, the owner sees all of them on the channel's episodes throughout, and readers see all of them
   after re-approval, which leaves `approved_at` alone and starts no run.
4. A transport failure leaves the episode `pending` with `attempt_count` 1, the next run reattempts it, and the
   third failure makes it `failed`; a transcript over the size ceiling makes it `failed TRANSCRIPT_TOO_LARGE` on
   the first fetch with `attempt_count` 1; the owner's Retry returns it to `pending` and starts a one-episode run
   whose only run-episode is that video, leaving its siblings' summaries untouched.
5. With the DownSub key pointed at an exhausted account, the affected episodes read `pending PROVIDER_LIMIT`, no
   attempt is counted, the run closes `completed` with those rows `waiting`, and the next tick launches nothing until `/status`
   shows credits, then resumes them. Verified with the fake; confirmed by hand the first time it happens for real.
6. With a wrong key, the pre-flight check launches nothing from any start point: cron skips the tick, Start
   answers 502 naming the rejected key with no run recorded, approve still approves and leaves the channel
   "approved, never started", retry leaves the episode `pending` with no run, and `GET /catalog` reports
   `transcripts.status` as `auth_failed`; an instance that meets a 401 after the check counts one attempt on its
   episode like any other error; fixing the key lets the next tick run and picks every episode up.
7. `wrangler dev --test-scheduled` plus a request to `/__scheduled` starts runs for approved, unpaused channels
   only, skips paused ones, reconciles before selecting, numbers its instances across channels with start delays of
   3 s apart, and `wrangler.jsonc` schedules it every 6 hours. A tick on a channel with nothing new and nothing
   pending records an empty `completed` run, moves `last_checked_at`, and leaves the channel selectable at the next
   tick; one whose feed cannot be read still relaunches its pending episodes, including one that has left the feed,
   with `last_checked_at` unmoved, and records an empty run only when nothing is pending.
8. The first-approval run starts while the channel is system-paused for having no followers.
9. The first cron after approval imports no feed entry published before the channel's `approved_at`; a new upload
   after it is imported. After an initial import of five from a fifteen-entry feed, the other ten exist nowhere in
   the Registry, not as episodes and not as run-episodes, and the first scheduled run over the same feed neither
   selects nor creates them. A channel for which no run has yet selected an episode gets an `initial` run from Start or
   cron instead, importing the newest `initial_import_count` entries whatever their dates, even after empty runs
   were recorded for a feed that could not be read.
10. A captionless video re-checked at or after 48 hours is fetched again before being `skipped NO_CAPTIONS`; a
    non-English video is `skipped NON_ENGLISH`; a live stream waits and then skips the same way.
11. Every structured summary's takeaways carry `startSec` where the model gave a timestamp, and the digest links them.
12. The digest selects and orders by `summaryAvailableAt`: a video published a month ago and summarised today
    appears in today's digest; reading it does not move it; two episodes that became available a second apart list
    newest availability first whatever their publication dates.
13. A related-lookup failure still publishes the summary with `related: []`.
14. A run-episode whose instance is missing or errored reconciles to `failed WORKFLOW_LOST` at the next tick once
    the run is an hour old, the episode's attempt count goes up by one, the run closes `completed`, and a write from
    a stale instance against a closed run is refused. A run with one rate-limited row and four published episodes
    closes `completed`; the rate-limited episode carries one attempt and its four siblings stay `available`. The
    catalog's `lastSuccessfulIngestionAt` follows the channels' `last_ingested_at`.
    "Approved, never started" reads only when the channel has no run row.
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
  count-down close, the run gate, the definition of a new feed entry, the one attempt rule and the pre-flight gate,
  the stagger,
  reconciliation at each cron tick with no age window, and the removal of every fencing sentence.
- **Catalog:** decline no longer bumps anything; a run in flight finishes.
- **Data & schema conventions:** the one owner-approved drop, migration `0002_drop_lifecycle_version.sql`.
- **API shape and Screens:** `lifecycleVersion` leaves `ChannelManagement`, `IngestionRun`, and the owner detail
  header; `GET /catalog`'s `lastSuccessfulIngestionAt` is computed from the channels' `last_ingested_at`, and its
  `transcripts` block carries the pre-flight check's answer beside the credits.
- **Testing:** the fence bullets become the run-gate and decline-finishes bullets.
- **Open decisions:** the Workers plan and the reconciliation window are decided.
- **PRD** §4.1, §4.2, §5.1, §5.3, §7, §8, and §9 carry the same changes; `channel-simplification.md` §3.1, §3.3,
  §3.4, §5, §7, and §9 and `home-read-experience.md` lose their fence sentences.

Still to apply with the code, per plan step: `EpisodeSummary.takeaways` as `{ text, startSec }[]` and
`summaryAvailableAt` on episodes (Step 3), `transcripts.remainingCredits` on the catalog (Step 7), PRD §4.2 and §4.4
wording for the digest basis (Step 9).
