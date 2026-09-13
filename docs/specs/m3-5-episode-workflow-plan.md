# Implementation plan — M3.5 The episode Workflow

**Implements:** `docs/specs/m3-5-episode-workflow.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 6, the episode half of Step 7, the Workflow binding of Step 5, and
the digest basis of the 2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. Requires M3.1–M3.4 on `main`. No new dependencies.
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
  by `videoId` excluding the episode's own, candidates to `completeAttempt`.
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

- 4.1 `listDigest`: `processed_at >= ?`, `ORDER BY processed_at DESC, video_id`; the comment loses "until M3".

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

_Filled in during Step 5._
