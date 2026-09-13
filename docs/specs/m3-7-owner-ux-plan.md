# Implementation plan — M3.7 Owner UX and closure

**Implements:** `docs/specs/m3-7-owner-ux.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 9 of the 2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. Requires M3.1–M3.6 on `main`. No new dependencies.
**Shape:** one web step, one walkthrough step, one migration step, one documentation step; each a commit when the
owner asks with `pnpm check` green. The web stays typecheck and lint only (AGENTS.md → Testing). Decisions this plan
makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §4, all nine criteria.

### Step 1 — Web controls and copy  (size: M)

**Files:** `apps/web/src/api.ts`, `apps/web/src/lib/copy.ts`, `apps/web/src/components/ChannelStatusActions.tsx`,
`apps/web/src/components/CatalogTable.tsx`, `apps/web/src/components/AttentionList.tsx`,
`apps/web/src/screens/Owner.tsx`, `apps/web/src/screens/OwnerChannel.tsx`, `apps/web/src/screens/Home.tsx`,
`apps/web/src/components/Digest.tsx`, `apps/web/src/style.css` (if a class is needed).

- 1.1 `api.ts` `startRun`; `copy.ts` per spec §3. **Plan decision:** `runningForCopy` rounds to minutes under an
  hour and to hours after.
- 1.2 `ChannelStatusActions`: Start on approved rows; `CatalogTable` and the detail header pass the reload through.
- 1.3 `OwnerChannel`: the runs list, the episode row fields, the Retry rule of spec §2, Skip on failed.
- 1.4 `AttentionList`: Start on never-started rows; copy check on the failed groups.
- 1.5 `Home` and `Digest`: Refresh; the three empty states.

**Done when:** `pnpm check` green; `pnpm build` then `grep -ril zod apps/web/dist` finds nothing; the four screens
load under `pnpm dev` against the M3.6 scratch state.

### Step 2 — End-to-end walkthrough  (size: M)

**Files:** this file's walkthrough record.

The eight scenarios of the parent §"End-to-end walkthrough", under `wrangler dev --test-scheduled` and `pnpm dev`,
with the DownSub key, on a scratch `--persist-to` directory. Scenario 4 (the 48-hour boundary) is reached by moving
`window_deadline_at` and `next_attempt_at` on the scratch Registry with `sqlite3`, since time cannot be advanced;
scenario 7 (exhausted credits) is reached by pointing `TRANSCRIPTS_FAKE`'s `status` at zero credits in a
`.dev.vars` line for that leg, since spending the real balance is not acceptable. Record each scenario's requests,
attempt ids, and outcomes, and the list of outcome codes observed for real versus through the fakes.

**Done when:** every scenario is recorded with its result and the observed-codes list is complete.

### Step 3 — The `CHECK` on `outcome_code`  (size: S)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `docs/PRD.md` §5.3, `apps/api/test/registry-migrations.test.ts`.

- 3.1 The `CHECK` per spec §2; the header comment; the PRD row and the removal of the "at the end of M3" sentence.
- 3.2 The rejecting write in the migrations test.
- 3.3 The owner wipes local Durable Object state (`/clean-local-do`, on their word) before the next `pnpm dev`.

**Done when:** `pnpm check` green.

### Step 4 — Close the documents  (size: S)

**Files:** `docs/specs/m3-ingestion.md`, `docs/specs/m3-ingestion-plan.md`, the seven child specs and plans,
`docs/specs/home-read-experience.md`, `docs/specs/api-reference.md`, `docs/PRD.md` §7 and §10, `AGENTS.md`.

- 4.1 Status lines to complete with the commit list; the roadmap table; forward references to present tense; the
  `AGENTS.md` layout lines that still say "planned" or "log-only".

**Done when:** `pnpm check` green and `git diff --check` clean.

## Walkthrough record

_Filled in during Step 2._
