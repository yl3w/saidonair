# Implementation plan — M3.6 Recovery

**Implements:** `docs/specs/m3-6-recovery.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 8 of the 2026-09-12 plan minus the discovery cron (M3.4) and the
lost-attempt helper (M3.5).
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. Requires M3.5 on `main`. No new dependencies.
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

**Files:** `apps/api/src/lib/ingestion.ts`, `apps/api/src/index.ts`, `apps/api/wrangler.jsonc`,
`apps/api/test/ingestion-recovery.test.ts`, `apps/api/test/scheduled.test.ts`.

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

_Filled in during Step 3._
