# Feature spec — M3 Ingestion

**Written:** 2026-09-08, against `main` at `c959cc6`.
**Status:** proposed. Implements PRD §10 M3 (shared runs and episodes, RSS, transcripts, chunking, embeddings, retry
fencing) plus the summary step that the schema makes part of "processed". Plan: `docs/specs/m3-ingestion-plan.md`.
**Owner decisions already made:** transcripts come from DownSub's API (2026-09-08). An InnerTube fetcher was built
and measured first: it passes from a residential IP and is bot-checked from Cloudflare's egress in every client tested
(30 player calls: 21 `LOGIN_REQUIRED`, 4 hard 403s, 5 OKs on one video). It was removed rather than kept as a path
production never runs; the code survives only on the throwaway branch `spike/transcript-remote`.

## 1. Summary

Approved channels start producing digest content. An owner add, an approval that creates the channel, or an owner
retry starts one ingestion run per channel as a Cloudflare Workflow. The run reads the RSS feed, selects episodes,
and for each one fetches the transcript, chunks it, embeds and upserts the chunks into Vectorize under
`shared-catalog`, verifies they are retrievable, generates the shared summary, and only then marks the episode
`processed`. The first processed episode makes the channel `available`; a run that ends with none marks it `failed`
with the reason the PRD names. Runs are fenced by `lifecycle_version` so a deleted or retried channel cannot be
touched by a stale run. When a channel becomes available, its approved requesters are followed automatically.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Where transcripts come from | **DownSub, behind one contract.** `TranscriptSource.fetch(videoId)` returns segments, `null` for no captions, or throws a `TranscriptError` with a reason. Tests select a canned fake with the test-only `TRANSCRIPTS_FAKE` binding; everything else uses the DownSub adapter. | The source is the thing most likely to change again. Ingestion must not know which one is in use, and a replacement is one file behind the seam. |
| DownSub specifics | `GET https://api.downsub.com/download?url=<watch URL>` with the `DOWNSUB_API_KEY` secret. `state` `subtitles_found` → pick a track and fetch its **VTT**; `no_subtitles` → `null`; `error` → `TranscriptError("UNPLAYABLE", playabilityReason)`. HTTP 401 → `PROVIDER_AUTH`, 403 → `PROVIDER_LIMIT`, 429 → `PROVIDER_RATE_LIMIT`, other non-2xx → `PROVIDER_HTTP`, unparsable → `PROVIDER_PARSE`. | Verified 2026-09-08 with a trial key: synchronous, ~0.8 s when captions exist, 1 credit per video that has or lacks captions, 0 for errors and file downloads, fresh uploads (1–2 h old) served. Error states are slow (17–57 s), so the step timeout is generous. |
| Track choice | English-first: a manual `en`/`en-*` track, else `en_auto`/`en-*_auto`, else the first manual track, else the first auto-generated one. The DownSub `code` field decides; labels are unreliable ("undefined (auto-generated)" appears). | Summaries and chat are English; an English auto-caption beats a human caption in another language. `TODO(owner)` remains for anything beyond English-first. |
| Summary in M3 | **Yes.** The schema says `processed` requires a stored summary and the PRD says the same, so the summarize step is in this milestone. M4 keeps chats, retrieval, citations, and preferences. | Without it no episode could ever be `processed` and the digest would stay empty after M3. |
| Related episodes | Computed in M3 from the shared namespace: top-5 neighbours of the episode's chunks, excluding its own video, keeping processed episodes only, stored as `related_video_ids_json`. `[]` when nothing qualifies. | The summary row requires the column, and the query is one Vectorize call. Display filtering to eligible channels already exists. |
| Which episodes a run attempts | Initial and owner-retry runs: the newest `initial_import_count` feed entries. Scheduled runs: feed entries not yet `processed`, plus `failed` ones with fewer than 3 attempts. Only owner retry reattempts `no_transcript`. | PRD §4.2. Bounded work per run; a permanent "no captions" is not re-bought every day. |
| Step granularity | One `step.do` per external call: feed, transcript, each embedding batch, each upsert batch, retrieval verification, summary, related query, and each Registry write. Steps return small serialisable values; vectors never leave the step that upserts them. | AGENTS.md → Ingestion pipeline. Workflows cap a step result at 1 MiB and retry per step. |
| Fencing | Every Registry write from a run carries `lifecycleVersion`; the Registry refuses with `INVALID_STATE` when the channel's version differs or the channel is deleted. The Workflow treats that refusal as "cancelled" and stops. | AGENTS.md → Ingestion pipeline; PRD §4.2. |
| Publishing | An episode is `processed` only after `getByIds` returns every expected vector and the summary row exists, in one Registry write. | PRD §6: never publish on an accepted asynchronous upsert. |
| Cron | The `scheduled` handler is implemented and exercised with `wrangler dev --test-scheduled`. `triggers.crons` stays empty with the `TODO(owner)`. | AGENTS.md: do not choose a cadence. |
| Workers plan | Assumes **Workers Paid**. | Workflows on the free plan allow 10 ms CPU per step; parsing a 400 KB DownSub body and chunking an hour of speech may exceed it. `TODO(owner)`: confirm the plan. |
| Embedding model id | `@cf/baai/bge-base-en-v1.5`, 768 dimensions. | AGENTS.md wrote `bge-base-en-v1`; the deployed model id carries `.5` (it is also Vectorize's preset name). Same model, corrected id. |

## 3. Pipeline

```
start point ──► Registry.createRun ──► INGEST_WORKFLOW.create({ runId, channelId, lifecycleVersion, kind, episodeLimit })
                                                    │
  ┌─────────────────────────────────────────────────┘
  ▼
  start-run        Registry.startRun(runId, fence) → channel or CANCELLED
  fetch-feed       rss.fetchChannelFeed(channelId)
  select           Registry.recordSelection(runId, fence, entries, rule) → episodes to attempt, skipped ones recorded
  per episode:
    transcript     source.fetch(videoId)            → segments | null | TranscriptError
    mark           Registry.markTranscript(videoId, fence, outcome)      (no_transcript / failed end here)
    embed[i]       ai.embed(chunk texts, batch of ≤ 20)                 → vectors (stay in this step's result)
    upsert[i]      vectors.upsert(ns, ids, vectors, metadata)
    verify         vectors.getByIds(ns, ids) → every id present, else FAILED(VECTORIZE_INCOMPLETE)
    summarize      ai.summarize(prompt) → structured | raw_fallback     (invalid JSON: one retry, then fallback)
    related        vectors.query(ns, centroid, topK 6, filter channelId ∉ own video) → ids of processed episodes
    publish        Registry.completeEpisode(videoId, fence, { chunkCount, summary, related }) → processed;
                   channel pending → available on the first one
  finish-run       Registry.finishRun(runId, fence, outcomes) → completed | failed; channel failed(reason) if initial/retry
                   run has no processed episode; last_checked_at, last_ingested_at
  auto-follow      Registry.listPendingAutoFollows(channelId) → UserDO.autoFollow → Registry.ackAutoFollow
```

Retry policy per step: transport failures retry 3 times with exponential backoff from 10 seconds; `UNPLAYABLE`,
`no_subtitles`, `PROVIDER_AUTH`, and fencing are non-retryable. Transcript step timeout 2 minutes (DownSub's error
paths take up to a minute). AI steps timeout 3 minutes.

### 3.1 Chunking (`lib/chunk.ts`, pure)

The hybrid strategy from AGENTS.md: group consecutive segments to about 60 seconds; split a group on segment
boundaries when it exceeds ~400 tokens (`chars / 4`); overlap consecutive chunks by one or two segments; never emit
more than 480 tokens; a single segment over the cap is split on sentence, then word boundaries. Output:
`{ index, text, startSec, endSec }[]`. Vector id `${videoId}:${index}`; metadata
`{ videoId, channelId, channelTitle, title, startSec, endSec, text, publishedAt }` with `channelId` and `videoId`
always present.

### 3.2 Summary (`prompts/summary.ts`, `lib/ai.ts`)

Model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON output requested, validated against
`{ executiveSummary: string (≤ 3 sentences), takeaways: string[3..5], topicTags: string[1..8] }`. On invalid output
retry once with a stricter instruction; on a second failure store `raw_fallback` with the model's text. Input budget:
the transcript is sent whole when under 60,000 characters; otherwise chunks are sampled evenly across the whole
transcript to fit the budget, so the summary still covers the end of a long episode (**plan decision**; an
alternative is map-reduce, more calls). Prompt text is in the plan for approval; `prompt_version` is stored with
each summary, and changing the prompt bumps it.

### 3.3 Failure codes

| Where | Code | Stored on |
|---|---|---|
| Transcript | `UNPLAYABLE`, `PROVIDER_AUTH`, `PROVIDER_LIMIT`, `PROVIDER_RATE_LIMIT`, `PROVIDER_HTTP`, `PROVIDER_PARSE` | episode `failed`; run episode |
| Embedding / summary | `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED` | episode `failed` |
| Vectorize | `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE` | episode `failed` |
| No captions | none | episode `no_transcript` |
| Run | `FEED_UNAVAILABLE`, `CANCELLED` (fenced) | run `failed` / `cancelled` |
| Channel | `NO_TRANSCRIPTS`, `NO_EPISODES`, `INITIAL_IMPORT_FAILED` | channel `failed`, per PRD §4.2 |

The web's `lib/copy.ts` gains phrases for the new episode codes; owner screens already show codes.

## 4. Configuration

| Name | Kind | Value |
|---|---|---|
| `AI` | binding, `remote: true` | Workers AI |
| `VECTORS` | binding `vectorize`, index `media-rag`, `remote: true` | created once by the owner (AGENTS.md → One-time setup) |
| `INGEST_WORKFLOW` | binding `workflows`, class `IngestWorkflow` | |
| `DOWNSUB_API_KEY` | secret | `wrangler secret put` when deployed; `.dev.vars` locally |
| `TRANSCRIPTS_FAKE`, `AI_FAKE`, `VECTORIZE_FAKE` | test-only bindings in `vitest.config.ts` | canned transcripts by video id; deterministic embeddings and canned summaries; an in-memory vector store |
| `triggers.crons` | wrangler | empty, `TODO(owner)` |

`remote: true` lets local `wrangler dev` reach the real Workers AI and Vectorize, which have no local simulation,
while Durable Objects and the Workflow stay local. Tests never reach them: the fakes are the only seam that works
end to end in the pinned pool.

## 5. Dependencies

None new. Workflows, Workers AI, and Vectorize are Cloudflare bindings. DownSub is an HTTPS API called with `fetch`.

## 6. Out of scope

Chats, retrieval for chat, preferences (M4). A retention policy. Re-embedding when the model changes. Exposing
DownSub's remaining credits in `GET /catalog` (a free call, worth adding once the owner wants it on the health strip).
Vectorize deletion on channel deletion (PRD §6: not required).

## 7. Acceptance criteria

1. Owner add, approval that creates a channel, and owner retry each create a run and start the Workflow; a second
   start while a run is queued or running creates nothing.
2. Under `wrangler dev` with the DownSub key in `.dev.vars`, an added channel with captioned recent videos reaches
   `available` with its episodes `processed`, chunk counts set, vectors present in the real index, and structured
   summaries stored; a channel whose attempted videos lack captions ends `failed` with `NO_TRANSCRIPTS`; DownSub's
   `/status` shows one credit per attempted video.
3. Deleting a channel mid-run leaves the channel deleted and the run `cancelled`; no episode is published after the
   delete. Owner retry of a failed channel bumps the version, reuses processed episodes, and reattempts the rest.
4. Approval of a request whose channel later becomes available produces exactly one follow per requester, never
   overwriting an unfollow, and acknowledges each in the Registry.
5. `pnpm check` green; the required coverage in AGENTS.md → Testing exists for lifecycle, retry, fencing, chunking,
   VTT parsing, summary validation, and the auto-follow handoff.
6. `wrangler dev --test-scheduled` plus a request to `/__scheduled` starts runs for available channels only.
7. AGENTS.md carries the edits in §8.

## 8. `AGENTS.md` and PRD edits (applied with this spec, 2026-09-08)

- **Hard rule 2:** YouTube means the RSS feed only; DownSub's API is the one permitted third-party service, for
  transcripts only. No InnerTube calls.
- **Stack table:** a Transcripts row; embeddings model id `@cf/baai/bge-base-en-v1.5`.
- **Transcript contract:** rewritten around the seam and the DownSub adapter, with the verified outcome of the
  Cloudflare-IP check as the reason YouTube is not called directly.
- **Open decisions:** the transcript source is decided; the Workers plan confirmation is added.
- **Repo layout:** `lib/transcripts/{index,downsub,vtt,types}.ts`, `prompts/summary.ts`; `lib/youtube/` holds ids
  and RSS only.
- **One-time setup:** `wrangler secret put DOWNSUB_API_KEY`. **Testing:** the three fake bindings.
- **PRD §4.2:** the transcript bullet names DownSub.
