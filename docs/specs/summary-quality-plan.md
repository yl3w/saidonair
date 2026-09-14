# Implementation plan — Summary quality: even sections, attribution, and prompt v3

**Implements:** `docs/specs/summary-quality.md` under `AGENTS.md`; follows `docs/specs/summary-json-mode.md`.
**Written:** 2026-09-14, against `main` at `8eef9a6`.
**Status:** CLOSED 2026-09-14. Step 1 IMPLEMENTED that day on the owner's go (commit `67540ad`) and then superseded by
`docs/specs/summary-coverage.md`, which split by chunk count instead. Step 2's prompt v3 shipped as that spec's Step 4.
Step 3 was built, A/B'd against the live model, and **discarded uncommitted** the same day (spec §4.3); Step 4.1's
doc edits landed with the coverage work and 4.2's re-run was answered corpus-wide by that plan's Step 5. Nothing here
is outstanding. No new dependencies.
**Shape:** one landed code step, one step shipped elsewhere, one reverted, one answered elsewhere. Decisions this plan
makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §5, all five criteria.

### Step 1 — Even sections  (size: S)  — DONE

**Files:** `apps/api/src/lib/summary.ts`, `apps/api/test/summary.test.ts`.

- 1.1 `sectionize` takes the count from `ceil(span / maxSec)` and divides the span evenly between that many sections
  instead of filling each to the cap (spec §4.1).
- 1.2 `foldTrailingRunt` folds a last section spanning less than half the target into its neighbour when the combined
  span still fits the cap.
- 1.3 Tests: 50 minutes is `[25, 25]`; 100 is `[33, 33, 34]`, replacing the old `[45, 45, 10]`; across nine episode
  lengths from 46 to 200 minutes no section spans more than `SECTION_MAX_SEC` and none is shorter than half the
  longest. The existing 40-minute single-section and empty cases are unchanged, as is the real-chunker-output test.

**Plan decision:** no `PROMPT_VERSION` bump (spec §3). Nothing about the prompts or the schema changed, and the version
is what tells a stored summary which contract produced it.

**Done when:** `pnpm check` green. *It is: 306 tests.*

### Step 2 — Prompt v3  (size: S)  — SHIPPED ELSEWHERE (`summary-coverage-plan.md` Step 4)

**Files:** `apps/api/src/prompts/summary.ts`, `apps/api/test/ai.test.ts`.

- 2.1 The rules of spec §4.2, both prompts. The persona lines, the strict requirements and the skeletons are untouched
  — the owner set the persona wording on 2026-09-14 and it is not in question.
- 2.2 `PROMPT_VERSION` to the edit date; `2026-09-14.2` if it lands the same day, since `2026-09-14` is taken.
- 2.3 The prompt assertions in `ai.test.ts` follow the new wording: the dedup rule, the no-definitions rule, the banned
  openers, and "one or two words" on the tags.

**Done when:** `pnpm check` green.

### Step 3 — Attribution  (size: S)  — BUILT AND REVERTED 2026-09-14 (spec §4.3)

**Files:** `apps/api/src/prompts/summary.ts`, `apps/api/src/workflows/ingest.ts`, `apps/api/test/ai.test.ts`,
`apps/api/test/workflow-ingest.test.ts`.

- 3.1 `mapPrompt(transcript, { title })` renders `Episode title: <title>.` above the transcript (spec §4.3), and rule 2
  gains the describe-by-role clause.
- 3.2 The Workflow passes the episode's title, which `load` already reads.
- 3.3 Tests: the rendered prompt carries the title; the multi-section workflow case sees it in every section's prompt,
  so the section with no introduction in it still has something to attribute to.

**Plan decision:** the title only. A header taken from the episode's opening minutes would help more and costs a design
decision about how much of the transcript to repeat into every section; it is out of scope (spec §6) and worth its own
spec if the title proves not to be enough.

**Done when:** `pnpm check` green.

### Step 4 — Docs and the re-run  (size: S)  — 4.1 DONE, 4.2 ANSWERED BY `summary-coverage-plan.md` STEP 5

**Files:** `docs/PRD.md` §4.4 and §9, `AGENTS.md` (layout comment), this file.

- 4.1 The doc edits of spec §7.
- 4.2 Owner Retry on the two episodes of spec §2, one transcript credit each, and the answers written below: does the
  CBC summary now reach minutes 20 to 44, is anyone still "the speaker", do any two takeaways still make one point, do
  the summaries still open by narrating the speakers, and is the executive summary three sentences.

**Done when:** `pnpm check` green, `git diff --check` clean, the record below filled in.

## Walkthrough record

### Step 1, 2026-09-14

Not a live run: `sectionize` is pure, and the evidence that drove it is the CBC episode already recorded in spec §2.
The old behaviour is pinned by the test that changed — `[45, 45, 10]` for a hundred minutes became `[33, 33, 34]` —
and the runt it produced is pinned by the new 50-minute case, `[25, 25]` where greedy filling gave 45 + 5.

_Nothing further to record here: Step 2 shipped under `summary-coverage-plan.md`, Step 3's measurements are in spec
§4.3, and Step 4.2's re-run became that plan's Step 5 regeneration._
