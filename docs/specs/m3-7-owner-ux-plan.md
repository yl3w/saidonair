# Implementation plan — M3.7 Owner UX and closure

**Implements:** `docs/specs/m3-7-owner-ux.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 9 of the 2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 in the working tree on `main` (uncommitted until the owner asks): Steps 1, 3, and 4
landed, Step 2 run against real channels and recorded below; `pnpm check` green (36 test files, 293 tests; the
migrations test grew one rejecting insert inside an existing case), `pnpm build` clean with no Zod in `apps/web/dist`.
The owner's browser click-through of the four screens against a scratch state remains (the agent has no browser).
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

Run on 2026-09-13, 19:39–19:51 UTC, under `wrangler dev --env dev --test-scheduled --port 8797 --persist-to` a fresh
scratch directory (so the `0001` edit of Step 3 applied on first access), the owner's DownSub key, remote Workers AI and
`media-rag-dev`, the local Workflow engine. Identities `alice@example.com` (adds, follows, reads) and
`owner@example.com` (approves, declines, retries, starts). Scenario 7's block was produced by starting the server once
with `--var TRANSCRIPTS_FAKE:{"status":{"status":"ok","remainingCredits":0},"videos":{}}` (**plan decision**, replacing
the `.dev.vars` line: the owner's file is not edited); scenario 4's deadline by moving the window with `sqlite3` on the
scratch Registry while the server was stopped, as Step 2 foresaw. One leg was rerun: the first zero-credit start did not
take the port from a server that had outlived its wrapper process, so its recovery attempt ran against the real
provider and skipped a short; the leg was redone on another short once the port was free.

| # | Scenario | What happened |
|---|---|---|
| 1 | First approval while system-paused | alice added Veritasium (`initialImportCount: 3`) and unfollowed; the owner's approval answered `paused: true`, `latestRun { initial, read, 3, limit 3 }`, `episodes.pending: 3`, and three attempts started at once. All three were shorts: `skipped SHORT` within 20 s (`3bb68fce…`, `6ce8694e…`, `334fbac9…`). |
| 2 | Captioned content becomes available | Computerphile (`initialImportCount: 1`): `iuHddnIzKRA` `available` 55 s after approval, 29 chunks, structured summary, `summaryAvailableAt 1789328464763`. Captionless, live, provider, technical, and large-transcript recovery: not producible on demand (no such upload at hand); covered by the M3.5 and M3.6 fixture tests and by M3.6's real-engine walkthrough of a due replacement. |
| 3 | Decline during recovery | With a due `replace` window on `iuHddnIzKRA` (set by hand), the owner declined Computerphile: alice's digest went from one item to none while the owner's episode view kept it. The discovery cron recorded no run for the declined channel (runs list unchanged); the recovery cron started `scheduled_recovery` `e9057d9e…`, which republished in 44 s while declined, `attemptCount 2`, first availability unchanged. Re-approval put the episode back in alice's digest. |
| 4 | The 48-hour boundary | `oR94cicO7xM` set `pending` in a `publish` window whose deadline had passed an hour earlier; under the zero-credit block the recovery tick (`due: 1, blocked: 1`) recorded `scheduled_recovery blocked PROVIDER_LIMIT` `cc734129…` and the episode became `failed INGESTION_TIMEOUT` with `failureDetail PROVIDER_LIMIT`, `attemptCount` untouched. |
| 5 | Retry a failed episode while declined | Veritasium declined; Retry on `oR94cicO7xM` answered `owner_retry running` `1b130862…` with a fresh `publish` window; the attempt finished `skipped SHORT` in under 10 s; the runs list (initial + one Start) and the channel row (declined) did not change. |
| 6 | Retry an available episode | Retry on `iuHddnIzKRA`: `owner_retry running` `e057a945…` while the row stayed `available`, structured, `intent replace`; 40 s later the replacement was active with `summaryAvailableAt` unchanged; the ledger shows generations `a5c40608…` (first) and `2cf90437…` (replacement); `wrangler vectorize get-vectors` returned `iuHddnIzKRA:2cf90437…:0` and nothing for the old id; the index count showed the old generation deleted. |
| 7 | Exhausted credits | Under the block: `GET /catalog` `transcripts { ok, 0 }` and no `waiting` figure anywhere in its body; Retry on the timed-out `oR94cicO7xM` returned `owner_retry blocked PROVIDER_LIMIT` `bb944458…` and left the episode `failed`; alice added Kurzgesagt (1) and the approval still recorded `initial · read · 1` with the episode `pending`, `waitReason PROVIDER_LIMIT`, `channel_ingestion blocked` `54366f2f…`, `attemptCount 0`, next attempt six hours on. Restarted with the real provider and the next attempt moved due by hand, the recovery tick started `scheduled_recovery` `7477d028…`, which finished `skipped SHORT`: recovery resumed. |
| 8 | Owner discovery history | Start on Veritasium answered `scheduled · read · 0`; `GET /channels/:id/runs` lists `initial · read · 3 · limit 3` and `scheduled · read · 0`; the run shape carries no attempt outcome; the web phrases them through `runResultCopy` ("3 episodes discovered", "nothing new", "feed unavailable"). |

Outcome codes observed for real during M3 (this record and the child records): `SHORT` (attempts), `PROVIDER_LIMIT`
(blocked, automatic and owner), `INGESTION_TIMEOUT` (episode failure code, with `PROVIDER_LIMIT` as detail),
`WORKFLOW_LOST` (M3.6's walkthrough against the real engine, a planted running attempt whose instance never existed),
and `available` publications and replacements. Observed through the fakes only: `CAPTIONS`, `LIVE_OR_UPCOMING`,
`NON_ENGLISH`, `UNPLAYABLE`, `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `PROVIDER_HTTP`, `PROVIDER_PARSE`,
`TRANSCRIPT_TOO_LARGE`, `EMBEDDING_FAILED`, `VECTORIZE_INCOMPLETE`, `SUMMARY_FAILED`. The DownSub probe of M3.1 saw the
real responses behind `LIVE_OR_UPCOMING` and `UNPLAYABLE` (a live stream, a bogus id) without an attempt.

