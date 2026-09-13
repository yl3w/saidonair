# Feature spec — M3 Ingestion

**Written:** 2026-09-08. **Revised:** 2026-09-12 after the functional review and owner walkthrough.
**Status:** approved for implementation. Implements PRD §10 M3. Plan: `docs/specs/m3-ingestion-plan.md`.

The 2026-09-12 revision replaces the earlier hybrid run model. Channel ingestion is RSS discovery only; episode
processing and recovery are independent of channel runs, channel status, and channel pause. Every episode Workflow
is represented by one `episode_ingestion_attempts` row. Every unfinished, non-deterministic episode condition gets
one 48-hour recovery window, including provider, transcript-size, AI, Vectorize, and lost-Workflow failures.

**Starting over (owner decision 2026-09-12).** The Registry schema, the Registry DO's store modules, and the API contract are redesigned from scratch to this model rather than evolved under compatibility rules: the Registry's `0001_init.sql` is rewritten a second time before first deployment, `0002_drop_lifecycle_version.sql` is deleted, there is no `0003`, local Durable Object state is wiped, and no shared schema, reader, or route keeps a legacy table, column, or enum value alive. The User DO and its migration are untouched. Neither an additive-only nor a frozen-file rule applies; both were withdrawn on 2026-09-12 (PRD §5.4). The schema lands with `docs/specs/api-reference-plan.md` Step 4 and is PRD §5; this plan's Step 4 adds the ingestion writes on top.

Transcripts still come only from DownSub's API. An earlier InnerTube spike was removed after Cloudflare egress was
bot-checked; the code survives only on the throwaway branch `spike/transcript-remote`.

## 1. Summary

First approval, Owner Start, and the channel discovery cron fetch RSS for an approved channel and record a completed
discovery run. A successful feed read creates only previously untracked episodes, each with immutable
`discovered_by_run_id`, then immediately starts its first processing attempt. A run reports whether the feed was read
and how many episodes were discovered; it does not wait for or report episode outcomes.

