# Implementation roadmap — M3 Ingestion

**Implements:** `docs/specs/m3-ingestion.md`, under `AGENTS.md`.
**Written:** 2026-09-08. **Revised:** 2026-09-12 for the functional separation of channel discovery and episode
recovery; **2026-09-13** split into seven child specs and plans, each a chunk the owner can approve, build, and walk
through on its own. This file is now the roadmap: the order, the dependencies, the status of each chunk, and the
decisions the split itself made. The step-by-step detail lives in the child plans; the 2026-09-12 single plan is
preserved in git history at `a94921d` and `16949b3`.
**Status:** roadmap; M3.1 complete 2026-09-13 (`5a73f18`; its Step 0 found that the `media-rag` index does not exist
on the account, that the pool runs Workflows, that `remoteBindings: false` keeps tests offline, and that test-side
`env` assignments reach `SELF`); M3.2 complete the same day (`620fe88`). Also 2026-09-13: three Wrangler environments
(`AGENTS.md` → Environments), so M3.3 and M3.5 declare their bindings per environment with tier-named resources, and
the crons of M3.4 and M3.6 go into `env.production` only. M3.3 complete later that day (`795ca1b`; its probe measured
10–80 s before a Vectorize write is readable on a fresh index); M3.4 complete (`6d6b422`): approval and Start
discover, the discovery cron runs in production. M3.5 committed the same day: summaries exist,
three Computerphile episodes published end to end under `wrangler dev` in 50 s, a replacement in 25 s. No new
dependencies anywhere in M3.

`docs/specs/m3-ingestion.md` stays the one decision record for M3. A child spec adds only the decisions its chunk
needs, names the parent §2 rows it implements, and never restates them. Where a child and the parent disagree, the
parent governs and the child is the one to fix; where the parent and PRD disagree, the PRD governs.

## The seven chunks

| # | Spec and plan | Carries from the 2026-09-12 plan | Size | Depends on | Product-visible | Status |
|---|---|---|---|---|---|---|
| M3.1 | `m3-1-transcripts-chunking.md`, `-plan.md` | Steps 0, 1, 2 | M | nothing | no | complete 2026-09-13 (`5a73f18`) |
| M3.2 | `m3-2-attempt-ledger.md`, `-plan.md` | Step 4 (the writes) | L | nothing in M3 (`4871782`) | no | complete 2026-09-13 (`620fe88`) |
| M3.3 | `m3-3-ai-vectorize.md`, `-plan.md` | Step 5 minus the Workflow binding and the retrieval test | L | M3.1 (`TranscriptChunk`) | no | complete 2026-09-13 (`795ca1b`) |
| M3.4 | `m3-4-discovery.md`, `-plan.md` | Step 7 discovery half, Step 8 discovery cron | M | M3.2 | yes: runs and pending episodes | complete 2026-09-13 (`6d6b422`) |
| M3.5 | `m3-5-episode-workflow.md`, `-plan.md` | Step 6, Step 7 episode half, Step 5's Workflow binding, the digest basis | L | M3.1–M3.4 | yes: summaries | implemented and committed 2026-09-13 |
| M3.6 | `m3-6-recovery.md`, `-plan.md` | Step 8 minus discovery cron and the lost-attempt helper | M | M3.5 | yes: six-hourly recovery | approved, not started |
| M3.7 | `m3-7-owner-ux.md`, `-plan.md` | Step 9 | M | M3.1–M3.6 | yes: Owner screens, Refresh, Start | approved, not started |

Order: M3.1 and M3.2 in either order or in parallel; M3.3 any time before M3.5; then M3.4, M3.5, M3.6, M3.7 in
sequence. Step 3 of the 2026-09-12 plan was struck on 2026-09-12 (delivered by `api-reference-plan.md` Step 3) and
has no chunk.

## Decisions the split made (2026-09-13)

- **Discovery lands before the Workflow.** M3.4 creates episodes whose first attempt is only a log line until M3.5
  replaces the body of `startEpisodeAttempts`. PRD §4.2 rule 5's "immediately" is deferred by one chunk while
  nothing is deployed; the seam is one function with no call-site change.
- **The digest's availability basis is M3.5's.** PRD §4.4 says the digest route carries `summaryAvailableAt` in M3;
  the 2026-09-12 plan had no step for it. It belongs where episodes first become available.
- **The retrieval generation-check test moves to M4.** Step 5 listed "the retrieval generation check dropping a
  stale hit and refilling"; nothing queries for chat until M4, so the test would exercise only the fake. M3.3
  delivers `parseVectorId`, the contract that check will use.
- **The lost-attempt helper lands with Retry (M3.5), not with the sweep (M3.6).** Retry needs it first and the fake
  launcher it is tested against arrives in the same chunk.
- **Step 0 runs first, inside M3.1**, with one added check: whether `env` assignments from `cloudflare:test` reach
  `SELF`. Its answers decide how M3.2 and M3.5 test blocked starts and Workflow instances.
- **A lost attempt is due six hours later, capped at the deadline** (M3.6), the universal rule, reading PRD rule
  15's "due within its existing window" as "still owed inside it". The owner may reverse this to "due now".

## Already done, never re-plan

From `docs/specs/api-reference-plan.md` (complete 2026-09-12): the rewritten Registry `0001`, the read model for
runs, episodes, attempts, and the four counts, the derived ingestion times, Skip in any channel status, Retry's window
re-opening and its running-attempt refusal, the DownSub `/status` wrapper behind `GET /catalog`, the shared contract
(`AttemptOutcomeCode`, `EpisodeRetryResponse`, `IngestionRunResponse`, `TranscriptProviderHealth`, …), the web's
copy tables for statuses, skip and wait reasons, outcome codes, and run results, and the seed helpers in
`test/helpers.ts`. From `docs/specs/follows-single-owner.md` (complete 2026-09-13): eligibility as one Registry
join, which M4 retrieval will call.

## Definition of complete for M3

`docs/specs/m3-ingestion.md` §7, all nineteen criteria, each owned by a chunk as its header lists; the parent's
end-to-end walkthrough recorded in `m3-7-owner-ux-plan.md`; the `CHECK` on `outcome_code` in `0001`; `pnpm check`
green; every forward "M3" reference in the specs, the PRD, and `AGENTS.md` in the present tense.

## Walkthrough record

Each child plan carries its own. M3.7's record is the end-to-end one.
