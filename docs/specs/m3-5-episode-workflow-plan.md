# Implementation plan — M3.5 The episode Workflow

**Implements:** `docs/specs/m3-5-episode-workflow.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 6, the episode half of Step 7, the Workflow binding of Step 5, and
the digest basis of the 2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 on `main`, committed the same day at the owner's request: the four code
steps landed together, `pnpm check` green with 35 test files and 286 tests (32 and 250 before), the walkthrough
below run against real services. No new dependencies.
**Shape:** four code steps and a walkthrough, each code step one commit when the owner asks with `pnpm check` green.
Step 1 and Step 4 are independent of the rest; Step 3 needs Step 2. Decisions this plan makes are marked **plan
decision** and stand unless vetoed.

## Definition of complete

Spec §4, all fourteen criteria.

### Step 1 — Launcher, fake, binding, class skeleton  (size: S)

**Files:** `apps/api/src/lib/workflows.ts`, `apps/api/src/workflows/ingest.ts` (skeleton), `apps/api/src/index.ts`,
`apps/api/wrangler.jsonc`, `apps/api/src/bindings.d.ts`, `apps/api/vitest.config.ts`, `apps/api/test/setup.ts`,
`apps/api/test/workflows-launcher.test.ts`.

- 1.1 `workflows.ts` per spec §3.1, with `foldStatus(engineStatus)` exported for its test.
- 1.2 `ingest.ts`: the class with a `run` that calls a stub `ingestAttempt`; `index.ts` exports it; the binding and
  its type.

**Tests:** status folding; the fake's `default`, per-instance, and `createThrows` behaviour; `createdInstances()`
reset between tests.

**Done when:** `pnpm check` green; the pool still starts with the binding present (M3.1 Step 0.1 answered how).

### Step 2 — The pipeline  (size: L)

**Files:** `apps/api/src/workflows/ingest.ts`, `apps/api/test/workflow-ingest.test.ts`.

- 2.1 `classify` per spec §2, pure.
- 2.2 `ingestAttempt(step, env, params)` per spec §3.4; `StepLike = { do<T>(name, options, fn): Promise<T>;
  sleep(name, duration) }`. Each step's retry and timeout options as spec §2 lists; the option objects are exported
  constants. The verify step's schedule is two phases (constant 10 s, then exponential), which Workflows' single
  retry policy per `step.do` does not express directly: **plan decision:** verify is a loop of `step.do` calls, one
  per check, each named `verify:<n>` with no retries of its own, sleeping between them with `step.sleep`, so a replay
  resumes at the check it reached and the count of missing ids is the only value that crosses each boundary.
- 2.3 The sections: `sectionize` over the chunks; `formatTranscript` per section; `parseSummary` with `durationSec`
  from the transcript's last segment when the provider gave none.
- 2.4 The related step: centroid from the per-batch sums, `query(topK: 50)` (spec §2 "Related query width"), dedupe
  by `episodeId` excluding the episode's own, candidates to `completeAttempt`.
- 2.5 **Plan decision:** the test step runner (`test/fake-step.ts`) runs `do` inline, honours `retries.limit` by
  re-invoking the callback on a throw, and records step names, so a test can assert which steps ran and how often.
  When M3.1 Step 0.1 found the pool runs Workflows, one additional test creates a real instance through the binding
  and polls its status to `complete`.

**Tests:** spec §4.1–4.9.

**Done when:** `pnpm check` green.

### Step 3 — Starter, pre-flight, discovery launches, Retry  (size: M)

**Files:** `apps/api/src/lib/ingestion.ts`, `apps/api/src/routes/channels.ts`, `packages/shared/src/index.ts` (a
description only, if any), `apps/api/test/ingestion-attempts.test.ts`, `apps/api/test/routes-channels.test.ts`,
`apps/api/test/openapi.test.ts`.

- 3.1 `startDelaySec`, `preflight`, `startEpisodeAttempts` (real body), `closeLostEpisodeAttempt` per spec §3.2.
  **Plan decision:** how tests drive `auth_failed` and zero credits follows M3.1 Step 0.3: through
  `env.TRANSCRIPTS_FAKE` when assignments reach `SELF`, otherwise through an optional `health` argument on the
  in-process starter, with the route-level blocked case covered by the in-process test alone.
- 3.2 The Retry route per spec §3.3, answering `EpisodeRetryResponse`; `openapi.test.ts` parses it.

**Tests:** spec §4.10, 4.11, 4.13; discovery's created episodes now produce attempts and fake instances with
increasing delays (the M3.4 log-line assertion is replaced).

**Done when:** `pnpm check` green.

### Step 4 — The digest orders by availability  (size: S)

**Files:** `apps/api/src/do/registry/episodes.ts`, `apps/api/test/registry-episodes.test.ts`,
`apps/api/test/routes-follows-digest.test.ts`.

- 4.1 `listDigest`: `processed_at >= ?`, `ORDER BY processed_at DESC, episode_id`; the comment loses "until M3".

**Tests:** spec §4.12.

**Done when:** `pnpm check` green.

### Step 5 — Walkthrough  (size: M)

Under `wrangler dev` with `DOWNSUB_API_KEY` in `.dev.vars`, on a scratch `--persist-to` directory: read `/status`
credits through `GET /catalog`; approve a real channel with captioned recent videos and `initialImportCount: 3`;
watch the attempts through `GET /channels/:id/episodes` until `available`; open the summaries and check `startSec`
links; confirm the ids exist in `media-rag` (a temporary `getByIds` probe, deleted); Retry an available episode and
confirm replacement with the old ids gone; find a channel with a fresh captionless upload for `waiting CAPTIONS` and
one with a short for `skipped SHORT`; read the credits again. Record every leg below with the attempt ids.

## Walkthrough record

Run on 2026-09-13 under `wrangler dev --env dev` (remote Workers AI and `media-rag-dev`, the local Workflows
engine, the owner's DownSub key) on scratch `--persist-to` directories, one per run, so the owner's local state
stayed untouched. Identities `alice@example.com` (adds and follows) and `owner@example.com` (approves, retries).
Credits: 2141 before the day's M3.5 runs, 2128 after (thirteen `subtitles_found` calls: nine episodes attempted,
one replacement, three direct probes).

| Leg | What happened |
|---|---|
| Veritasium, newest 2, then newest 4 on fresh state | Every attempt finished `skipped SHORT` within 5–15 s of approval: DownSub reports the four newest uploads at 49, 91, and similar seconds, all shorts (confirmed directly for two ids). Correct, and no use for the happy path. |
| 3Blue1Brown, newest 2 | Two puzzle shorts, `skipped SHORT` in 5 s. |
| Computerphile, newest 3 (`iuHddnIzKRA`, `kVXp6UNVPTo`, `xs5iOwkX9fU`) | Approval discovered 3 and started 3 attempts (stagger 0, 3, 6 s). All three `available` after 50 s: 29, 34, and 21 chunks; `wrangler vectorize info` read 84 vectors, the exact sum. Two structured summaries with real timestamps (takeaways at 223, 1583, 1472 s and 114, 454, 854 s; tags like `ai`, `neuralese`, `linux`); the third fell back to raw text (below). Related: 0, 2, 1, the later episodes finding the earlier ones. The log carried `ingestion.attempt_started` ×3 and `ingest.published` ×3. |
| digest and catalog | `GET /digest` as alice listed the three newest availability first (`summaryAvailableAt` 715490 > 714078 > 704918 ms), all `wasUnread: false` because the polling script had already read them through the channel page, which records receipts for an eligible caller. `GET /catalog`: `episodes.available: 3`, `lastSuccessfulIngestionAt` equal to the newest `processed_at`, credits 2128. |
| Retry of an available episode (`iuHddnIzKRA`) | 200 with `attempt: { status: running, intent: replace }`; while running the episode stayed `available` with its old summary (takeaways 223, 1583, 1472); 25 s later the new summary (280, 679, 1583) with one related episode, `summaryAvailableAt` unchanged at 1789325704918, `chunkCount` 29, `attemptCount` 1 (reset by Retry, then one launch). The index still read 84 right after: the new generation's 29 in, the old 29 deleted by `cleanup`. |
| raw fallback | `kVXp6UNVPTo`'s model answer was fenced JSON whose `executiveSummary` ran past three sentences twice, so `parseSummary` refused it and the raw text was published as `raw_fallback`, exactly as PRD §4.4 then said. The reader lost the takeaways, timestamps, and tags that answer carried, and the stricter retry suffix speaks of JSON shape, not length, so the retry could not help. Owner decision the same day: the prompt keeps asking for three sentences and the validator no longer counts them (PRD §4.4 and the M3.3 spec §3.3 updated). |
| not exercised | A fresh captionless upload for `waiting CAPTIONS` (none at hand; the fixture test covers it); a `blocked` start against the real provider (the fixture test covers both reasons). |

Decisions made while implementing (plan decisions, stand unless vetoed), beyond the spec's §2 rows:

- A new Registry read, `describeAttempt(attemptId)`, and a facade `getEpisode(channelId, episodeId)`; `attempts.ts` gained
  `previousWithGeneration`. The starter keeps `IngestParams` at four fields.
- The stagger counts launched attempts only: a blocked or running episode does not consume a slot.
- `RECONCILE_AFTER_MS` (one hour) lives in `lib/ingestion.ts`; the Retry route reads the episode's latest attempt
  through `getEpisode`, asks the launcher only for one older than that, and reconciles inline before pre-flight.
- The verify loop is `verify:<n>` steps with `verify-wait:<n>` sleeps between them; the schedule is the exported
  `VERIFY_DELAYS_SEC` (17 × 10 s, then 30, 60, 120, 240, 480, 960 s: about 34 minutes in all, longer than the spec's
  "about 21" because the six back-off waits sum to 31.5 minutes).
- Test seams: `AI_FAKE` gained `embedThrows`; `WORKFLOW_FAKE`'s `createThrows` matches an attempt id or a episode id;
  `test/fake-step.ts` runs steps inline and honours `retries.limit`; one test runs a real instance through the binding
  with `introspectWorkflowInstance` and `disableSleeps` (the pool runs Workflows, M3.1 Step 0.1).
- The Workflow's own `console.log` lines do reach the `wrangler dev` output (`ingest.published` appeared), so the
  event names are worth keeping stable for M3.7's walkthrough.
- The sentence-count check left `parseSummary` (owner decision 2026-09-13, see the raw fallback row above): a
  structured answer over the cap is kept whole, and `countSentences` and `MAX_SUMMARY_SENTENCES` went with the check.
  Neither prompt changed, so `PROMPT_VERSION` stays `2026-09-13`.
