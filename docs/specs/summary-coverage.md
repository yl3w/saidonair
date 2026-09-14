# Feature spec — Covering the whole episode: short sections and a code-side takeaway quota

**Written:** 2026-09-14, against `main` at `e23df5f`. Supersedes `docs/specs/summary-quality.md` §4.2–§4.3, whose
proposals were written before the measurements below and are partly contradicted by them; PRD §4.4 governs.
**Status:** APPROVED and IMPLEMENTED 2026-09-14, Steps 0 to 5.1; `pnpm check` green at 316 tests. Only the
regeneration and its verdict (plan Steps 5.2–5.4) are outstanding, and they are the owner's to trigger — each episode
spends a provider credit. One decision below (§3, splitting by chunk count) was made during implementation, not
before: the even split this spec inherited leaves a runt at some lengths. Plan:
`docs/specs/summary-coverage-plan.md`. No new dependencies.

## 1. Summary

A 146-minute episode's summary reaches 1:56:41 and then stops, leaving 29 minutes — including several concrete,
quotable claims — out of the digest entirely. Two separate causes were measured on 2026-09-14, and this spec fixes
both. Sections of 45 minutes are too long: each map call trails off in its own last third, so a long section leaves a
long hole. And the reduce, asked to pick 15 to 18 takeaways from its sections, fills the list from the front and
stops. Shorter sections make the holes small; moving the selection out of the prompt and into code makes them even.
The reduce keeps the job it is good at — writing three sentences about an episode — and loses the job it demonstrably
is not.

## 2. What was measured

All on `q2cg1gEYWJQ` ("Vanessa Van Edwards", 146 minutes, 155 chunks), transcript reconstructed from Vectorize chunk
metadata, so no provider credits were spent on any of it.

**Section length against coverage of the whole episode.** One map call per section, union of every section's markers:

| section length | sections | takeaways offered | union ends | tail lost | widest gap | deciles touched | calls |
|---|---|---|---|---|---|---|---|
| 45 min (today) | 4 | 21 | 1:54:46 | **32 min** | **32 min** | 8/10 | 4 |
| 30 min | 6 | 28 | 2:24:10 | 2 min | 23 min | 10/10 | 6 |
| **20 min** | **9** | **42** | **2:25:07** | **1 min** | **13 min** | **10/10** | **9** |
| 12 min | 14 | 57 | 2:19:26 | 7 min | 8 min | 10/10 | 14 |

Mean per-section coverage barely moves across that table (61%, 69%, 64%, 62%): every section trails off in its own
last third regardless of length. What changes is how much wall-clock a trailing-off costs. This is n=1 per row and the
45-minute row has been observed anywhere between 1:54:46 and 2:04:18, so the exact optimum is not established; the
direction is, since 30, 20 and 12 all reach past 2:19 and 45 never has in three observations.

**Selection strategy, with section outputs held constant.** Same four sections, three ways of choosing from them:

| arm | count | ends | widest gap | tail lost | deciles |
|---|---|---|---|---|---|
| A — the reduce chooses, band 15–18 (today) | 16 | 1:56:41 | 30 min | 30 min | 7/10 |
| B1 — a quota sentence added to the prompt | 17 | 2:04:18 | 25 min | 22 min | 7/10 |
| B2 — the quota applied in code | 20 | 2:04:18 | 25 min | 22 min | 8/10 |

Arm A reproduced the production run exactly (16 takeaways, last at 1:56:41), so the comparison is sound. Both quota
arms reach the latest marker any section produced; neither can exceed it, which is what §2's first table is about.

**The uncovered tail is not sign-off.** The 24 chunks after 2:04 contain "you're better off making eye contact in the
first few seconds", "my lack of vocal care… tunes you out", "being dynamic based on the cues you're getting back".
Four or five real takeaways in the same register as the sixteen that were kept. Only the last chunk is the closing
tradition.

**A correction.** Commit `e23df5f`'s message states that "span coverage inside a 45-minute section measures 97% over
three runs", and that figure was used to argue the map was not at fault. It was measured on a synthetic transcript
built by repeating real content, which is artificially uniform, and it does not hold: on real content the four
sections of this episode covered 79%, 55%, 37% and 22% of their own spans. The map is part of the problem, which is
what the first table above is about. Do not rely on the 97%.

