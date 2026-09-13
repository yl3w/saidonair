# Feature spec — M3.5 The episode Workflow

**Written:** 2026-09-13, against `main` at `e37181c`. The fifth of seven M3 child specs; roadmap
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` §2 (Pre-flight gate, Owner episode actions, Step granularity, Verify step,
Attempt gate, Publishing, Launch throttle, Reconciliation's Retry half, Digest basis), §3 "episode attempt starter"
and "one Workflow instance per attempt", §3.5, §4; PRD §4.2 rules 5–9, 16–17, 24–26 and §4.4. Acceptance 2, 5, 6
(owner half), 11, 12, 13, 14 (Retry half), 18, 19 of the parent.
**Status:** approved with the split of 2026-09-13; not started. Plan: `docs/specs/m3-5-episode-workflow-plan.md`.
Needs M3.1–M3.4 on `main`. No new dependencies.

## 1. Summary

Summaries exist after this chunk. One Workflow instance per attempt runs the pipeline of the parent §3: stagger,
transcript, classify, chunk, discard an abandoned generation, stage, embed and upsert in batches, verify, summarise
per section and reduce, look up related episodes, publish, clean up the previous generation. The attempt starter with
its pre-flight and three-second stagger replaces the log line of M3.4 for discovery and drives Owner Retry, which
answers `EpisodeRetryResponse` from now on. `lib/workflows.ts` is the one path to the `INGEST_WORKFLOW` binding with
`WORKFLOW_FAKE` for tests. The digest switches to availability order. Approving a channel under `wrangler dev` with the
DownSub key now produces `available` episodes with summaries in the Registry and vectors in the real index.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Order inside the Retry route | Running check with inline reconciliation → pre-flight → blocked: `recordBlockedAttempt(owner_retry)` and answer with the untouched episode → else `retryEpisode` (resets the window) → `beginAttempt` → launch. | A blocked Retry must leave the window unchanged (PRD rule 16), so the reset happens only once pre-flight permits. |
| Where the lost-attempt helper lands | `closeLostEpisodeAttempt(env, attemptId, now)` lands here for Retry; M3.6's sweep reuses it. | Retry needs it first, and the fake launcher it is tested against arrives here. |
| Pre-flight reading | `auth_failed` → `PROVIDER_AUTH`; `ok` with `remainingCredits === 0` → `PROVIDER_LIMIT`; `ok` otherwise and `unreachable` → proceed. Read once per batch. | Parent §2 "Pre-flight gate". |
| A `create()` that throws | `finishAttempt(failed WORKFLOW_LOST, detail = message)`; the batch continues with the next episode. | PRD rule 8. |
| Digest basis | `listDigest` selects `processed_at >= since` and orders `processed_at DESC, video_id`; the web changes nothing. | PRD §4.4; the route already exposes `summaryAvailableAt`. The 2026-09-12 plan had no step for this; it belongs where episodes first become available. |
| Step retries and timeouts | Transcript: 5 retries, exponential from 10 s, 2-minute timeout. Each AI call: 3 retries, 3-minute timeout. Each upsert: 3 retries. Verify: 8 retries, exponential from 5 s, so asynchronous visibility is absorbed before `VECTORIZE_INCOMPLETE`. Registry writes: 3 retries. Discard and cleanup: 2 retries, then logged and swallowed. | Parent §3 timeouts; Vectorize visibility is seconds, not minutes. The owner may tune the counts. |
| The transcript step's result | The step returns the segments when their JSON is under 700 KB, else `{ tooLarge: true }`, and the instance finishes `TRANSCRIPT_TOO_LARGE`. | Workflows cap a step result at 1 MiB (parent §2). |
| Verify step result | Only the count of missing ids crosses the step boundary. | Step results stay small. |
| Pipeline as a function | `ingestAttempt(step, env, params)` takes a `StepLike` (`do`, `sleep`) and does the work; `IngestWorkflow.run` passes the real `step`. | Tests drive the pipeline with an inline step runner whether or not the pool runs Workflows (M3.1 Step 0.1 decides which tests also use real instances). |
| Classification is pure | `classify(result \| failure): Classification` exported from `workflows/ingest.ts` and unit-tested on every row of parent §3.5. | The row table is the contract; a pure function pins it. |

## 3. Contract

### 3.1 `lib/workflows.ts`

```ts
export type IngestParams = { attemptId: string; videoId: string; channelId: string; startDelaySec: number };
export type InstanceStatus = "active" | "gone" | "missing";
export type IngestLauncher = { create(params: IngestParams): Promise<void>; status(attemptId: string): Promise<InstanceStatus> };
export function ingestLauncher(env): IngestLauncher;    // WORKFLOW_FAKE or env.INGEST_WORKFLOW; instance id = attemptId
```

Status folding: the engine's `queued`, `running`, `paused`, and `waiting` are `active`; `complete`, `errored`, and
`terminated` are `gone`; not found is `missing`. `WORKFLOW_FAKE` is JSON `{ default: InstanceStatus, instances:
Record<attemptId, InstanceStatus>, createThrows: string[] }`; the fake records every `create` in a module-level list
(`createdInstances()`, cleared by `test/setup.ts`) and launches nothing.

### 3.2 `lib/ingestion.ts` additions

```ts
export function startDelaySec(k: number): number;                                   // k × 3, k from 0
export function preflight(health: TranscriptProviderHealth): BlockReason | null;    // PROVIDER_AUTH | PROVIDER_LIMIT | null
export async function startEpisodeAttempts(env, episodes, trigger, options?: { requestedByEmail?: string; now?: number }): Promise<AttemptStartResult[]>;
export async function closeLostEpisodeAttempt(env, attemptId, now): Promise<void>;  // finishAttempt failed WORKFLOW_LOST
```

`startEpisodeAttempts` reads provider health once, then for the k-th episode: blocked → `recordBlockedAttempt`;
else `beginAttempt`, and on `started` → `launcher.create({ …, startDelaySec: startDelaySec(k) })`, a throw finishing
the attempt `WORKFLOW_LOST`; a `running` answer is returned as such and skipped. An owner Retry is a batch of one with
delay 0.

### 3.3 The Retry route

`POST /channels/:id/episodes/:videoId/retry` answers `EpisodeRetryResponse` `{ episode, attempt }`. With a running
latest attempt: started under an hour ago → 409 `INVALID_STATE`; older → `launcher.status(attemptId)`: `active` →
409; `gone` or `missing` → `closeLostEpisodeAttempt`, then continue. Then the order of §2. The Skip route is
unchanged. Channel status and the caller's role are never read.

### 3.4 `workflows/ingest.ts`

`IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams>`; `run` calls `ingestAttempt(step, env, params)`. Steps,
each a named `step.do` unless noted: `sleep(startDelaySec)`; `load` (the attempt must be current, else exit);
`transcript`; classify inline; on a deterministic or waiting result `finish` and exit; chunk inline; `discard`
(when `beginAttempt` named an abandoned generation); `markStaged`; `embed[i]` returning vectors and their running sum;
`upsert[i]`; `verify`; `summarize[s]` per section, `reduce` when more than one; `related`; `publish`
(`completeAttempt`); `cleanup` (the previous generation, when any). A step that exhausts its retries finishes the
attempt with its code: `PROVIDER_*` from `transcriptFailure`, `EMBEDDING_FAILED`, `VECTORIZE_INCOMPLETE`,
`SUMMARY_FAILED`; a refused Registry write (`INVALID_STATE`) ends the instance without another write. Summary
output is parsed with `parseSummary`; invalid → one retry with the stricter suffix; invalid again →
`raw_fallback`. The instance never reads RSS, the channel, or the run.

### 3.5 Bindings and the digest

`wrangler.jsonc`: `"workflows": [{ "name": "media-digest-ingest", "binding": "INGEST_WORKFLOW", "class_name":
"IngestWorkflow" }]`; `index.ts` exports the class. `bindings.d.ts`: `INGEST_WORKFLOW: Workflow<IngestParams>` and
test-only `WORKFLOW_FAKE?`. `vitest.config.ts` pins the fake with `default: "active"`. `episodes.ts` `listDigest`
per §2.

## 4. Acceptance criteria

1. `classify`: English with a known duration of 180 s or more → process; under 180 s → `SHORT`; live or upcoming →
   `LIVE_OR_UPCOMING` before any duration check; `non_english` → `NON_ENGLISH`; `none` → `CAPTIONS`; `UNPLAYABLE`
   failure → skip; each `PROVIDER_*` failure → failed with that code; an unknown duration is never `SHORT`.
2. A complete attempt on the fakes: attempt `available`; episode `available` with `chunkCount` equal to the chunks,
   a structured summary with `startSec` takeaways, `processedAt` set; the fake store holds exactly the generation's
   ids; `processing.latestAttempt.stagedChunkCount` set.
3. Technical failures at every stage (embed throwing, upsert throwing, verify never completing, summary throwing
   past its retries, a refused Registry write) finish the attempt with the right code and leave the episode `pending`
   with `nextAttemptAt` set and no `failureCode`.
4. A transcript over 700 KB → `TRANSCRIPT_TOO_LARGE`, recoverable.
5. Replacement: Retry on an available episode keeps the old summary and generation readable while the run is in
   flight; after success the store holds only the new generation, `processedAt` is unchanged, and a User DO read
   receipt on the episode survives.
6. A second attempt after a failed one that reached `markStaged` deletes exactly the abandoned ids before staging.
7. A failing `deleteByIds` in cleanup leaves the publication standing.
8. A failing `query` in `related` publishes with `related: []`.
9. An instance whose attempt was finished by someone else exits at `load` without writing.
10. Starter: the k-th attempt of a batch gets `startDelaySec = 3k`, an owner Retry 0; a blocked automatic start
    records `blocked` with the reason and moves `nextAttemptAt`; a blocked Retry returns the episode with its window
    unchanged and a `blocked` attempt; a throwing `create` records `WORKFLOW_LOST` and the batch continues.
11. Retry: 409 while running under an hour; older with fake `active` → 409; `gone` or `missing` → reconciled
    `WORKFLOW_LOST` and a new attempt started in the same request; sibling episodes untouched; no channel or run row
    changes (row diffs).
12. Digest: two episodes available one second apart list newest availability first whatever their publication dates;
    an episode published a month ago and processed now is in today's digest; `since` applies to
    `summaryAvailableAt`.
13. The OpenAPI document shows `EpisodeRetryResponse` on Retry; the coverage test passes.
14. `pnpm check` green. Under `wrangler dev` with the key: an approved channel with captioned videos gets `available`
    episodes with vectors in the real index and summaries whose takeaways carry `startSec`; a captionless recent
    video is `pending` with its latest attempt `waiting CAPTIONS`; a short is `skipped SHORT`; `/status` credits drop
    by one per attempted video and `GET /catalog` shows it; Retry on an available episode replaces it and the old
    ids are gone from the index.

## 5. Out of scope

The recovery cron and its sweep (M3.6); every web change (M3.7); the outcome-code `CHECK` (M3.7); retrieval (M4).

## 6. `AGENTS.md` and PRD alignment

No PRD change: rule 5's "immediately" becomes true. `api-reference.md` §3.3: the Retry row's `EpisodeRetryResponse`
is registered. `AGENTS.md`: the `workflows/ingest.ts`, `lib/workflows.ts`, and `lib/ingestion.ts` layout lines
describe existing code; the Ingestion implementation bullets already state the rules.
