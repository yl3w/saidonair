# Implementation plan — Covering the whole episode: short sections and a code-side takeaway quota

**Implements:** `docs/specs/summary-coverage.md` under `AGENTS.md`; follows `docs/specs/summary-quality.md` and
`docs/specs/summary-json-mode.md`.
**Written:** 2026-09-14, against `main` at `e23df5f`.
**Status:** draft, awaiting the owner's approval of the spec. No new dependencies.
**Shape:** one verification step, four code steps, one docs-and-regeneration step. One commit when the owner asks,
`pnpm check` green. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §5, all seven criteria.

### Step 0 — Confirm 20 minutes on a second episode  (size: S)

**Files:** none kept; the throwaway probe worker already written (`/sections`), which reconstructs a transcript from
Vectorize and runs one map call per section. No provider credits.

- 0.1 Run the §2 section-length table on a second long episode — `MGxcosNuC8k` (145 chunks) or `OYg6BTjb90E` (132) —
  at 45, 30, 20 and 12 minutes, recording the same union metrics.
- 0.2 Run 20 minutes twice on `q2cg1gEYWJQ` to put a number on the run-to-run variance the single-sample table hides.

**Plan decision:** if the second episode's knee is at 30 rather than 20, take 30 — two fewer calls per episode for
most of the benefit. If the two disagree without a clear knee, take 20 and record that it was chosen on one episode.

**Done when:** the numbers are under Walkthrough record and the section length is settled.

### Step 1 — Sections and allocation, both pure  (size: M)

**Files:** `apps/api/src/lib/summary.ts`, `apps/api/test/summary.test.ts`.

- 1.1 `SECTION_MAX_SEC` to the length Step 0 settles. The existing even-split tests move with it: a 50-minute episode
  is no longer `[25, 25]`, and the 100-minute case changes shape.
- 1.2 `takeawayCount(durationSec)` replaces `takeawayBudget`, returning a single target (spec §4.1). The band existed
  only so the model could negotiate inside it; nothing negotiates now.
- 1.3 `allocateTakeaways(sections, total)` per spec §4.1: round-robin across sections, evenly spaced within one,
  underfilled quotas redistributed, chronological result.
- 1.4 Tests are the interesting part and should be written first — this is the component that replaces a measured
  model bias, so its distribution properties are the product guarantee. Cover: every section represented before any is
  doubled; an underfilled section redistributes; more requested than exists returns everything; one section returns
  that section; the result is sorted by `startSec`.

**Done when:** `pnpm check` green.

### Step 2 — The synthesis call  (size: M)

**Files:** `apps/api/src/prompts/summary.ts`, `apps/api/src/lib/summary.ts`, `apps/api/src/lib/ai.ts`,
`apps/api/test/ai.test.ts`, `apps/api/test/summary.test.ts`.

- 2.1 `SYNTHESIS_PROMPT` and `synthesisPrompt(sections, takeaways)` replace `REDUCE_PROMPT` and `reducePrompt`
  (spec §4.2); `SYNTHESIS_RESPONSE_SCHEMA` and `parseSynthesis` (spec §4.3).
- 2.2 `Summarizer.reduceSections` becomes `synthesise`, passing the synthesis schema rather than the map's. The
  stub-binding test asserts each call carries its own schema.
- 2.3 `PROMPT_VERSION` to the edit date.

**Plan decision:** `AI_FAKE` gains a canned synthesis answer (`{ executiveSummary, topicTags }`) rather than reusing
the canned summary, because the two calls now have different shapes. The `[[invalid]]`, `[[invalid-once]]` and
`[[throw]]` markers keep working on both.

**Done when:** `pnpm check` green.

### Step 3 — Rewiring the Workflow, and the better fallback  (size: M)

**Files:** `apps/api/src/workflows/ingest.ts`, `apps/api/test/workflow-ingest.test.ts`.

- 3.1 `summarize` follows spec §4.4: map per section, allocate, synthesise, publish.
- 3.2 A failed synthesis no longer produces `raw_fallback`. It publishes `structured` with the allocated takeaways and
  the first section's executive summary and tags. `raw_fallback` is reached only when every map answer is invalid.
- 3.3 Tests: the multi-section case asserts takeaways drawn from every section; a synthesis marked `[[invalid]]`
  publishes `structured` with its takeaways intact; every map invalid still ends `raw_fallback`; the single-section
  path is untouched.

**Done when:** `pnpm check` green.