## 3. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| How a section is divided | **By chunk count, not by filling each to a time target.** `ceil(span / maxSec)` near-equal groups of chunks; one more section is tried if sparse speech makes a group span more than the cap. `foldTrailingRunt` is deleted. | Found in Step 1 by the property test, not predicted here: filling greedily to a time target wastes part of a chunk each section, and at 135 minutes that accumulated into seven 19-minute sections and a **2-minute runt** its neighbour could not absorb without breaching the cap. A 2-minute section draws a full map call and a full share of the takeaway budget — the over-representation this spec exists to remove. Dividing by count cannot leave a remainder, and since chunks are token-bounded it balances what each call reads. |
| Section length | `SECTION_MAX_SEC` 45 → **20 minutes**. | §2: the tail loss falls from 32 minutes to 1 and every decile is touched. 30 minutes captures most of it for two fewer calls; 12 costs five more calls, tightens the widest gap to 8 minutes, and makes the tail slightly worse. 20 is the knee. |
| Who picks the takeaways | **Code, not the model.** A pure `allocateTakeaways` distributes the budget across sections and selects within each; the reduce is not asked for takeaways at all. | Measured twice: asked to select across sections, the model fills from the front and stops. A quota sentence helps (B1) but leaves the choice with a component whose bias we have quantified. Code cannot front-load. |
| What the reduce becomes | A **synthesis call**: it returns `executiveSummary` and `topicTags` only, against its own schema. | It keeps what it is good at. Removing takeaways from its output also removes its opportunity to emit a malformed or invented timestamp, and shortens the answer it has to get right. |
| The reduce's fallback | When synthesis fails twice, **keep the allocated takeaways** and take the executive summary from the first section, marking the summary `structured` still. `raw_fallback` is reserved for a *map* failure, where there is genuinely nothing structured to publish. | Today a failed reduce discards perfectly good section takeaways and publishes raw text. Under this design the takeaways never depended on that call, so the reader keeps a navigable summary. PRD §4.4's preference for structured output over raw text argues for it. |
| Within a section | Evenly spaced by index, not the first *k*. | A section's takeaways are chronological (map rule 2), so taking the first *k* reproduces the front-loading one level down. |
| A section that underfills | Its unused quota is redistributed to sections that have more to give, in order. | A section covering a quiet stretch should not hold places open. |
| Cross-section duplicates | **Not deduplicated in v1**; measured after. | The reduce nominally deduplicated and the lexical scorer still flagged 40% of episodes, so its dedup was not doing much. With 8 sections × 2 takeaways duplication is plausible but unquantified, and `lib/summary-eval.ts` can measure it on the regenerated corpus. Building dedup first would be speculative. |
| Mid-length episodes | Accepted: at 20 minutes, everything over 20 minutes is sectioned, where today only 45+ is. Roughly 13 of the 20 catalog episodes change path. | More coverage for them too, and the risk that this routes them through the reduce is what demoting the reduce to synthesis removes. |
| Prompt v3 | **Folded in here** rather than shipped separately: the opener ban and the no-definitions rule land in the same edit. | The summary text still opens "The conversation revolves around…" in 70% of the corpus. Everything here requires regenerating the long episodes; doing prompts separately means regenerating twice. |
| `PROMPT_VERSION` | Bumps. | The reduce's output contract changes shape, not just its wording. |
| Model choice | Unchanged. | The 24,000-token window is ample for a 20-minute section (~6k tokens), and `summary-quality.md`'s walkthrough records that bigger-context models lose timestamps. |

## 4. Contract

### 4.1 `lib/summary.ts`

`SECTION_MAX_SEC = 20 * 60`. `sectionize` divides the chunks into `ceil(span / maxSec)` near-equal groups **by count**
and raises the count if any group still spans more than the cap; `foldTrailingRunt` is deleted, having existed only to
patch the remainder that time-filling left behind.

`takeawayBudget(durationSec)` collapses to a single target, since nothing negotiates a range any more:

```ts
/** How many takeaways a multi-section episode's summary carries; one per eight minutes, 5 to 20. */
export function takeawayCount(durationSec: number | null): number;
```

```ts
/**
 * The budget distributed across sections, then spread within each. Pure, so the distribution is
 * testable without a model. Sections keep their order, so the result is chronological.
 */
export function allocateTakeaways(
  sections: readonly StructuredSummary[],
  total: number,
): StructuredSummary["takeaways"];
```

Round-robin: every section yields its first selection before any yields a second, so a section is never unrepresented
while another has two. Within a section, indices are spaced evenly across what it produced. A section with fewer
takeaways than its quota returns what it has and the remainder is offered to the others.

