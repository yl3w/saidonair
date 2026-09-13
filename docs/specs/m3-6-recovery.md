# Feature spec — M3.6 Recovery

**Written:** 2026-09-13, against `main` at `e37181c`. The sixth of seven M3 child specs; roadmap
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` §2 (Universal recovery rule, Reconciliation, Channel independence, Crons,
Launch throttle), §3 "recovery cron", §3.4; PRD §4.2 rules 13–15. Acceptance 3, 4, 6 (automatic half), 7 (recovery
half), 10, 14 (sweep half) of the parent.
**Status:** implemented 2026-09-13 on `main`, uncommitted until the owner asks; `pnpm check` green; the walkthrough
against the real engine is recorded in `docs/specs/m3-6-recovery-plan.md`. No new dependencies.

## 1. Summary

The second cron. Every six hours at minute 30 the recovery tick first reconciles running attempts older than an hour
against the Workflow engine, then starts one attempt for every due episode across every channel status and pause
state, numbered across the whole tick so the k-th sleeps k × 3 seconds, with one provider pre-flight per tick. The
ledger's rules are all in place from M3.2 and the starter from M3.5; this chunk adds the two selection reads, the
tick, and the cron string. After it, a captionless upload is re-checked every six hours and once at its deadline, a
lost instance is closed after an hour, and an episode blocked for its whole window times out with its real reason.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| A lost attempt follows the universal rule | Reconciliation finishes `failed WORKFLOW_LOST` through `finishAttempt`, so the episode is due six hours later, capped at its deadline, like every other unfinished result. | One rule (PRD rule 13); Owner Retry is the immediate path (M3.5). PRD rule 15's "due within its existing window" is read as "still owed inside the window", not "due at once". The owner may reverse this to "due now". |
| The selection reads | `listDueEpisodes(now)`: `intent IS NOT NULL AND next_attempt_at <= now` and no `running` attempt, ordered `next_attempt_at, video_id`, on `episodes(next_attempt_at)`. `listRunningAttempts(startedBefore)` on `episode_ingestion_attempts(status, started_at)`. | The two indexes PRD §5.3 reserves for exactly this. |
| Tick size | No cap on due episodes per tick; the stagger spaces them three seconds apart. A `TODO(owner)` marks where a cap would go. | Tens of channels; a cap is a product decision. |
| Recovery is deaf to channel state | The tick reads no channel column and never asks whether a discovery run exists. | Parent §2 "Channel independence". |

## 3. Contract

`lib/ingestion.ts`:

```ts
export const RECOVERY_CRON = "30 */6 * * *";
export const RECONCILE_AFTER_MS = 60 * 60 * 1000;
export async function reconcileRunningAttempts(env, now): Promise<{ checked: number; lost: number }>;
export async function runRecoveryTick(env, now): Promise<{ reconciled: number; due: number; started: number; blocked: number }>;
```

`reconcileRunningAttempts` lists running attempts started before `now − 1 h`, asks `ingestLauncher(env).status` for
each, and calls `closeLostEpisodeAttempt` on `gone` or `missing`; one attempt whose check or close throws is logged
and does not stop the next. `runRecoveryTick` reconciles, lists due episodes, and hands them all to
`startEpisodeAttempts(env, episodes, "scheduled_recovery")`, which reads pre-flight once and numbers the batch. `now`
(default `Date.now()`) is the selection clock only: the Registry stamps every write with its own clock, as it has since
M3.2, so the starter takes no `now` (implementation decision 2026-09-13, replacing the `{ now }` option first written
here). An episode at or after its deadline is due like any other; `finishAttempt` and an automatic
`recordBlockedAttempt` settle it as the final result (M3.2).

Registry: `listDueEpisodes(now): EpisodeRecord[]`, `listRunningAttempts(startedBefore): EpisodeIngestionAttempt[]`.

`index.ts` dispatches `RECOVERY_CRON`; `wrangler.jsonc` `env.production.triggers.crons` is `["0 */6 * * *",
"30 */6 * * *"]`; no other environment has triggers (`AGENTS.md` → Environments).

## 4. Acceptance criteria

1. `SELF.scheduled({ cron: "30 */6 * * *" })` runs recovery and not discovery; the discovery cron runs no recovery.
2. Due episodes under requested, approved, paused, and declined channels all start attempts; a not-yet-due episode
   does not; one with a running attempt does not; an episode with a closed window does not.
3. A running attempt older than an hour whose fake instance is `gone` or `missing` finishes `WORKFLOW_LOST` and the
   episode's `nextAttemptAt` moves inside its window; `active` stays running; an attempt under an hour is not asked.
4. An episode at or after its deadline gets one attempt when pre-flight permits; an unsuccessful one times out
   publication with the reason in `failureDetail`; an unsuccessful replacement closes with content unchanged.
5. With the provider blocked before the deadline, every due episode gets a `blocked` attempt and moves; at the
   deadline the window closes with the reason in `failureDetail`.
6. A write from the reconciled instance is refused.
7. A null fake feed for every channel does not affect the tick.
8. Start delays increase across the tick by three seconds per attempt, across channels.
9. Both cron strings are in `wrangler.jsonc` and the dispatcher knows both.
10. `pnpm check` green; under `wrangler dev --test-scheduled` both `/__scheduled` calls run, and a captionless
    episode gains a second `waiting CAPTIONS` attempt when the recovery cron fires with its `nextAttemptAt` in the
    past (set by hand on the scratch Registry, recorded in the walkthrough).

## 5. Out of scope

Web changes (M3.7); the `CHECK` (M3.7); any tuning of the six-hour cadence or the 48-hour window (PRD).

## 6. `AGENTS.md` and PRD alignment

No PRD change. `AGENTS.md` → Stack: "The two crons are `triggers` in the same file" becomes true; the Ingestion
implementation bullet for `lib/ingestion.ts` names both ticks.
