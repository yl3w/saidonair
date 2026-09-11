# Feature spec — M3 Ingestion

**Written:** 2026-09-08, against `main` at `c959cc6`.
**Revised:** 2026-09-10, twice. First after the owner walkthrough: caption and credit waits resume automatically,
summaries publish without a review gate, digest windows use first availability, related episodes are optional
enrichment, and the transcript source reports caption status. Then against `docs/specs/channel-simplification.md`
§12 after that spec merged to `main` at `6e075b1`: channels no longer carry import outcomes, so this document now
describes an episode-level machine. Nothing here is a claim that the implementation is complete.
**Status:** proposed; starts on the owner's go. Implements PRD §10 M3 (shared runs and episodes, RSS, transcripts,
chunking, embeddings, retry fencing) plus the summary step that makes an episode `available`.
Plan: `docs/specs/m3-ingestion-plan.md`.
**Owner decisions already made:** transcripts come from DownSub's API (2026-09-08); cron every 6 hours; captionless
fresh uploads are re-checked for 48 hours; videos under 3 minutes are skipped and live or upcoming ones wait;
non-English captions are skipped; takeaways carry timestamps; DownSub credit exhaustion pauses the run
(2026-09-08). Technical episode failures are retried on three runs before they reach the owner; a channel nobody
follows is paused, and the one run first approval starts ignores that pause; there is no channel-level failure,
retry, or waiting code; readers see an episode's skip reason (2026-09-10, spec §2).
An InnerTube fetcher was built and measured first: it passes from a residential IP and is bot-checked from
Cloudflare's egress in every client tested (30 player calls: 21 `LOGIN_REQUIRED`, 4 hard 403s, 5 OKs on one video).
It was removed rather than kept as a path production never runs; the code survives only on the throwaway branch
`spike/transcript-remote`.

## 1. Summary

