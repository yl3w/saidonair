# Implementation plan — M3.2 The attempt ledger

**Implements:** `docs/specs/m3-2-attempt-ledger.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries the writes of Step 4 of the 2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 on `main` (committed as `620fe88`): the three steps
landed together, `pnpm check` green, 27 test files and 202 tests (25 and 175 before). No new dependencies.
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

- 2.1 **Plan decision:** one module holds the one implementation of the universal rule: `settleUnfinished(sql,
  episode, code, now)` either moves `next_attempt_at` (before the deadline) or closes the window as a timeout
  (publication) or as a plain close (replacement). `finishAttempt` and `recordBlockedAttempt` both call it; nothing
  else computes a six-hour or deadline value. (Built as `processing.ts`, which also holds the five state-machine
  functions, rather than a `window.ts` beside them: `episodes.ts` imports `attempts.ts` for its reads, so the
  composition had to live in a third module to avoid an import cycle.)
- 2.2 `attempts.ts`: `insertRunning`, `insertBlocked`, `requireCurrent(sql, attemptId)` (running and generation
  matches the episode's staged one, else `INVALID_STATE`), `finish(sql, attemptId, status, code, detail, now)`,
  `abandonedGeneration(sql, episodeId)`.
- 2.3 `episodes.ts`: `openStaged(sql, episodeId, generationId, now)` (staged generation, `attempt_count += 1`),
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

No `wrangler dev` leg: nothing calls these methods until M3.4 and M3.5, whose walkthroughs exercise them. Implemented
on 2026-09-13 against `main` at `5a73f18`; the three steps landed as one working-tree change. Tests: 25 files and 175
tests before, 27 files and 202 tests after (`registry-discovery.test.ts` 5, `registry-attempts.test.ts` 22).

Modules as built: `runs.ts` gained `getRun` and `recordDiscovery`; `episodes.ts` gained `EpisodeState` with
`getState`/`requireState`, `hasAnyEpisode`, `existingEpisodeIds`, `insertDiscovered`, `listByEpisodeIds`, and the
window writes (`openStaged`, `scheduleNextAttempt`, `closeWindow`, `markSkipped`, `markTimedOut`,
`markTranscriptChecked`, `publish`) plus `RETRY_INTERVAL_MS`; `attempts.ts` gained the row writes (`insertRunning`,
`insertBlocked`, `setStagedChunkCount`, `finish`) and reads (`getAttempt`, `runningFor`, `latestWithGeneration`);
`channels.ts` gained `markChecked`; new `processing.ts` (the five facade operations, `settleUnfinished`,
`requireAttemptId`, `requireTrigger`) and `summaries.ts` (`upsertSummary`, `relatedFromCandidates`,
`requireSummaryInput`); `test/helpers.ts` `seedSummary` writes through `upsertSummary`.

Decisions made while implementing (plan decisions, stand unless vetoed):

- `recordDiscovery` excludes already-existing ids before taking the newest `initial_import_count`, so an initial
  import always yields up to that many new episodes; a feed whose `channelId` differs from the argument is
  `INVALID_INPUT`; entries are deduped by id within one feed, newest copy kept.
- `recordBlockedAttempt` refuses with `INVALID_STATE` while an attempt is running, so a blocked row is never written
  beside a live instance; the starters check for a running attempt first anyway.
- `beginAttempt` answers `running` before checking for an open window, so reconciliation gets its answer whatever
  state the episode is in.
- The abandoned generation is the episode's newest attempt that minted one (a `blocked` row never does) when it
  recorded a `staged_chunk_count`, did not publish, and is not the active generation.
- `publish` also sets `transcript_checked_at`, since the transcript was fetched in that attempt; `markSkipped`
  clears `skipped_by_email`, which an `OWNER` skip may have set on an earlier life of the row.
- `completeAttempt` reports `chunkCount: 0` for a previous generation whose row somehow carried no count; the
  schema's available-row check makes that unreachable today.