### Step 4 — Prompt v3 in the map  (size: S)

**Files:** `apps/api/src/prompts/summary.ts`, `apps/api/test/ai.test.ts`.

- 4.1 Map rule 1 bans narrating the recording by naming the openers; rule 2 excludes definitions and
  topic-statements and forbids two takeaways making one point (`summary-quality.md` §4.2). Rule 3 asks for tags of one
  or two words. The 3-to-6 band and the persona line are unchanged.
- 4.2 The prompt assertions follow.

**Plan decision:** this lands after Step 3 rather than before, so that if the regeneration in Step 5 disappoints, the
section and quota changes can be evaluated without the prompt edit confounding them.

**Done when:** `pnpm check` green.

### Step 5 — Docs, regeneration, and the verdict  (size: M)

**Files:** `docs/PRD.md` §4.4 and §9, `AGENTS.md`, `docs/specs/summary-quality.md` (marking §4.2–§4.3 superseded),
this file.

- 5.1 The doc edits of spec §7, and `docs/specs/summary-quality.md`'s status marked superseded where this spec
  replaces it. The 97% span-coverage figure is corrected in spec §2: it appears in commit `e23df5f`'s message, not in
  `summary-quality.md` as first written here.
- 5.2 Regenerate `q2cg1gEYWJQ` and score it against spec §5.7 with `lib/summary-eval.ts`.
- 5.3 If it passes, regenerate the remaining long episodes — roughly 13 of the 20 are multi-section at the new length,
  one provider credit each. **Plan decision:** the owner presses Retry; no agent triggers a sweep that spends credits.
- 5.4 Re-run the scorer across the whole catalog and compare against the 20-episode baseline recorded in
  `summary-quality.md` §2: sentence discipline, openers, duplicates, anonymous subjects, coverage.

**Done when:** `pnpm check` green, `git diff --check` clean, the record below filled in.

## Risks

- **Cross-section duplication** is unmeasured and the reduce is no longer nominally deduplicating. Step 5.4's scorer
  run is what catches it; the mitigation, if needed, is a similarity check inside `allocateTakeaways`, which is a
  contained change to a pure function.
- **Attribution may get worse.** Shorter sections mean each map call sees less context, and "the speaker" already
  appears in 9 of 124 takeaways. Step 5.4 measures it. It is out of scope here (spec §6) but this is the change most
  likely to move it in the wrong direction.
- **Cost roughly doubles** per long episode: 8 or 9 map calls where there were 4. Latency is irrelevant inside a
  Workflow; neurons are not, now that the account is on Workers Paid.
- **Thirteen episodes change path**, from a single map call to sectioned-and-synthesised. The demoted reduce limits
  the blast radius, but this is the widest behaviour change in the plan.

## Walkthrough record

### Step 0 — section length confirmed at 20 minutes, 2026-09-14

Both episodes reconstructed from Vectorize chunk metadata; no provider credits.

**0.1, `MGxcosNuC8k` (145 chunks, ~2h17m):**

| section | sections | offered | union ends | tail lost | widest gap | deciles |
|---|---|---|---|---|---|---|
| 45 min | 4 | 16 | 1:46:58 | 30 min | 30 min | 7/10 |
| 30 min | 6 | 31 | 2:16:26 | 0 min | 20 min | 10/10 |
| **20 min** | 8 | 42 | 2:15:28 | 1 min | **9 min** | 10/10 |
| 12 min | 13 | 53 | 2:07:51 | 9 min | 9 min | 10/10 |

The same shape as `q2cg1gEYWJQ`: 45 loses half an hour, 30 recovers nearly all of it, 20 halves the widest gap again,
and 12 buys nothing while making the tail worse. The knee is at 20 on both episodes, so the spec's choice stands and
was not made on one sample.

**0.2, variance at 20 minutes.** `q2cg1gEYWJQ` twice: 42 offered both times, union ending 2:25:07 both times, widest
gap 11 and 12 minutes, 10 deciles both. `MGxcosNuC8k`: 36 to 42 offered, ending 2:14:32 and 2:15:28, gap 9 to 10
minutes. Against the 45-minute config, which has ended anywhere between 1:54:46 and 2:04:18 across three runs, short
sections are not only better but markedly more repeatable — each map call has an easier job and less room to vary.
That also means the A/B comparisons in Step 5 need fewer samples to be trustworthy than the earlier ones did.

_Step 5 to be filled in._