The independent episode recovery cron finds unfinished episodes whose `next_attempt_at` is due, regardless of whether
their channel is approved, paused, declined, or later requested again. Owner Retry uses the same attempt path and,
when pre-flight permits work, resets that episode's 48-hour window. Each attempt fetches the transcript, classifies it, chunks it, writes a staged
Vectorize generation in `shared-catalog`, verifies the full generation, generates the shared summary, and only then
publishes it. First publication becomes `available`; replacement keeps the existing summary and active vectors
readable until the new generation succeeds.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Unit of execution and history | **A channel run is one completed RSS discovery check. An episode attempt is one Workflow instance.** New episodes keep the run id that discovered them. First processing, scheduled recovery, and Owner Retry all write `episode_ingestion_attempts`; there is no run-episode table. | Discovery answers “what did this feed check find?” Attempts answer “what happened while processing this episode?” Neither history pretends to own the other. |
| Where transcripts come from | **DownSub, behind one contract.** `TranscriptSource.fetch(videoId)` returns a `TranscriptResult`: segments when an English track exists, `durationSec`, `isLive` (live or upcoming), and `captionStatus` of `english`, `none`, or `non_english`; or it throws a `TranscriptError` for a provider failure. Tests select a canned fake with the test-only `TRANSCRIPTS_FAKE` binding; everything else uses the DownSub adapter. | The source is the thing most likely to change again. Ingestion must not know which one is in use, and a replacement is one file behind the seam. |
| DownSub specifics | `GET https://api.downsub.com/download?url=<watch URL>` with the `DOWNSUB_API_KEY` secret. `state` `subtitles_found` → pick a track and fetch its **VTT**, and if the chosen track parses to zero usable cues, report `captionStatus: "none"` exactly as if no track existed, since an empty caption file is no captions in every sense a reader cares about (decided 2026-09-11); `no_subtitles` → `captionStatus: "none"`; `error` → `TranscriptError("UNPLAYABLE", playabilityReason)` unless the body's live/upcoming metadata says the video is waiting, in which case a result with `isLive: true` is returned for classification. HTTP 401 → `PROVIDER_AUTH`, 403 → `PROVIDER_LIMIT`, 429 → `PROVIDER_RATE_LIMIT`, other non-2xx → `PROVIDER_HTTP`, unparsable → `PROVIDER_PARSE`. | Verified 2026-09-08 with a trial key: synchronous, ~0.8 s when captions exist, 1 credit per video that has or lacks captions, 0 for errors and file downloads, fresh uploads (1–2 h old) served. Error states are slow (17–57 s), so the step timeout is generous. |
| Track choice | English-first: a manual `en`/`en-*` track, else `en_auto`/`en-*_auto`; if tracks exist but none is English, return `captionStatus: "non_english"` without downloading anything. The DownSub `code` field decides; labels are unreliable ("undefined (auto-generated)" appears). | Summaries and chat are English; an English auto-caption beats a human caption in another language. There is no non-English or translation fallback. |
| Transcript size ceiling | The transcript step serialises at most 700 KB of segments. `TRANSCRIPT_TOO_LARGE` finishes the current attempt but remains recoverable until the same 48-hour deadline as every other unfinished condition. | Workflows cap a step result at 1 MiB. A future transcript or provider response may change, so size is not a special terminal case. |
| Summary in M3 | **Yes.** `available` requires a stored summary (PRD §4.2, the `episodes` CHECK), so the summarize step is in this milestone. M4 keeps chats, retrieval, citations, and preferences. | Without it no episode could ever be `available` and the digest would stay empty after M3. |
| Publishing without a gate | Summaries publish automatically after JSON validation, one retry, and the raw-text fallback. No manual approval, no quality review. | Owner decision 2026-09-10. A personal tool with a trusted audience; the owner retries an episode if a summary is poor, which Retry permits from `available` (see Owner episode actions). |
| Related episodes | Optional enrichment. Each embedding step returns, beside its vectors, the running sum of those vectors and their count; the related step averages the sums into the episode's centroid, queries `shared-catalog` with it, excludes the episode's own `videoId`, deduplicates to at most five `available` videos, and stores the ids in `related_video_ids_json`. A failed lookup or no qualifying result stores `[]` and publication proceeds. | Related suggestions must never prevent delivery of the summary. The sum is 768 numbers, so the centroid needs no vector to outlive its upsert step. Display filters titles to the reader's eligible channels and omits an empty section. Owner decision 2026-09-10. |
| Which channels discovery touches | Scheduled discovery selects `status = 'approved'`, `paused_by IS NULL`. First approval and Owner Start ignore pause. Declined and requested channels get no new discovery. | Channel approval and pause govern only whether the feed should be checked for new episodes. |
| Which episodes discovery creates | The first successful read is `initial` and creates the newest `initial_import_count` entries. Later reads are `scheduled` and create untracked entries published after first approval. Each new row gets immutable `discovered_by_run_id`; entries outside the selection are not remembered. A completed run records `feed_status = read | unavailable` and `discovered_count`, including zero. | A discovery run remains a truthful, bounded feed history. Existing episodes never need RSS again. |
| Fresh uploads without captions | `captionStatus: none` finishes the attempt `waiting CAPTIONS` and leaves publication `pending`. Recovery re-fetches every six hours until success or the episode's recovery deadline. At 48 hours one final due attempt is made; if captions are still absent, publication becomes `failed INGESTION_TIMEOUT` with `CAPTIONS` copied from that attempt into `failure_detail`. | Captions often lag publication, but elapsed time alone does not prove permanent absence. |
| Shorts, live streams, premieres | Under **180 seconds** is immediately `skipped SHORT`. Live or upcoming finishes the attempt `waiting LIVE_OR_UPCOMING` and stays `pending` within the 48-hour window, then fails `INGESTION_TIMEOUT` with that reason in `failure_detail`. Known live metadata wins over `UNPLAYABLE`; otherwise `UNPLAYABLE` is an immediate deterministic skip. | Shorts and unplayable videos have definitive product outcomes; a live stream may later become processable. |
| Non-English videos | `captionStatus: "non_english"` → `skipped NON_ENGLISH`. There is no channel-level consequence: a channel whose videos are all non-English is an approved channel with `episodes.available = 0`, which the owner can pause or decline. | Summaries, embeddings, and chat are English. Owner decision 2026-09-08; the channel code it once implied was removed on 2026-09-10 with every other channel failure code. |
| Universal recovery rule | Every unfinished, non-deterministic condition uses the episode's 48-hour recovery window: captions, live/upcoming, provider limits, provider/auth/rate/parse failures, oversized transcripts, embedding, Vectorize, summary, and lost Workflows. Due episodes retry every six hours. Attempt count is diagnostic only. At the deadline, unfinished publication becomes `failed INGESTION_TIMEOUT`, the latest attempt's reason copied into `failure_detail`. **Reasons live on attempts only** (owner decision 2026-09-12): an attempt finishes `waiting` or `failed` with its code, and the episode row carries no waiting or technical code during recovery; the schema has no `waiting_code` column, and `failure_code`/`failure_detail` are written only at the timeout. There is no `waiting` count on channels or the catalog (2026-09-12 review); wait reasons appear on episode rows only. | A user gets one predictable recovery promise instead of different ladders for different infrastructure outcomes. |
| Pre-flight gate | DownSub `/status` gates episode attempt launches only. Discovery always reads RSS. Every blocked start, automatic or owner, records one finished `blocked` attempt with no Workflow and `PROVIDER_AUTH` (rejected key) or `PROVIDER_LIMIT` (zero credits) as its outcome code (2026-09-12 review, replacing the no-row rule for automatic blocks). Before the deadline an automatic block advances `next_attempt_at`; at the deadline it settles recovery with that reason. Owner Retry returns its blocked attempt without touching recovery. An unreachable status does not block. Blocked attempts never increment `attempt_count`. | Provider health is relevant to transcript work, not to learning that a new episode exists. Every start leaves durable evidence, so an episode blocked for its whole window still times out with its real reason, and the rows are bounded: at most nine per episode, one per start inside its 48-hour window. |
| Owner episode actions | Retry and Skip are independent of channel status and discovery runs. Retry accepts any episode state and is refused (409 `INVALID_STATE`) only while that episode has a running attempt. When that attempt is older than one hour, Retry first asks the launcher for its instance and reconciles inline exactly as the sweep does (2026-09-12 review): active means the refusal stands; gone or missing finishes the attempt `WORKFLOW_LOST` and the Retry proceeds, so a dead instance never holds Retry until the next recovery tick. When pre-flight permits, it resets the 48-hour window and starts immediately; a blocked Retry leaves episode/recovery state unchanged. A non-available episode returns to pending publication; an available episode starts replacement while current content stays active. A deterministic `SHORT`, `NON_ENGLISH`, or `UNPLAYABLE` result during replacement finishes the attempt `skipped`, ends the recovery, and leaves the episode available; only a verified new generation replaces readable content (2026-09-12 review). Skip remains `failed → skipped OWNER`. Neither action writes a channel or discovery-run row. | Episode repair remains possible after a channel is paused or declined and never changes channel history. |
| Takeaways carry timestamps | Each takeaway is `{ text, startSec }`, `startSec` null when the model gives none or it falls outside the episode. The prompt sends `[h:mm:ss]` markers and asks for one per takeaway; `mm:ss` is accepted for episodes under an hour. `EpisodeSummary.takeaways` in `packages/shared` changes from `string[]`; the web renders a `youtu.be/<id>?t=<s>` link per takeaway. No legacy data exists, so no normalisation of string takeaways is needed. | The digest's most useful click is "take me to that moment". Owner decision 2026-09-08; the legacy rule of 2026-09-10 became moot with the pre-production reset. |
| Digest basis | Digest selection and ordering use the episode's first `processed_at`, exposed as `summaryAvailableAt`: 24 hours by default, seven days when expanded, ordered strictly by `processed_at` descending, `video_id` as the only tiebreak so the order is stable. Reads, refollows, re-approval, and enrichment never reset it; channel history stays publication-ordered. | Owner decision 2026-09-10, order confirmed 2026-09-11. A video published a month ago but summarised today belongs in today's digest. Episodes that became available within the same minutes, an initial import for instance, list in the order their summaries landed: independent instances finish milliseconds apart, so a publication tiebreak on equal timestamps would never fire, and the owner chose strict availability over a bucketed order. |
| Channel timestamps | `last_checked_at` moves inside `recordDiscovery` only when a channel feed was actually read. There is no `channels.last_ingested_at` column. The API derives each channel's `lastIngestedAt` as `MAX(episodes.processed_at)` for that channel. A retry that first publishes an episode therefore advances the displayed value through episode data; replacing an already available summary does not, because `processed_at` is intentionally preserved. | Retry can publish or replace an episode without mutating a channel record. “Last ingested” continues to mean the newest first availability, while “Last checked” remains strictly about the feed. |
| Catalog health figure | `GET /catalog.lastSuccessfulIngestionAt` is `MAX(episodes.processed_at)` across the Registry. | The figure means “when was a summary first made available anywhere” and no longer depends on a denormalized channel timestamp. |
| Step granularity | One `step.do` per external call inside an attempt: the stagger sleep, transcript, each embedding batch, each upsert batch, retrieval verification, each summary map and reduce call, the related query, and each Registry write. Steps return bounded serialisable values. | Workflows cap a step result at 1 MiB and retry per step. |
| Verify step | After the last upsert, `getByIds` is called in batches of the API's per-call ceiling until every expected id is present. The step's retry policy absorbs Vectorize's asynchronous processing; only after those retries does a missing id count as `VECTORIZE_INCOMPLETE`. | Vectorize applies an upsert asynchronously and an immediate read can miss vectors that are on their way. The recovery window handles a genuinely incomplete generation; `available` is never set on an accepted upsert alone. |
| Channel independence | Pausing or declining stops future discovery selection only. Recovery and Owner episode actions continue for every previously discovered episode. | A channel decision controls future catalog growth, not whether already accepted work can finish. |
| Attempt gate | An attempt write is accepted only while its own ledger row is running and its id matches the episode's current recovery attempt. | A stale Workflow cannot publish after reconciliation or a later attempt. No channel state is consulted. |
| Publishing | Vector ids are `${videoId}:${generationId}:${chunkIndex}`. An attempt writes and verifies a staged generation. First publication atomically stores the summary and activates it; replacement atomically swaps the summary and active generation while preserving `processed_at` and read receipts. **One generation rule** (2026-09-12 review): the index holds one active generation per episode plus whatever an attempt is staging right now. After activation the attempt deletes the previous generation's ids, which `completeAttempt` returns with their chunk count; an attempt that finds an abandoned staged generation from the episode's last attempt deletes it before staging its own, using the staged chunk count that attempt recorded when embedding began. Retrieval keeps its channel filter and, in the same Registry check that validates availability and eligibility, drops any vector whose generation, parsed from its id, is not the episode's active one, fetching more candidates to cover the loss. No generation metadata index is needed. | Partial writes expose nothing, and failed replacement cannot damage readable content. Deletion keeps the index bounded and free of duplicate passages. A per-episode generation filter would need one id per eligible episode under Vectorize's 2 KB filter cap, many queries where the channel filter needs one. The retrieval check covers the window between activation and cleanup, or a cleanup that failed. |
| Crons | Discovery: `0 */6 * * *` UTC. Recovery: `30 */6 * * *` UTC. Both run every six hours and are exercised with `wrangler dev --test-scheduled`. | Separate schedules make ownership explicit while keeping one product cadence. |
| Launch throttle | The attempt starter numbers the attempts it launches in one batch, a discovery's new episodes or one recovery tick across every channel, and passes `startDelaySec = k × 3` to the k-th; the instance's first step sleeps that long. An owner Retry is a batch of one, delay 0. A 429 during the transcript step is retried by the step with backoff; one that outlasts the retries finishes the attempt `PROVIDER_RATE_LIMIT` and the episode recovers in six hours. | Owner decision 2026-09-11, restored 2026-09-12 after the revision dropped it without a decision. One tick can start dozens of instances in the same second against a metered provider; the old per-channel run spread them for free, and the attempt model must spread them deliberately. One parameter and one sleep step, no binding. |
| Reconciliation | Before recovery selection, running attempts older than one hour are checked. Gone or missing instances finish `WORKFLOW_LOST` on the attempt and stay eligible inside the same 48-hour window. Owner Retry runs the same check inline on a running attempt older than one hour. Discovery runs require no Workflow reconciliation. | Only episode attempts own long-running work. |
| On-demand start | `POST /channels/:id/runs` (owner, approved) performs one discovery check now, ignoring pause. It records a completed run with `feed_status = read | unavailable` and `discovered_count`; feed failure returns 502 after the unavailable history is stored. New episodes start attempts independently. | Start means “check this feed now,” not “retry this channel's episodes.” |
| Long episodes | **Map-reduce over 45-minute sections.** Each section is summarised with its own timestamped takeaways; one final call condenses the section summaries into the episode's summary. An episode with a single section skips the reduce step, so short videos cost one call. | Owner decision 2026-09-08. The model reads 24,000 tokens per call, about 1 h 45 min of speech; sampling would leave long-episode takeaways pointing only at sampled minutes. Cents per long episode. |
| Catalog credits and key status | `GET /catalog` gains `transcripts: { remainingCredits, status }` from DownSub's `/status`, fetched at most once every five minutes per isolate with a two-second timeout: `status` is `ok`, `auth_failed` on a 401, or `unreachable` when the call fails, times out, or the fake source is in use, and `remainingCredits` is `null` in the last case. The catalog response never fails because of it. Episode pre-flight reads the same wrapper; discovery does not. | The owner sees the balance and a rejected key where the other health numbers are, and Home never waits on a third party. |
| Latest run on catalog rows | `management.latestRun` exposes feed status and discovered count. Copy is “N episodes discovered,” “nothing new,” or “feed unavailable.” Episode outcome counts come from episode state, never from a discovery run. | The row says exactly what the last feed check did without coupling it to later processing. |
| Workers plan | **Workers Paid**, confirmed 2026-09-11. | Parsing large transcript responses and chunking long episodes require the Paid CPU budget. |
| Embedding model id | `@cf/baai/bge-base-en-v1.5`, 768 dimensions. | The deployed model id carries `.5` (it is also Vectorize's preset name). |

## 3. Pipeline

```
channel discovery (first approval · discovery cron · Owner Start) ──► Worker handler
   validate       channel is approved; scheduled selection also requires not paused
   fetch-feed     rss.fetchChannelFeed(channelId)
   select         first successful read: newest N · later reads: new entries after first approval
   write          completed ingestion_run with feed_status and discovered_count
                  create selected episode rows with immutable discovered_by_run_id
   start          ask the common attempt starter to begin each new episode immediately

episode attempt starter (new episode · recovery cron · Owner Retry)
   validate       episode exists and has no running attempt; never check channel status or pause
   reconcile      Owner Retry only, on a running attempt older than 1 h: ask the launcher; active → 409;
                  gone or missing → finish it WORKFLOW_LOST and continue
   pre-flight     block: finished attempt row `blocked PROVIDER_AUTH | PROVIDER_LIMIT`, no instance;
                  automatic → move next_attempt_at, or settle at the deadline; Owner Retry → return it, recovery untouched
   begin          create episode_ingestion_attempt row `running`; set recovery generation
   launch         INGEST_WORKFLOW.create({ id: attemptId, params: { attemptId, videoId, channelId, startDelaySec } })
                  startDelaySec = k × 3 for the k-th attempt of this batch; 0 for an owner Retry

one Workflow instance per attempt:
   stagger        step.sleep(startDelaySec)
   transcript     source.fetch(videoId)                    → TranscriptResult | TranscriptError
   classify       deterministic SHORT / NON_ENGLISH / UNPLAYABLE → publication: episode skipped;
                  replacement: attempt skipped, recovery ends, episode stays available unchanged
                  any unfinished condition → finish the attempt with its reason (waiting CAPTIONS | LIVE_OR_UPCOMING |
                  PROVIDER_LIMIT, or failed <technical code>) and move the episode's next due time; the episode row
                  itself takes no reason; at the 48-hour deadline publication → failed INGESTION_TIMEOUT
   chunk          lib/chunk.ts inline, not a step: pure and deterministic, so a replay recomputes the same chunks
   discard        when the episode's last attempt left a staged generation that never became active:
                  vectors.deleteByIds(ns, its ids from 0 to its recorded staged count)
   stage          Registry.markStaged(attemptId, chunkCount): records how many ids this attempt will write
   embed[i]       ai.embed(chunk texts, batch of ≤ 20)     → vectors + running sum (vectors stay in this step)
   upsert[i]      vectors.upsert(shared-catalog, generation ids, vectors, metadata)
   verify         vectors.getByIds(ns, ids) in batches until every id is present; step retries absorb the async lag
   summarize[s]   ai.summarize(section s) per ≤45-minute section       (invalid JSON: one retry, then fallback)
   reduce         ai.reduce(section summaries) when there is more than one section
   related        centroid query, exclude own videoId → up to 5 distinct available videos; failure → []
   publish        Registry.completeAttempt(attemptId, generation, chunkCount, summary, related)
                  publication: set available, chunk_count, and processed_at once
                  replacement: atomically swap summary, chunk_count, and active generation, preserve
                  processed_at/read receipts; returns the previous generation and its chunk count
   cleanup        after a replacement: vectors.deleteByIds(ns, previous generation ids 0..count−1); a failure
                  here is logged, publication stands, retrieval's generation check hides the leftovers

recovery cron every 6 hours:
   reconcile      running attempts older than 1 hour; missing/gone → WORKFLOW_LOST
   expire         due publication at/after deadline gets one final attempt; if unfinished → INGESTION_TIMEOUT
   select         every due recovery, independent of channel status/pause and RSS
   start          common attempt starter
```

Transport retries inside a Workflow step use exponential backoff. Exhausting those retries finishes this attempt and
records the reason; it does not make the episode terminal before its recovery deadline. A `TranscriptError` carries
its reason across the step boundary. The transcript step timeout is two minutes, AI steps three minutes, and the
Vectorize verify step retries asynchronous visibility before reporting `VECTORIZE_INCOMPLETE`.

There is no approval path in this pipeline. Requesters follow a channel at the moment they request it
(`channel-simplification.md` §3.2), so nothing is handed off when it becomes readable.

### 3.1 Chunking (`lib/chunk.ts`, pure)

The hybrid strategy from AGENTS.md: group consecutive segments to about 60 seconds; split a group on segment
boundaries when it exceeds ~400 tokens (`chars / 4`); overlap consecutive chunks by one or two segments; never emit
more than 480 tokens; a single segment over the cap is split on sentence, then word boundaries. Output:
`{ index, text, startSec, endSec }[]`. Vector id `${videoId}:${generationId}:${index}`; metadata
`{ videoId, channelId, generationId, channelTitle, title, startSec, endSec, text, publishedAt }` with `channelId` and
`videoId` always present; `generationId` is carried for diagnosis and is not a filter field.

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

Content state and recovery state are distinct. Channels carry neither.

| Outcome | Column | Values | Owner action |
|---|---|---|---|
| Recovering publication | `status = pending`, `recovery_mode = publication` | Any non-deterministic unfinished reason; `next_attempt_at` and one 48-hour deadline | Automatic retry; a permitted Owner Retry restarts the window |
| Recovering replacement | `status = available`, `recovery_mode = replacement` | Same reasons; current summary and active generation remain readable | Automatic retry; a permitted Owner Retry restarts the window |
| Deterministic skip (publication) | `status = skipped`, `skip_reason` | `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`, or `OWNER` | Retry reopens publication |
| Deterministic result during replacement | `status = available`, recovery cleared | The attempt is `skipped SHORT`, `NON_ENGLISH`, or `UNPLAYABLE`; summary, active generation, `processed_at`, and receipts unchanged (2026-09-12 review) | Retry starts replacement again |
| Timed-out publication | `status = failed`, `failure_code = INGESTION_TIMEOUT` | `failure_detail` and latest attempt preserve the last underlying reason | Retry or Skip |
| Published | `status = available`, `processed_at`, `active_vector_generation` | Full vector generation verified and summary stored | Retry starts replacement |

`attempt_count` increments for attempts that actually launch, never for a `blocked` one, and remains diagnostic;
it never controls terminal state. Reasons live on attempts only (owner decision 2026-09-12): an attempt finishes `waiting` with `CAPTIONS`,
`LIVE_OR_UPCOMING`, or `PROVIDER_LIMIT` as its outcome code, or `failed` with a technical code (provider,
transcript-size, embedding, Vectorize, summary, or `WORKFLOW_LOST`). During recovery the episode row carries no
waiting or technical code; the rewritten schema has no `waiting_code` column, and `failure_code` and
`failure_detail` are written once, at the timeout, as `INGESTION_TIMEOUT` and the latest attempt's reason. The
owner reads the reason from the latest attempt; there is no `waiting` count (2026-09-12 review). A successful result clears the active recovery fields. A replacement that exhausts 48 hours
clears its recovery fields and records the final attempt, but the episode remains available.

`episode_ingestion_attempts` is the only episode execution ledger. The rewritten `0001` creates it with `attempt_id`,
`video_id`, unique nullable `workflow_id`, trigger (`channel_ingestion | scheduled_recovery | owner_retry`), nullable requester,
recovery mode, generation id, staged chunk count (set when embedding starts, so the next attempt can delete an
abandoned generation), status (`running | available | waiting | failed | skipped | blocked`), outcome code,
detail, and timestamps. Automatic provider blocks create no row; Owner Retry blocks do. The latest attempt appears
only in the owner episode projection.

`episodes.discovered_by_run_id` points to the completed discovery run that created the episode. There is no
run-episode table and no `owner_retry` run kind; the rewritten `0001` (plan Step 4) has neither. Discovery runs
expose `feed_status` and `discovered_count`, never episode processing counts.

### 3.4 Waiting, failure, and recovery

| Situation | Episode and channel behaviour | Next action |
|---|---|---|
| No captions, live/upcoming, provider block, technical error, oversized transcript, or lost Workflow before deadline | Publication stays pending or replacement stays available; the attempt records the reason and the episode's next attempt moves | Recovery cron retries in six hours |
| Same at the 48-hour boundary | Make the final due attempt when pre-flight permits; a provider block records its `blocked` attempt and settles immediately | Success publishes; otherwise publication fails `INGESTION_TIMEOUT`, replacement stops and stays available |
| `SHORT`, `NON_ENGLISH`, or `UNPLAYABLE` during replacement | The attempt finishes `skipped` with the reason and recovery ends; the episode stays available with its current summary and generation | Nothing automatic; the owner reads the reason on the latest attempt and may Retry again |
| Automatic pre-flight block before deadline | A finished `blocked` attempt with `PROVIDER_AUTH` or `PROVIDER_LIMIT` is recorded and the next attempt moves; `attempt_count` is unchanged | Recovery cron checks again in six hours |
| Owner Retry blocked by pre-flight | A finished blocked attempt is recorded; content remains unchanged | Fix provider state and Retry again, or wait for scheduled recovery |
| First approval with no followers | The channel is system-paused at approval, and the initial import still runs once | Scheduled runs wait for a follower |
| Channel is paused or declined while an episode recovers | Discovery stops; episode recovery continues and can publish. Reader eligibility still follows channel status | Re-approval restores reader access; it does not restart or reset episode recovery |
| Workflow is missing or gone after one hour | Attempt finishes with `WORKFLOW_LOST`; episode remains recoverable within its existing deadline | Recovery cron starts another due attempt; an Owner Retry meanwhile reconciles it inline and starts at once |
| Feed read fails | Completed discovery run records `feed_status = unavailable`, zero discovered, and leaves `last_checked_at` unchanged | Later discovery retries the feed; episode recovery is unaffected |
| Feed read succeeds with nothing new | Completed discovery run records `feed_status = read`, zero discovered, and moves `last_checked_at` | None |
| Related lookup fails | Summary publishes with `[]` | None |
| Cleanup of a previous or abandoned generation fails | Publication stands; retrieval's generation check hides the leftover vectors | The episode's next attempt deletes them; nothing to do otherwise |

Within one attempt, any wait, skip, or exhausted technical step ends that attempt. Only the episode recovery record
decides what happens next. Discovery history never changes afterward.

### 3.5 Selection contract

The adapter and the fake both return the full `TranscriptResult`: duration, live/upcoming flag, and `captionStatus`,
with English segments when present. `captionStatus: "english"` always comes with at least one segment: a chosen
English track whose file yields no usable cues is reported as `"none"`, so the classify step never continues with
an empty transcript and the `chunk_count > 0` requirement on `available` can never be met by accident. Known
live/upcoming state is classified before duration and caption checks, including provider `error` bodies carrying
that state; other errors throw. For non-live results: known duration below 180 seconds skips, non-English captions
skip, no captions remain recoverable, and English captions process. Unknown duration must not imply a short video;
use the transcript's end for timestamp bounds when possible, otherwise keep uncertain timestamps null. Test the
exact 180-second and 48-hour boundaries.

## 4. Configuration

| Name | Kind | Value |
|---|---|---|
| `AI` | binding, `remote: true` | Workers AI |
| `VECTORS` | binding `vectorize`, index `media-rag`, `remote: true` | created once by the owner (AGENTS.md → One-time setup) |
| `INGEST_WORKFLOW` | binding `workflows`, class `IngestWorkflow` | one instance per episode attempt, id `attemptId` |
| `DOWNSUB_API_KEY` | secret | `wrangler secret put` when deployed; `.dev.vars` locally |
| `TRANSCRIPTS_FAKE`, `AI_FAKE`, `VECTORIZE_FAKE` | test-only bindings in `vitest.config.ts` | canned `TranscriptResult` values by video id; deterministic embeddings and canned summaries; an in-memory vector store |
| `WORKFLOW_FAKE` | test-only binding in `vitest.config.ts` | instance id → `active` \| `gone` \| `missing`, a default for unknown ids, and the ids whose `create()` should throw. `lib/workflows.ts` `ingestLauncher(env)` is the only path to `INGEST_WORKFLOW`; it selects this fake when set and otherwise wraps the binding, folding the engine's statuses into those three (owner decision 2026-09-11) |
| `YOUTUBE_FEEDS_FAKE` | test-only binding, already present | grows from `channelId → title` to `channelId → { title, entries[] }`, keeping the string form, so tests can drive selection and the 48-hour boundary |
| `triggers.crons` | wrangler | `["0 */6 * * *", "30 */6 * * *"]`: discovery, then episode recovery |

`remote: true` lets local `wrangler dev` reach the real Workers AI and Vectorize, which have no local simulation,
while Durable Objects and the Workflow stay local. Tests never reach them: the fakes are the only seam that works
end to end in the pinned pool.

## 5. Dependencies

None new. Workflows, Workers AI, and Vectorize are Cloudflare bindings. DownSub is an HTTPS API called with `fetch`.

## 6. Out of scope

Chats, retrieval for chat, preferences (M4). A retention policy. Re-embedding when the model changes. Non-English
channels (skipped per video, not processed). Any channel-level failure state, channel retry, or automatic follow:
those concepts were removed on 2026-09-10. Discovery-run episode membership and outcome aggregation: superseded by
episode provenance plus the unified attempt ledger on 2026-09-12. A separate terminal rule for technical failures,
oversized transcripts, missing captions, or live streams: superseded by the universal 48-hour recovery window.
Vectorize deletion when a channel is declined (PRD §6: not required; eligibility excludes the channel). A Queue or
any binding beyond the three above.

## 7. Acceptance criteria

1. First approval and Owner Start each perform one RSS discovery check. A successful read records a completed run,
   creates only selected untracked episodes with immutable `discovered_by_run_id`, and starts one independent
   attempt per new episode. Nothing new records zero discovered; an unavailable feed records `feed_status =
   unavailable`, leaves `last_checked_at` unchanged, and returns 502 for Start. Re-approval starts no discovery.
2. Under `wrangler dev` with the DownSub key in `.dev.vars`, an approved channel with captioned recent videos gets
   its episodes `available` with chunk counts set, vectors present in the real index, and structured summaries
   stored; a video without captions published this week stays `pending` with its latest attempt `waiting CAPTIONS`;
   one under three minutes is
   `skipped SHORT` with nothing stored; DownSub's `/status` shows one credit per attempted video and `GET /catalog`
   reports it. The discovery run is already complete before those attempts finish.
3. Pausing or declining the channel prevents future scheduled discovery but does not cancel, delay, or reset any
   previously discovered episode's recovery. Recovery can publish while declined; eligibility hides that content
   from readers until re-approval, while the owner can inspect and act on it throughout.
4. Provider, transcript-size, AI, Vectorize, and lost-Workflow outcomes all remain recoverable for 48 hours and retry
   on the six-hour recovery schedule. Attempt count never makes the episode terminal. At the deadline a final due
   attempt is made; unfinished publication becomes `failed INGESTION_TIMEOUT` with the latest attempt's reason in
   `failure_detail`. An exhausted replacement stops but leaves the episode available.
5. Owner Retry works for an episode under any channel status and, when pre-flight permits, resets its 48-hour window; a blocked Retry leaves recovery unchanged. It creates no discovery run,
   writes no channel row, and is refused only while that episode has a running attempt that is under an hour old or
   still active; on an older running attempt whose instance is gone or missing, Retry reconciles it `WORKFLOW_LOST`
   inline and proceeds. Retry on available content
   keeps the old summary, vector generation, `processed_at`, and read receipts until the replacement generation is
   verified and atomically activated, after which the previous generation's vectors are deleted; a replacement
   attempt that classifies `SHORT`, `NON_ENGLISH`, or `UNPLAYABLE` finishes `skipped`, ends the recovery, and leaves
   the episode available and unchanged. Skip works
   `failed → skipped OWNER` under any channel status.
6. A provider pre-flight block never prevents RSS discovery. Every blocked start records one finished `blocked`
   attempt with `PROVIDER_AUTH` or `PROVIDER_LIMIT` and leaves `attempt_count` alone; before the deadline automatic
   processing then schedules another recovery check, and at the deadline it settles recovery with that reason, so an
   episode blocked for its whole window fails `INGESTION_TIMEOUT` with `failure_detail` set. Owner Retry returns its
   blocked attempt.
   `GET /catalog` reports transcript provider status independently.
7. `wrangler dev --test-scheduled` exercises both schedules: `0 */6 * * *` selects approved, unpaused channels for
   discovery; `30 */6 * * *` selects every due episode recovery regardless of channel status or pause, and numbers
   the attempts it starts across every channel with start delays 3 s apart. The latest-run projection and Owner copy
   report discovered count, nothing new, or feed unavailable, never episode outcomes.
8. The first-approval run starts while the channel is system-paused for having no followers.
9. The first successful discovery imports the newest configured count regardless of date. Later discovery imports no
   untracked entry published before the channel's `approved_at`; a new upload
   after it is imported. After an initial import of five from a fifteen-entry feed, the other ten exist nowhere in
   the Registry, and the first scheduled run over the same feed neither selects nor creates them. A channel with no
   successfully discovered episode still uses initial selection after earlier unavailable or empty history.
10. A captionless or live episode is re-fetched every six hours and once at the deadline before failed timeout; a
    non-English episode is immediately `skipped NON_ENGLISH`, and no elapsed-time check alone settles a recovery.
11. Every structured summary's takeaways carry `startSec` where the model gave a timestamp, and the digest links them.
12. The digest selects and orders by `summaryAvailableAt`: a video published a month ago and summarised today
    appears in today's digest; reading it does not move it; two episodes that became available a second apart list
    newest availability first whatever their publication dates.
13. A related-lookup failure still publishes the summary with `related: []`.
14. A running attempt whose instance is missing or gone reconciles to `WORKFLOW_LOST` after one hour, remains in its
    existing recovery window, and rejects later writes from that stale attempt; an Owner Retry on such an attempt
    reconciles it inline and starts instead of waiting for the tick, while an active instance still answers 409. Sibling episodes and discovery
    history are untouched. The catalog's `lastSuccessfulIngestionAt` equals `MAX(episodes.processed_at)`.
    "Approved, never started" reads only when the channel has no run row.
15. The Registry's `0001_init.sql`, rewritten on 2026-09-12 (`api-reference-plan.md` Step 4), applies on a fresh Registry and
    `_migrations` lists `0001_init` alone: no `0002` or `0003`, no `ingestion_run_episodes` table, no `waiting_code`
    or `last_ingested_at` column, no `owner_retry` run kind, no run status or Workflow columns. Its table checks
    reject a replacement recovery on a `pending` row, a half-set recovery window, and a `failed` row without
    `INGESTION_TIMEOUT`. At the end of M3 (plan Step 9) `outcome_code` carries a `CHECK` listing exactly the
    fifteen attempt outcome codes, added once every outcome has run for real. The User DO's migration is unchanged.
16. `pnpm check` green; the coverage in AGENTS.md → Testing exists for lifecycle, attempts, the attempt gate, chunking,
    VTT parsing, summary validation, and the M3 items it lists.
17. AGENTS.md and the PRD carry these decisions (§8).
18. The index holds one active generation per episode: after a replacement the previous generation's ids are gone
    from `shared-catalog`; an attempt that follows a failed one deletes that attempt's staged ids before writing its
    own; retrieval (M4) drops a vector whose generation is not the episode's active one and still fills its
    context; a failed cleanup leaves publication standing.
19. The episode row has no waiting code, and `failure_code` is written only as `INGESTION_TIMEOUT` at the deadline:
    a captionless attempt finishes `waiting CAPTIONS` while the episode row shows only its next attempt time; there
    is no `waiting` count on channels or the catalog; an
    available episode whose replacement attempt waits on credits stays writable and readable.

## 8. `AGENTS.md` and PRD alignment

The accepted documents now share these contracts:

- Starting over: the Registry schema, the Registry DO's store modules, and the API contract are rewritten to this
  model; `0001` rewritten a second time before first deployment, `0002` deleted, no `0003`, no legacy table, column,
  or enum value anywhere.
- Channel runs are completed RSS discovery history with feed status and discovered count. New episodes carry their
  immutable discovery run id; there is no run-episode table.
- The unified episode-attempt ledger owns first processing, scheduled recovery, and Owner Retry. Attempt writes are
  gated by that attempt, never by channel state or a discovery run.
- Discovery and recovery each run every six hours. Discovery respects approved/unpaused selection; episode recovery
  deliberately ignores channel status and pause. Each batch of attempts a start point launches is spaced three
  seconds apart.
- Every unfinished, non-deterministic episode result uses the same 48-hour window. There is no three-attempt terminal
  rule and no special terminal case for transcript size. Publication times out to `INGESTION_TIMEOUT`; replacement
  times out without removing current content. Reasons live on attempts: the episode row carries content state, the
  recovery schedule, and only what its table checks require.
- Owner Retry and Skip are episode actions in every channel status. A Retry that starts work resets the recovery
  window; a blocked Retry does not. Neither changes a channel or run record.
- Vector generations make first publication and replacement safe: only a verified generation paired with a stored
  summary becomes active, and `processed_at` remains the first availability time. The index holds one active
  generation per episode plus what an attempt is staging: cleanup deletes superseded and abandoned generations, and
  retrieval verifies the generation before using any text.
- `lastIngestedAt` and catalog `lastSuccessfulIngestionAt` are derived from episode `processed_at`. There is no stored channel
  ingestion timestamp.
- The detailed implementation work remains in the accompanying plan; these documents describe the target contract,
  not the current implementation state.
