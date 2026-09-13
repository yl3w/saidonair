# Implementation plan — M3.2 The attempt ledger

**Implements:** `docs/specs/m3-2-attempt-ledger.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries the writes of Step 4 of the 2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. No new dependencies.
**Shape:** three code steps, each ending with `pnpm check` green and one commit when the owner asks. Step 1 is
independent of Steps 2 and 3; Step 3 needs Step 2. Nothing here changes `0001_init.sql`, a route, or the web. Decisions
this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §4, all fourteen criteria.

### Step 1 — The discovery write  (size: M)

**Files:** `apps/api/src/do/registry/runs.ts`, `apps/api/src/do/registry/episodes.ts`,
`apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry.ts`, `apps/api/test/registry-discovery.test.ts`.

- 1.1 `runs.ts`: `insertRun(sql, input)` writing one completed row (`run_id` from `crypto.randomUUID()`,
  `started_at = finished_at = now`).
- 1.2 `episodes.ts`: `selectNewEntries(sql, channel, entries)` (pure over the existing-id set it reads) and
  `insertDiscovered(sql, channelId, runId, entries, now)` with the window columns of spec §3. `RETRY_INTERVAL_MS`
  exported.
- 1.3 `recordDiscovery(sql, channelId, feed, now)` composing 1.1 and 1.2 in one `sql` transaction
  (`storage.transactionSync` in the facade), plus `last_checked_at`. **Plan decision:** a `feed` whose `channelId`
  differs from the argument is `INVALID_INPUT`, never silently accepted.
- 1.4 `types.ts`: `DiscoveryResult`, `ChannelFeed` and `FeedEntry` imported from `lib/youtube/rss.ts`. Facade method
  validating ids as the neighbours do.

**Tests:** spec §4.1–4.3 (creation half), §4.13 for this method.

**Done when:** `pnpm check` green.

### Step 2 — Attempt writes  (size: L)

**Files:** `apps/api/src/do/registry/attempts.ts`, `apps/api/src/do/registry/episodes.ts`,
`apps/api/src/do/registry/window.ts` (new), `apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry.ts`,
`apps/api/test/registry-attempts.test.ts`, `apps/api/test/registry-episodes.test.ts`.

- 2.1 **Plan decision:** `window.ts` holds the one implementation of the universal rule: `settleUnfinished(sql,
  episode, code, now)` either moves `next_attempt_at` (before the deadline) or closes the window as a timeout
  (publication) or as a plain close (replacement). `finishAttempt` and `recordBlockedAttempt` both call it; nothing
  else computes a six-hour or deadline value.
- 2.2 `attempts.ts`: `insertRunning`, `insertBlocked`, `requireCurrent(sql, attemptId)` (running and generation
  matches the episode's staged one, else `INVALID_STATE`), `finish(sql, attemptId, status, code, detail, now)`,
  `abandonedGeneration(sql, videoId)`.
- 2.3 `episodes.ts`: `openStaged(sql, videoId, generationId, now)` (staged generation, `attempt_count += 1`),
  `clearWindow`, `markSkipped`, the `transcript_checked_at` write. `beginAttempt`, `markStaged`, `finishAttempt`,
  `recordBlockedAttempt` compose these under one transaction each.
- 2.4 Facade methods and `types.ts` unions (`AttemptStart`, `AttemptOutcome`, `BlockReason`).

**Tests:** spec §4.3–4.8, 4.10, 4.11, 4.13; each transition table row of parent §3.3 with one test; the exact
`deadline − 1 ms` and `deadline` cases through both `finishAttempt` and an automatic `recordBlockedAttempt`.

**Done when:** `pnpm check` green.

### Step 3 — Publication  (size: M)

**Files:** `apps/api/src/do/registry/summaries.ts` (new), `apps/api/src/do/registry/episodes.ts`,
`apps/api/src/do/registry.ts`, `apps/api/test/registry-attempts.test.ts`, `apps/api/test/helpers.ts`.

- 3.1 **Plan decision:** `summaries.ts` owns the `episode_summaries` upsert and the candidate filter of spec §2;
  `episodes.ts` keeps its read. `seedSummary` in `test/helpers.ts` moves onto the same upsert so the seed and the
  product write cannot drift.
- 3.2 `completeAttempt`: `requireCurrent`, then in one transaction the summary upsert, the episode publication
  columns of spec §3, and the attempt's `available`; returns the previous generation read before the write.
- 3.3 Facade method; `EpisodeSummaryInput` in `types.ts`.

**Tests:** spec §4.9, 4.10 (`completeAttempt` half), 4.12; a `chunkCount` of zero refused; the `CHECK` on an
available row satisfied (positive `chunk_count`, `vectorized_at`, `processed_at`, `active_vector_generation`).

**Done when:** `pnpm check` green; the `AGENTS.md` layout line for `do/registry/` names `summaries` and `window`.

## Walkthrough record

_No `wrangler dev` leg: nothing calls these methods until M3.4 and M3.5, whose walkthroughs exercise them. Record here
the test count before and after each step._
