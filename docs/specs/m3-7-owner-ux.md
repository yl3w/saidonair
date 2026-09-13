# Feature spec — M3.7 Owner UX and closure

**Written:** 2026-09-13, against `main` at `e37181c`. The last of seven M3 child specs; roadmap
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` §2 (Latest run on catalog rows, Catalog credits and key status, Takeaways
carry timestamps), §7 and §8; PRD §7 Screens (Home, Owner, Owner channel detail), §5.3 (the outcome-code `CHECK`);
`docs/specs/home-read-experience.md` §6 and §7 where they say "M3". Acceptance 7 (copy half), 11, 15, 16, 17 of the
parent, and its end-to-end walkthrough.
**Status:** implemented 2026-09-13 on `main`, uncommitted until the owner asks; `pnpm check` green, the web builds
with no Zod in `dist`; the eight-scenario walkthrough is recorded in `docs/specs/m3-7-owner-ux-plan.md`. The owner's
click-through of the four screens is still to do (the agent has no browser). No new dependencies; the web keeps
`preact`, `preact-iso`, `vite`, `@preact/preset-vite`.

## 1. Summary

The web shows what M3 does, the eight-scenario walkthrough of the parent runs end to end against a real channel, and
the attempt outcome column gets the `CHECK` the owner asked for on 2026-09-12 once every outcome has run for real. The
API is complete before this chunk; every change here is rendering, copy, one new client call, the migration edit
with its test and PRD row, and the closing of the parent spec and the roadmap.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Start | `ChannelStatusActions` gains **Start** on every approved row, paused or not, on the Owner page and the detail; `api.ts` gains `startRun(channelId)`; the row reloads and reads the run's phrase from `runResultCopy`. A 502 renders "Feed unavailable" on the row, not as a page error. | PRD §7 Owner Catalog; the phrase exists since `4871782`. |
| Retry | Enabled on every episode row except while its latest attempt is `running` and started under an hour ago; such a row reads "running for N min". A running attempt older than an hour leaves Retry enabled, since the route reconciles. Skip only on `failed`. Channel status never disables either. | PRD §7 Owner channel detail, rule 17. Replaces today's `canRetry` (failed or skipped, approved only). |
| Episode row copy | The open window reads "publishing" or "replacing · current summary stays"; next attempt and deadline are relative times (`lib/time.ts`); "N launched attempts" sits beside the latest attempt's phrase from `OUTCOME_CODE_COPY`, so a `blocked` latest attempt beside a count of zero explains itself; a `blocked` latest attempt on a pending episode phrases as the matching wait (already true through `waitReason`). Discovery history is its own list above the episodes, never mixed with attempts. | 2026-09-12 plan Step 9. |
| Home | **Refresh** re-runs the lists-then-digest load; the empty states become the three of PRD §7; takeaway links `youtu.be/<id>?t=<startSec>` are verified, not added (they exist). | PRD §7 Home; `home-read-experience.md` §6. |
| Needs attention | Failed publications grouped by channel with the last reason, launched attempts, Retry, Skip (exists; copy verified); never-started rows carry Start. The health strip shows the credits and key status (exists) and no `waiting` figure. | PRD §7 Owner. |
| The `CHECK` | `0001_init.sql` gains `CHECK (outcome_code IS NULL OR outcome_code IN (…fifteen codes…))` on `episode_ingestion_attempts`, edited in place; PRD §5.3's table gains the row; `registry-migrations.test.ts` asserts a sixteenth value is rejected; the owner wipes local state on their word. Done only after the walkthrough has produced every outcome for real, or in tests where a real one is impractical (`WORKFLOW_LOST`, `EMBEDDING_FAILED`, `VECTORIZE_INCOMPLETE`, `SUMMARY_FAILED`, `TRANSCRIPT_TOO_LARGE` are accepted from the fakes). | Owner request 2026-09-12; PRD §5.4 governance is open, so an edit of `0001`, not a `0002`. |

## 3. Contract

Web: `api.ts` `startRun(channelId): Promise<IngestionRunResponse>`; `lib/copy.ts` gains `intentCopy(intent)`,
`runningForCopy(startedAt, now)`, and `attemptCountCopy(n)`; `OwnerChannel.tsx` renders the discovery runs list, the
window fields, and the controls of §2; `Owner.tsx` and `CatalogTable.tsx` carry Start; `Home.tsx` carries Refresh and
the three empty states. No new component library, no state library, one CSS file.

Migration: the `CHECK` of §2; the header comment of `0001_init.sql` notes the 2026-09-13 edit and drops the "lands at
the end of M3" line.

Docs: the parent spec's status becomes complete with the commit list; the roadmap marks every chunk complete; every
"M3" forward reference in `home-read-experience.md`, `api-reference.md` §3.3, PRD §7, and `AGENTS.md` reads as present
tense.

## 4. Acceptance criteria

1. Start appears on every approved row on both Owner screens and nowhere else; clicking it reloads the row with the
   run's phrase; a 502 reads "Feed unavailable" on the row.
2. Retry appears on every episode row, disabled with "running for N min" while the latest attempt is running under
   an hour, enabled otherwise; Skip appears on failed rows only; a declined channel's detail still offers both.
3. The detail shows discovery runs (kind, feed result phrase, discovered count, time) separately from episodes; each
   episode row shows status, window intent copy, next attempt, deadline, launched attempts, the latest attempt's
   phrase, and the summary format.
4. Home's Refresh reloads follows and channels, then the digest; the three empty states render for no follows, follows
   with none approved, and nothing in the window (24 h and 7 d wording).
5. The attention list groups failed publications by channel with reason, attempts, Retry, and Skip; never-started rows
   carry Start; the strip shows credits and key status and no waiting number.
6. `pnpm typecheck` and `pnpm lint` pass for the web; `grep -ril zod apps/web/dist` after `pnpm build` finds nothing.
7. The eight-scenario walkthrough of the parent §"End-to-end walkthrough" is recorded in the plan with attempt ids,
   times, and the credits before and after.
8. A fresh Registry rejects an `outcome_code` outside the fifteen; the PRD §5.3 row exists; `pnpm check` green.
9. The parent spec, the roadmap, and every forward reference are closed as §3 says.

## 5. Out of scope

Chats and preferences (M4); any API change (none is needed; one found here is a defect reported against its chunk);
a retention policy; renaming the repository or packages after the product name (PRD §9, owner decision pending).

## 6. `AGENTS.md` and PRD alignment

PRD §5.3: the `outcome_code` row and the paragraph that promised it at the end of M3. PRD §7: the "(M3)" markers on
Home, Owner, and Owner channel detail read as present. `AGENTS.md`: the Web UI code section's component list names
what exists; no rule changes.