### 4.2 `prompts/summary.ts`

`MAP_PROMPT` keeps its structure; rule 1 gains prompt v3's ban on narrating the recording, and rule 2 gains the
no-definitions and no-topic-statement exclusions (`summary-quality.md` §4.2). Its 3-to-6 band is unchanged: a
20-minute section yielding 3 to 6 is exactly what §2 measured.

`SYNTHESIS_PROMPT` replaces `REDUCE_PROMPT`. It receives the section summaries and the takeaways already selected, and
returns two fields:

> OUTPUT STRUCTURE:
> {
>   "executiveSummary": "…",
>   "topicTags": ["…"]
> }

with rule 1 as prompt v3's (exactly three sentences, the three-part template, no labelling of the parts, no opening a
sentence with "The conversation", "The discussion", "The speakers", "This episode") and rule 2 consolidating tags to 3
to 8 of one or two words. `synthesisPrompt(sections, takeaways)` renders it.

### 4.3 `lib/summary.ts` schemas and validation

`SUMMARY_RESPONSE_SCHEMA` is unchanged and remains the map's. `SYNTHESIS_RESPONSE_SCHEMA` is new, `{ executiveSummary,
topicTags }`, built from the same tag bounds. `parseSynthesis(raw)` validates it and returns
`{ executiveSummary, topicTags } | null`, reusing `parseSummary`'s helpers.

### 4.4 `workflows/ingest.ts`

```
sections = sectionize(chunks)                      // 20-minute sections
answers  = sections.map(map call)                  // unchanged, one step each
if sections.length === 1 → publish that answer     // unchanged
else:
  takeaways = allocateTakeaways(structured answers, takeawayCount(durationSec))
  synthesis = synthesis call (one step, one stricter retry)
  publish { executiveSummary: synthesis?.executiveSummary ?? answers[0].executiveSummary,
            takeaways, topicTags: synthesis?.topicTags ?? answers[0].topicTags }
```

A map answer that stays invalid after its retry contributes nothing to the allocation; if *every* section fails, the
attempt ends `SUMMARY_FAILED` as today, and the raw fallback stores the first section's raw text.

## 5. Acceptance criteria

1. `sectionize` divides a 146-minute episode into 8 sections of about 18 minutes; a 20-minute episode stays one; and
   across a range of lengths no section exceeds the cap and none is shorter than half the longest — 135 minutes is the
   case that used to leave a 2-minute runt.
2. `allocateTakeaways` is exercised as a pure function: every section represented before any is represented twice; an
   underfilled section's quota is redistributed; the result is chronological; asking for more than exists returns all.
3. `takeawayCount` matches the table of `summary-quality.md` (50 min → 6, 146 min → 18, clamped 5 to 20).
4. `synthesisPrompt` carries the v3 rule 1 and asks for two fields; `parseSynthesis` rejects an answer carrying
   takeaways-only or an empty summary; the stub binding sees `SYNTHESIS_RESPONSE_SCHEMA` on the synthesis call.
5. A failed synthesis publishes a `structured` summary with the allocated takeaways and the first section's executive
   summary — not `raw_fallback`. Driven by the fake's `[[invalid]]` marker on the synthesis prompt alone.
6. `pnpm check` green.
7. **Regeneration of `q2cg1gEYWJQ` under `wrangler dev --env dev`**, scored with `lib/summary-eval.ts` against the
   pinned baseline (7 takeaways, last 1:48:07, 38-minute tail; and the current 16 / 1:56:41 / 29-minute tail):
   16 to 18 takeaways, last marker past **2:15**, widest gap **≤ 15 minutes**, all 10 deciles touched, and the
   executive summary opening on the subject rather than on the conversation.

## 6. Out of scope

Cross-section deduplication (measured first, §3); the model choice; attribution and the "the speaker" problem
(`summary-quality.md` §4.3), which shorter sections may worsen by giving each call less context and which deserves its
own measurement; regenerating the whole catalog; M4 retrieval.

## 7. `AGENTS.md` and PRD alignment

PRD §4.4: the takeaway bullet gains that the count scales with runtime and that the selection is ours, not the
model's; the summary-failure bullet gains that a failed synthesis keeps its takeaways. PRD §9 gains one entry. The
`AGENTS.md` layout comment lists `summary-coverage`, and its AI-code bullet notes that `prompts/` now carries a map
and a synthesis prompt with separate schemas.
