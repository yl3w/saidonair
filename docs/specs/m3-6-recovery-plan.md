# Implementation plan — M3.6 Recovery

**Implements:** `docs/specs/m3-6-recovery.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 8 of the 2026-09-12 plan minus the discovery cron (M3.4) and the
lost-attempt helper (M3.5).
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 in the working tree on `main` (uncommitted until the owner asks): both code steps
landed together, `pnpm check` green with 36 test files and 293 tests (35 and 285 before), the walkthrough below run
against the real Workflow engine. No new dependencies.
**Shape:** two code steps and a walkthrough, each code step one commit when the owner asks with `pnpm check` green.
Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §4, all ten criteria.

### Step 1 — The selection reads  (size: S)

**Files:** `apps/api/src/do/registry/episodes.ts`, `apps/api/src/do/registry/attempts.ts`,
`apps/api/src/do/registry.ts`, `apps/api/test/registry-episodes.test.ts`, `apps/api/test/registry-attempts.test.ts`.

- 1.1 `episodes.ts` `listDue(sql, now)` per spec §2, joining out episodes with a running attempt with `NOT EXISTS`;
  returns records through the existing row mapper with an empty related scope.
- 1.2 `attempts.ts` `listRunningStartedBefore(sql, cutoff)`.
- 1.3 Facade methods.

**Tests:** spec §4.2 (the selection half) and the cutoff boundary of 4.3.

**Done when:** `pnpm check` green.

### Step 2 — The tick, reconciliation, and the second cron  (size: M)

**Files:** `apps/api/src/lib/ingestion.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/wrangler-config.test.ts`,
`apps/api/test/ingestion-recovery.test.ts` (**plan decision:** the cron tests live there, fired through the exported
handler as M3.4's are; no `scheduled.test.ts`, and `index.ts` needs no change since `runScheduled` dispatches).

- 2.1 `reconcileRunningAttempts` and `runRecoveryTick` per spec §3; the `TODO(owner)` for a per-tick cap.
  **Plan decision:** the tick logs one summary line `{ event: "recovery.tick", reconciled, due, started, blocked }`
  and one line per lost attempt.
- 2.2 `index.ts` dispatches both crons; `wrangler.jsonc` lists both.

**Tests:** spec §4.1, 4.3–4.9.

**Done when:** `pnpm check` green.

### Step 3 — Walkthrough  (size: S)

Under `wrangler dev --test-scheduled` on the scratch state from M3.5: `GET /__scheduled?cron=30+*/6+*+*+*` on a
quiet Registry (nothing due) and read the summary log; set a pending episode's `next_attempt_at` into the past with
`sqlite3` on the scratch file, fire again, and confirm a `scheduled_recovery` attempt appears with
`startDelaySec: 0` in the instance params; with two due episodes, confirm delays 0 and 3. Record the legs below.

## Walkthrough record

Run on 2026-09-13, 19:25–19:28 UTC, under `wrangler dev --env dev --test-scheduled --port 8796 --persist-to` a copy of
the M3.5 Computerphile scratch state (three `available` episodes, 84 vectors in `media-rag-dev`), so neither the
owner's local state nor the M3.5 record was touched. The state the tick needs was set by hand with `sqlite3` on the
copy before the server started, as Step 3 foresaw; the stale running attempt is a fabricated row, since no instance
had died on its own.

| Leg | What was done | Result |
|---|---|---|
| setup | `kVXp6UNVPTo` and `xs5iOwkX9fU`: `replace` windows opened two hours earlier with `next_attempt_at` a minute in the past (the state an available episode is in after a Retry attempt failed and waits six hours). `iuHddnIzKRA`: a running attempt `m36-stale-attempt-0001`, started two hours earlier, whose workflow id names no instance, with generation `gen-stale-m36` staged on the episode. | three `available` episodes, one running attempt, two due |
| recovery cron (§4.1, 4.3, 4.8) | `GET /__scheduled?cron=30+*/6+*+*+*` | `recovery.tick { reconciled: 1, due: 2, started: 2, blocked: 0, checked: 1, launchFailed: 0 }`; `ingestion.attempt_lost` for the stale id; `ingestion.attempt_started` for `kVXp6UNVPTo` with `startDelaySec: 0` (`0eef30aa…`) and `xs5iOwkX9fU` with `startDelaySec: 3` (`35df5ae2…`), both `scheduled_recovery` |
| reconciled attempt (§4.3, 4.6) | read the ledger row and the episode | `failed WORKFLOW_LOST`, detail "the Workflow instance is gone or missing after an hour"; the episode still `available` with intent `replace` and `next_attempt_at` six hours on (eight hours after its window opened), inside the window; the stale staged generation stays recorded for the next attempt's load step to discard |
| replacements | polled `GET /channels/:id/episodes` | both `available` again 64 s after the tick, two `ingest.published`, `summaryAvailableAt` unchanged (`1789325715490`, `1789325714078`); `kVXp6UNVPTo`, the raw fallback of M3.5, came back structured this time |
| quiet tick | the same `GET` again | `recovery.tick` all zeros, `checked: 0` |
| discovery cron (§4.1) | `GET /__scheduled?cron=0+*/6+*+*+*` | `discovery.tick { channels: 1, read: 1 }` and no attempt started: the crons stay separate |
| credits | `GET /catalog` → `transcripts.remainingCredits` | 2127 before and after the two transcript fetches (the reading did not move) |
| index | `wrangler vectorize info media-rag-dev` after the run | 84 vectors (768-dim), `processedUpToDatetime` 19:27:02 UTC: the two new generations (34 + 21) replaced the two old ones and the count is back where M3.5 left it |
| not exercised here | the deadline and blocked-provider legs (fixture tests cover §4.4 and §4.5); a captionless upload for §4.10's second `waiting CAPTIONS` attempt (none at hand, as in M3.5), replaced by the due-replacement leg above | |

Decisions made while implementing (plan decisions, stand unless vetoed):

- `now` is the selection clock only (`listDueEpisodes(now)`, the reconcile cutoff); the Registry stamps writes with
  its own clock as since M3.2, so `startEpisodeAttempts` gained no `now` option and the spec's `{ now }` was dropped.
- The tick returns the spec's four counts; its one log line adds `checked` (running attempts asked about) and
  `launchFailed` (creates that threw). One attempt whose status call or close throws logs `recovery.reconcile_failed`
  and the loop continues.
- The facade gained one `requireTimestamp` guard, shared by `listDigest`, `listDueEpisodes`, and
  `listRunningAttempts`; `test/wrangler-config.test.ts` now asserts the two production cron strings.
- Tests seed running attempts through `beginAttempt` and age them with SQL, because `finishAttempt` accepts only the
  episode's current attempt (generation match), which a hand-inserted row is not; the fake's `default: "gone"` proves
  a young attempt is never asked.