Credits: `transcripts.remainingCredits` 2125 before, 2115 after (the reading is cached for a few minutes). Ten to
eleven DownSub calls: three captioned episodes (the first summary, the Retry replacement, the recovery replacement) and
seven or eight shorts. **Observation for the owner:** a short costs a credit too, because its duration is learned from
DownSub's answer; YouTube's feed carries no duration. The dev index ended at 113 vectors: the 84 of the M3.5 and M3.6
scratch states plus this run's 29, since every scratch state writes to the same `media-rag-dev`.

Decisions made while implementing (plan decisions, stand unless vetoed):

- `relativeTime` learned the future ("in 5h") for next attempt and deadline; `MINUTE` and `HOUR` are exported from
  `lib/time.ts` for the copy helpers.
- `runningForCopy` renders beside the disabled Retry as muted text; the button also carries a title.
- `actionErrorCopy` maps a 502 (`UPSTREAM_UNAVAILABLE`) to "Feed unavailable" for every owner action on a row; other
  errors keep their message. `failureDetailCopy` phrases a timed-out episode's detail through `OUTCOME_CODE_COPY`.
- The detail's Status column carries the wait, skip, or timeout phrase; the Attempts column reads "N launched
  attempts · <latest phrase> (<trigger>)"; the Window column reads the intent copy with next attempt and deadline.
- `api.retryEpisode` is typed `EpisodeRetryResponse` (the route's actual answer since M3.5); no API change.
- The `CHECK` landed before the walkthrough so the fresh scratch Registry ran on the final schema; the owner wipes local
  Durable Object state (`/clean-local-do`) before the next `pnpm dev` on their own state.