Approved channels start producing digest content. The first approval of a channel, an owner's retry of one episode,
an owner's on-demand start, or the six-hourly cron starts one ingestion run per channel as a Cloudflare Workflow. The
run reads the RSS feed, selects the episodes still to do, and for each one fetches the transcript, chunks it, embeds
and upserts the chunks into Vectorize under `shared-catalog`, verifies they are retrievable, generates the shared
summary, and only then marks the episode `available`. Episodes that cannot be summarised for a deterministic
reason are `skipped` with that reason; episodes waiting on captions, a live stream, or transcript credits stay
`pending` with a wait reason; technical failures are reattempted on the next runs and become `failed` for the owner
on the third. The channel's own status never changes because of a run: `requested | approved | declined` is the
owner's answer, and pause is the only run-related flag it carries. Runs are fenced by `lifecycle_version`, which the
owner's withdrawal of an approved channel bumps, so a stale run cannot publish into a declined channel.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Where transcripts come from | **DownSub, behind one contract.** `TranscriptSource.fetch(videoId)` returns a `TranscriptResult`: segments when an English track exists, `durationSec`, `isLive` (live or upcoming), and `captionStatus` of `english`, `none`, or `non_english`; or it throws a `TranscriptError` for a provider failure. Tests select a canned fake with the test-only `TRANSCRIPTS_FAKE` binding; everything else uses the DownSub adapter. | The source is the thing most likely to change again. Ingestion must not know which one is in use, and a replacement is one file behind the seam. |
| DownSub specifics | `GET https://api.downsub.com/download?url=<watch URL>` with the `DOWNSUB_API_KEY` secret. `state` `subtitles_found` → pick a track and fetch its **VTT**; `no_subtitles` → `captionStatus: "none"`; `error` → `TranscriptError("UNPLAYABLE", playabilityReason)` unless the body's live/upcoming metadata says the video is waiting, in which case a result with `isLive: true` is returned for classification. HTTP 401 → `PROVIDER_AUTH`, 403 → `PROVIDER_LIMIT`, 429 → `PROVIDER_RATE_LIMIT`, other non-2xx → `PROVIDER_HTTP`, unparsable → `PROVIDER_PARSE`. | Verified 2026-09-08 with a trial key: synchronous, ~0.8 s when captions exist, 1 credit per video that has or lacks captions, 0 for errors and file downloads, fresh uploads (1–2 h old) served. Error states are slow (17–57 s), so the step timeout is generous. |
| Track choice | English-first: a manual `en`/`en-*` track, else `en_auto`/`en-*_auto`; if tracks exist but none is English, return `captionStatus: "non_english"` without downloading anything. The DownSub `code` field decides; labels are unreliable ("undefined (auto-generated)" appears). | Summaries and chat are English; an English auto-caption beats a human caption in another language. There is no non-English or translation fallback. |
| Summary in M3 | **Yes.** `available` requires a stored summary (PRD §4.2, the `episodes` CHECK), so the summarize step is in this milestone. M4 keeps chats, retrieval, citations, and preferences. | Without it no episode could ever be `available` and the digest would stay empty after M3. |
| Publishing without a gate | Summaries publish automatically after JSON validation, one retry, and the raw-text fallback. No manual approval, no quality review. | Owner decision 2026-09-10. A personal tool with a trusted audience; the owner retries an episode if a summary is poor. |
| Related episodes | Optional enrichment: query by the episode's centroid in `shared-catalog`, exclude its own `videoId`, deduplicate to at most five `available` videos, store the ids in `related_video_ids_json`. A failed lookup or no qualifying result stores `[]` and publication proceeds. | Related suggestions must never prevent delivery of the summary. Display filters titles to the reader's eligible channels and omits an empty section. Owner decision 2026-09-10. |
| Which channels a run touches | Scheduled runs: `status = 'approved'`, `paused_by IS NULL`, no queued or running run. The first-approval run, an owner's episode retry, and an owner's on-demand start ignore `paused_by`. Declined channels are excluded by status; there is no channel failure state to exclude. | `channel-simplification.md` §3.4. Follower count reaches selection only through pause, so a channel nobody follows costs nothing after its initial import. |
| Which episodes a run attempts | First approval: the newest `initial_import_count` feed entries. Scheduled: new feed entries plus every `pending` episode, waiting ones and those below three technical attempts, including selected episodes that have left the feed. Episode retry: exactly the one episode, from `failed` or `skipped`. Skipped episodes are never re-bought by cron. | PRD §4.2 and `channel-simplification.md` §3.3. Bounded work per run; a deliberate skip is a decision, not a retry candidate. |
| Fresh uploads without captions | A "no captions" answer for a video published **within the last 48 hours** leaves the episode `pending` with `waiting_code = CAPTIONS` and `transcript_checked_at` set, no attempt counted; each scheduled run re-checks it. At or after 48 hours the video is fetched again, and only another no-caption answer makes it `skipped NO_CAPTIONS`. | YouTube's auto-captions lag an upload by hours; the freshest videos are the point of a digest. Elapsed time alone does not prove captions are absent. Owner decisions 2026-09-08 and 2026-09-10. |
| Shorts, live streams, premieres | Under **180 seconds** → `skipped SHORT`, nothing stored. Live or upcoming → `pending` with `waiting_code = LIVE_OR_UPCOMING`, re-checked like a fresh upload; still live at or after 48 hours → `skipped LIVE_OR_UPCOMING`. Known live metadata wins over an `UNPLAYABLE` answer. `UNPLAYABLE` otherwise → `skipped UNPLAYABLE`. | Shorts clutter a digest; streams cannot be summarised until they end. The feed carries no duration, so the DownSub call is made first and costs its credit; accepted. Owner decision. |
| Non-English videos | `captionStatus: "non_english"` → `skipped NON_ENGLISH`. There is no channel-level consequence: a channel whose videos are all non-English is an approved channel with `episodes.available = 0`, which the owner can pause or decline. | Summaries, embeddings, and chat are English. Owner decision 2026-09-08; the channel code it once implied was removed on 2026-09-10 with every other channel failure code. |
| Technical failures | `PROVIDER_AUTH`, `PROVIDER_HTTP`, `PROVIDER_RATE_LIMIT`, `PROVIDER_PARSE`, `FEED_UNAVAILABLE` for the episode's fetch, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED` increment `attempt_count` and record `failure_code`. Below three the episode stays `pending` and the next scheduled run reattempts it; the third attempt makes it `failed`. Waiting never counts as an attempt. | Owner decision 2026-09-10: transient provider errors clear themselves, at no credit cost, and only a persistent failure reaches the owner. Replaces "never automatically restart technical failures". |
| Owner episode actions | `POST /channels/:id/episodes/:videoId/retry` (`failed` or `skipped` → `pending`, attempts and skip fields cleared, one-episode `owner_retry` run) and `…/skip` (`failed` → `skipped OWNER`), both requiring an approved channel with no active run. Implemented on 2026-09-10; M3 makes the retry actually start a run. | `channel-simplification.md` §3.3. The only retry there is; siblings and their summaries are untouched. |
| Takeaways carry timestamps | Each takeaway is `{ text, startSec }`, `startSec` null when the model gives none or it falls outside the episode. The prompt sends `[mm:ss]` markers and asks for one per takeaway. `EpisodeSummary.takeaways` in `packages/shared` changes from `string[]`; the web renders a `youtu.be/<id>?t=<s>` link per takeaway. No legacy data exists, so no normalisation of string takeaways is needed. | The digest's most useful click is "take me to that moment". Owner decision 2026-09-08; the legacy rule of 2026-09-10 became moot with the pre-production reset. |
| DownSub credit exhaustion | `PROVIDER_LIMIT` (HTTP 403) ends the run as `failed` with that code and leaves the remaining selected episodes `pending` with `waiting_code = PROVIDER_LIMIT`, no attempt counted. The next scheduled run checks credits and resumes. `GET /catalog` gains `transcripts: { remainingCredits }` from DownSub's `/status`, fetched at most once every five minutes per isolate. | A quota is not a fact about the videos. The owner sees the balance where the other health numbers are. Owner decision 2026-09-08. |
| Digest basis | Digest selection and ordering use the episode's first `processed_at`, exposed as `summaryAvailableAt`: 24 hours by default, seven days when expanded. Reads, refollows, re-approval, and enrichment never reset it; channel history stays publication-ordered. | Owner decision 2026-09-10. A video published a month ago but summarised today belongs in today's digest. |
| Step granularity | One `step.do` per external call: feed, transcript, each embedding batch, each upsert batch, retrieval verification, each summary map and reduce call, related query, and each Registry write. Steps return bounded serialisable values; vectors pass from an embedding step to its upsert step and no further. | AGENTS.md → Ingestion pipeline. Workflows cap a step result at 1 MiB and retry per step. |
| Fencing | Every Registry write from a run carries `lifecycleVersion`; the Registry refuses with `INVALID_STATE` when the channel's version differs or the channel is not `approved`. The Workflow treats that refusal as "cancelled" and stops. Declining an approved channel is the one transition that bumps the version. | `channel-simplification.md` §3.1; PRD §4.2. |
| Publishing | An episode is `available` only after `getByIds` returns every expected vector and the summary row exists, in one Registry write that also sets `processed_at` once. | PRD §6: never publish on an accepted asynchronous upsert. |
| Cron | **Every 6 hours**, `0 */6 * * *` UTC, in `triggers.crons`. The `scheduled` handler is exercised with `wrangler dev --test-scheduled`. | Owner decision 2026-09-08. A 24-hour digest window reads better when items trickle in than in one daily burst. |
| Reconciliation | A queued or running run whose Workflow is missing or failed is closed as `failed` with `WORKFLOW_LOST` and fenced; its episodes keep their attempt counts. An approved channel with no run row is "approved, never started" until the on-demand start route or a first approval creates one. `TODO(owner):` the queued-start timeout, the reconciliation interval, and whether "never started" gets an age window. | AGENTS.md → Ingestion pipeline. Without it a lost Workflow would hold the one-active-run slot forever. |
| On-demand start | `POST /channels/:id/runs` (owner, `approved`, no active run) creates a `scheduled`-kind run now, ignoring pause. It is what the Needs-attention Start button calls for a never-started channel. **Plan decision** in the plan's Step 7, vetoable. | `channel-simplification.md` §3.4 asks for a Start action once a route exists. |
| Long episodes | **Map-reduce over 45-minute sections.** Each section is summarised with its own timestamped takeaways; one final call condenses the section summaries into the episode's summary. An episode with a single section skips the reduce step, so short videos cost one call. | Owner decision 2026-09-08. The model reads 24,000 tokens per call, about 1 h 45 min of speech; sampling would leave long-episode takeaways pointing only at sampled minutes. Cents per long episode. |
| Workers plan | Assumes **Workers Paid**. | Workflows on the free plan allow 10 ms CPU per step; parsing a 400 KB DownSub body and chunking an hour of speech may exceed it. `TODO(owner)`: confirm the plan. |
| Embedding model id | `@cf/baai/bge-base-en-v1.5`, 768 dimensions. | The deployed model id carries `.5` (it is also Vectorize's preset name). |

## 3. Pipeline

```
start point ──► Registry.createRun ──► INGEST_WORKFLOW.create({ runId, channelId, lifecycleVersion, kind, episodeLimit })
                                                    │
  ┌─────────────────────────────────────────────────┘
  ▼
  start-run        Registry.startRun(runId, fence) → channel or CANCELLED
  fetch-feed       rss.fetchChannelFeed(channelId)
  select           Registry.recordSelection(runId, fence, entries, rule) → episodes to attempt (run episodes `selected`)
  per episode:
    transcript     source.fetch(videoId)            → TranscriptResult | TranscriptError
    classify       Registry.markTranscript(videoId, fence, outcome)
                     english captions → continue; waiting (fresh no-captions, live) → pending + waiting_code;
                     short / non-English / no captions ≥ 48 h / live ≥ 48 h / unplayable → skipped + reason;
                     technical → attempt +1, pending below three, failed on the third; PROVIDER_LIMIT → run ends
    embed[i]       ai.embed(chunk texts, batch of ≤ 20)                 → vectors (stay in this step's result)
    upsert[i]      vectors.upsert(ns, ids, vectors, metadata)
    verify         vectors.getByIds(ns, ids) → every id present, else technical VECTORIZE_INCOMPLETE
    summarize[s]   ai.summarize(section s) per ≤45-minute section       (invalid JSON: one retry, then fallback)
    reduce         ai.reduce(section summaries) when there is more than one section
    related        optional centroid query, exclude own videoId → up to 5 distinct available videos; failure → []
    publish        Registry.completeEpisode(videoId, fence, { chunkCount, summary, related }) → available,
                   processed_at set once; the channel's status is untouched
  finish-run       Registry.finishRun(runId, fence, outcomes) → completed, or failed(PROVIDER_LIMIT | FEED_UNAVAILABLE);
                   run episodes recorded as available | failed | skipped | waiting | not_attempted;
                   channels.last_checked_at, last_ingested_at updated
```

Retry policy per step: transport failures retry 3 times with exponential backoff from 10 seconds; `UNPLAYABLE`,
`no_subtitles`, `PROVIDER_AUTH`, and fencing are non-retryable inside the run (the episode's own attempt count is
the cross-run retry). Transcript step timeout 2 minutes (DownSub's error paths take up to a minute). AI steps
timeout 3 minutes.

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
`{ executiveSummary: string (≤ 3 sentences), takeaways: { text: string, at: "mm:ss" | null }[3..5], topicTags: string[1..8] }`,
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
| Technical attempt | `status = 'pending'`, `attempt_count` 1–2, `failure_code`, `failure_detail` | `PROVIDER_AUTH`, `PROVIDER_HTTP`, `PROVIDER_RATE_LIMIT`, `PROVIDER_PARSE`, `FEED_UNAVAILABLE`, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED` | None; the next cron reattempts |
| Failed | `status = 'failed'`, `attempt_count = 3`, `failure_code` | the same technical codes | Retry or Skip (Needs attention) |
| Available | `status = 'available'`, `chunk_count`, `vectorized_at`, `processed_at` | | |
| Run | `ingestion_runs.status`, `failure_code` | `FEED_UNAVAILABLE`, `PROVIDER_LIMIT`, `WORKFLOW_LOST` (reconciled), `CANCELLED` (fenced) | None; runs are history |
| Run episode | `ingestion_run_episodes.status` | `selected`, `available`, `failed`, `skipped`, `waiting`, `not_attempted` | |

Readers see `status` and a top-level `skipReason` on every episode; `waitingCode`, attempts, and technical codes are
in the owner's `processing` block. `apps/web/src/lib/copy.ts` already carries the phrases for every value above.

### 3.4 Waiting, failure, and recovery (owner decisions 2026-09-10, on the episode machine)

| Situation | Episode and channel behaviour | Next action |
|---|---|---|
| Fresh video without captions, or live/upcoming, under 48 h | Episode `pending` with the wait reason, no attempt counted; the channel is unchanged | Next six-hour cron re-checks the persisted selection, even if the video has left the feed |
| Same, at or after 48 h | Fetched once more; a fresh no-caption or still-live answer makes it `skipped` with the matching reason | Owner Retry if captions appear later |
| Credits exhausted | Run ends `PROVIDER_LIMIT`; remaining selected episodes `pending` with `waiting_code = PROVIDER_LIMIT`, no attempt counted | Cron checks `/status` and resumes when credits are available |
| Technical error, attempts 1–2 | Episode stays `pending`, reason recorded | Next cron reattempts it |
| Technical error, third attempt | Episode `failed` | Owner Retry or Skip; other episodes and the channel are unaffected |
| First approval with no followers | The channel is system-paused at approval, and the initial import still runs once | Scheduled runs wait for a follower |
| Owner withdraws an approved channel mid-run | `lifecycle_version` bumps; the run's next Registry write is refused and the run ends `CANCELLED`; nothing partial is published | Re-approval starts nothing; the next cron picks the channel up |
| Workflow never starts, or dies after its step retries | Reconciliation closes the run `WORKFLOW_LOST` and fences it; episodes keep their attempt counts; the channel shows "never started" if it has no run at all | Owner Start (on-demand run) |
| Related lookup fails | Summary publishes with `[]` | None |

Precedence within one run: `PROVIDER_LIMIT` ends the run immediately and outranks every per-episode outcome still
to come; a run with only waiting episodes left completes normally and records them as `waiting`; the channel-level
count of waiting episodes (`episodes.waiting`) is what readers and the owner see, never a channel waiting code.

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
| `INGEST_WORKFLOW` | binding `workflows`, class `IngestWorkflow` | |
| `DOWNSUB_API_KEY` | secret | `wrangler secret put` when deployed; `.dev.vars` locally |
| `TRANSCRIPTS_FAKE`, `AI_FAKE`, `VECTORIZE_FAKE` | test-only bindings in `vitest.config.ts` | canned `TranscriptResult` values by video id; deterministic embeddings and canned summaries; an in-memory vector store |
| `triggers.crons` | wrangler | `["0 */6 * * *"]` |

`remote: true` lets local `wrangler dev` reach the real Workers AI and Vectorize, which have no local simulation,
while Durable Objects and the Workflow stay local. Tests never reach them: the fakes are the only seam that works
end to end in the pinned pool.

## 5. Dependencies

None new. Workflows, Workers AI, and Vectorize are Cloudflare bindings. DownSub is an HTTPS API called with `fetch`.

## 6. Out of scope

Chats, retrieval for chat, preferences (M4). A retention policy. Re-embedding when the model changes. Non-English
channels (skipped per video, not processed). Any channel-level failure state, channel retry, or automatic follow:
those concepts were removed on 2026-09-10. Vectorize deletion when a channel is declined (PRD §6: not required;
eligibility excludes the channel).

## 7. Acceptance criteria

1. First approval and the owner's on-demand start each create a run and start the Workflow; a second start while a
   run is queued or running creates nothing; re-approving a declined channel that had been approved before starts
   nothing.
2. Under `wrangler dev` with the DownSub key in `.dev.vars`, an approved channel with captioned recent videos gets
   its episodes `available` with chunk counts set, vectors present in the real index, and structured summaries
   stored; a video without captions published this week stays `pending CAPTIONS`; one under three minutes is
   `skipped SHORT` with nothing stored; DownSub's `/status` shows one credit per attempted video and `GET /catalog`
   reports it.
3. Declining the channel mid-run leaves the run `cancelled` and publishes nothing after the decline; re-approval
   leaves `approved_at` alone and the next scheduled run resumes the pending episodes.
4. A transport failure leaves the episode `pending` with `attempt_count` 1, the next run reattempts it, and the
   third failure makes it `failed`; the owner's Retry returns it to `pending` and starts a one-episode run that
   leaves its siblings' summaries untouched.
5. With the DownSub key pointed at an exhausted account, the run ends `PROVIDER_LIMIT`, the remaining episodes read
   `pending PROVIDER_LIMIT`, no attempt is counted, and the next run resumes them once credits exist.
6. `wrangler dev --test-scheduled` plus a request to `/__scheduled` starts runs for approved, unpaused channels
   only, skips paused ones, and `wrangler.jsonc` schedules it every 6 hours.
7. The first-approval run starts while the channel is system-paused for having no followers.
8. A captionless video re-checked at or after 48 hours is fetched again before being `skipped NO_CAPTIONS`; a
   non-English video is `skipped NON_ENGLISH`; a live stream waits and then skips the same way.
9. Every structured summary's takeaways carry `startSec` where the model gave a timestamp, and the digest links them.
10. The digest selects and orders by `summaryAvailableAt`: a video published a month ago and summarised today
    appears in today's digest; reading it does not move it.
11. A related-lookup failure still publishes the summary with `related: []`.
12. A run whose Workflow is missing reconciles to `WORKFLOW_LOST` within the owner-decided window, and the channel
    reads "approved, never started" only when it has no run at all.
13. `pnpm check` green; the coverage in AGENTS.md → Testing exists for lifecycle, attempts, fencing, chunking, VTT
    parsing, summary validation, and the M3 items it lists.
14. AGENTS.md and the PRD carry these decisions (§8).

## 8. `AGENTS.md` and PRD alignment (2026-09-08, revised 2026-09-10)

Applied on 2026-09-10 with this revision:

- **Transcript contract:** `TranscriptResult.captionStatus`, the live-over-unplayable rule, the fake returning full
  results, and the English-only track choice with `skipped NON_ENGLISH`.
- **AI usage:** publication without a gate; digest windows by `summaryAvailableAt`; related episodes as optional
  enrichment.
- **Ingestion pipeline:** episodes that left the feed stay in the selection; a fresh no-caption result is re-fetched
  at 48 hours; the first-approval run ignores pause; reconciliation and its `TODO(owner)`.
- **API shape:** top-level `skipReason` on every episode; digest by first availability; the planned
  `POST /channels/:id/runs`.
- **Screens:** the digest's availability basis and its three empty states.
- **Testing:** the M3 coverage list. **Open decisions:** the reconciliation window.

Still to apply with the code, per plan step: `EpisodeSummary.takeaways` as `{ text, startSec }[]` and
`summaryAvailableAt` on episodes (Step 3), `transcripts.remainingCredits` on the catalog (Step 7), PRD §4.2 and §4.4
wording for the episode machine and the digest basis (Step 9).
