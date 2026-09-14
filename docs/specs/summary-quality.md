# Feature spec — Summary quality: even sections, attribution, and prompt v3

**Written:** 2026-09-14, against `main` at `8eef9a6` (summary prompt v2 and JSON mode). A follow-up to
`docs/specs/summary-json-mode.md`, whose Step 3.2 walkthrough produced the evidence below; PRD §4.4 governs.
**Status:** §3's first two rows shipped on 2026-09-14 and were then **superseded the same day** by
`docs/specs/summary-coverage.md`, which replaced greedy even-splitting with a split by chunk count and moved the
section length from 45 minutes to 20. §4.2's prompt v3 shipped as that spec's Step 4. §4.3's attribution proposal is
still open and unimplemented. Plan: `docs/specs/summary-quality-plan.md`. No new dependencies.

## 1. Summary

Prompt v2 shipped on 2026-09-14 and two real episodes were read the same day, the first summaries anyone has judged on
real content rather than the fixture. The mechanics hold up: valid structured output both times, the takeaway counts
inside their bands, the markers distinct and ascending, and the reduce path working end to end with its timestamps
intact. What does not hold up is what a reader actually gets. One episode lost half its running time to a bad section
split, another four takeaways in a row to an unnamed "the speaker", and both wasted takeaways on definitions,
restatements, and the introduction's statement of the topic. This spec fixes the section split in code (done), proposes
prompt v3 against the specific failures, and proposes giving the map call enough context to name a speaker.

## 2. What the first two real episodes showed

**Computerphile, "The AI Language We Can't Read: Neuralese", 27 minutes, one section, map only.**

Right: six takeaways, which is the map prompt's "lean toward 6 when the transcript runs past twenty minutes" answering
correctly. Markers at 0:57, 4:40, 13:14, 16:58, 20:43 and 24:32 — **distinct, ascending and spread across the whole
runtime.** That settles the question the Step 0 probe left open: the all-`0:00:00` markers there were the synthetic
fixture having no moment to point at, not a defect in the prompt's rule 2. Eight lowercase tags.

Wrong: the executive summary ran to **four** sentences where the prompt asks for exactly three. Two of the six
takeaways were definitions of terms ("Chain of thought is a technique used to…"), not a claim any speaker made. Two
more were **the same claim at two timestamps** — the new model uses opaque recurrence and experts are concerned, at
0:57 and again at 20:43. And three of the four summary sentences narrated the speakers rather than the subject: "The
conversation revolves around…", "The speakers discuss…", "The speakers also touch on…", with no conclusion anywhere.
Roughly three of six takeaways carried independent information.

**CBC News, "The House: Why separatists still think they can win Alberta's referendum", 49 minutes, two sections, the
reduce ran.**

Right, and it matters: this is the real episode `docs/specs/summary-json-mode.md` criterion 5 was still owed.
Structured through the reduce, seven takeaways inside the 5–8 band, chronological, exactly three sentences. Four of
those takeaways come from the second section (44:16 to 49:02) **carrying correct timestamps**, which is only possible
because `formatSectionSummary` renders the reduce's input back to `[h:mm:ss]` markers. Before that fix every reduced
takeaway was null. Criterion 5 is satisfied.

Wrong, and both faults trace to the same cause. The takeaways fall at 0:01, 4:41, 19:45 — then nothing for
twenty-four minutes — then 44:16, 46:08, 48:05 and 49:02. `sectionize` filled greedily to the 45-minute cap, so a
50-minute episode became a 45-minute section and a **5-minute tail**; each got its own map call and its own 3–6
takeaways, and the reduce weighs every section alike. The tail was represented about eight times more densely per
minute than the body, and minutes 20 to 44 of a public-affairs programme are invisible to the reader. Then four
consecutive takeaways say **"The speaker"** with no name, while the two from the first section name François-Philippe
Champagne and the pollster Janet Brown — because that is where the introductions happened. The second section's map
call never saw anyone introduced, and by the time the reduce runs the name is gone for good. Three of the seven
restate one grievance (Alberta is treated unfairly / wants a fair deal / wants respect on its own terms) despite the
reduce rule saying "deduplicated". The 0:01 takeaway is the introduction restating the title. And the summary wrote
"**The key conclusion is that**…", echoing rule 1's own scaffolding back at us, after opening the sentence before it
with "The discussion revolves around" — the same stock phrase the Computerphile summary used.

## 3. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| The section split | **Even, not greedy. IMPLEMENTED.** The count is `ceil(span / maxSec)`, the fewest sections of at most 45 minutes the episode needs; the span is then divided evenly between them. A 50-minute episode is two 25-minute halves, not 45 + 5; 100 minutes is 33/33/34, not 45/45/10. | The reduce weighs sections alike, so an uneven split is a silent weighting of the episode. The cap is a ceiling on what one map call reads, never a target to fill. |
| A rounding remainder | Dividing on chunk boundaries can round a section past the target and leave a short last one. `foldTrailingRunt` folds a tail spanning less than half the target back into its neighbour when the cap still allows. **IMPLEMENTED.** | The runt is the exact thing even sections exist to prevent; it should not come back through the arithmetic. |
| Does the split bump `PROMPT_VERSION`? | No. | The version names the output contract — the prompt texts and the schema. How the pipeline divides an episode before it prompts is not part of that, and existing summaries are not regenerated under either reading. |
| Duplicate takeaways | Both prompts forbid it explicitly, and the reduce's existing "deduplicated" is spelled out as a rule rather than a word: several passages making one point become one takeaway, keeping the earliest marker. | The map never had the instruction at all, and the reduce ignored the bare word. Both episodes duplicated. |
| Definitions and topic statements | Both prompts exclude them: no definition of a term the reader could look up, and nothing whose content is only the episode's topic. | Four wasted takeaways across two episodes, including one that was the title plus "is a complex issue with strong opinions on both sides". |
| Meta-narration | Rule 1 in both prompts bans the openers by name — "The conversation", "The discussion", "The speakers", "This episode" — and tells the reduce not to label the three parts. | "Revolves around" appeared in both episodes and "The key conclusion is that" quotes the rule back at us. The reader wants the subject, not a report on the recording. |
| Tags | "3 to 8 short lowercase tags" becomes "one or two words each". | "short" is being read loosely: "chain of thought" and "opaque recurrence" are phrases. |
| Attribution | **Proposed, own step, owner's call.** `mapPrompt` takes the episode title alongside the transcript, and rule 2 asks the model to name the person who made a point when the transcript identifies them, and to describe them by role — never "the speaker" — when it does not. | A section that contains no introduction cannot name anyone, and the reduce cannot recover what the map never wrote. The title is the cheapest context that helps; anything richer (a header from the episode's opening minutes) is a larger change and is out of scope here. |
| Sentence count | Still not validated (the 2026-09-13 decision stands), though v2 missed it once in two episodes. | Unchanged: a structured summary that runs long still beats a raw fallback. If v3 keeps missing it, the honest fix is to relax the prompt to "three sentences, four at the most", not to start rejecting. |
| Existing summaries | Not regenerated. Owner Retry per episode, one transcript credit each. | Unchanged from `summary-json-mode.md`. The two episodes above are the ones worth re-running, and that is the owner's call. |
| Caption quality | Out of scope. "Franis Philip Champagne" is DownSub's transcription of François-Philippe Champagne, faithfully carried through. | The model obeyed "use only what the transcript supports". Fixing names means fixing captions, which is a different problem and probably not ours. |

## 4. Contract

### 4.1 `lib/summary.ts` — landed

`sectionize` divides evenly per §3 and `foldTrailingRunt` absorbs the remainder. `SECTION_MAX_SEC` is unchanged at 45
minutes and remains a hard ceiling: no section spans more than it, at any episode length. Nothing else in the file
changes.

### 4.2 `prompts/summary.ts` — proposed, prompt v3

`PROMPT_VERSION` bumps to the edit date. Only the numbered rules change; the persona lines, the strict requirements and
the skeletons are v2's and stay exactly as they are.

`MAP_PROMPT` field rules:

> FIELD RULES:
> 1. executiveSummary: exactly three sentences on the core theme and the main conclusion the episode reaches. Write about the subject, never about the recording: do not begin a sentence with "The conversation", "The discussion", "The speakers", or "This episode". Plain prose, objective, no hype.
> 2. takeaways: 3 to 6 objects, each one distinct, concrete claim, insight, framework, or recommendation a speaker made; lean toward 6 when the transcript runs past twenty minutes. Name the person who made it when the transcript identifies them. No two takeaways may make the same point at different timestamps. Do not include a definition of a term the reader could look up, and do not include a statement of what the episode is about. "at" is the exact [h:mm:ss] marker that precedes the point in the transcript, or null if none applies. Keep them in the order they occur.
> 3. topicTags: 3 to 8 lowercase tags of one or two words each.

`REDUCE_PROMPT` reduction rules:

> REDUCTION RULES:
> 1. executiveSummary: exactly three sentences — the core topic or problem, the main discussion or debate, the key conclusion — written as one narrative of the whole episode, never a list of the sections. Do not label the three parts: never write "The key conclusion is". Write about the subject, never about the recording: do not begin a sentence with "The conversation", "The discussion", "The speakers", or "This episode". Plain prose, objective, no hype.
> 2. takeaways: select 5 to 8 of the most insightful across all sections, in chronological order, drawing from the whole episode rather than mostly from one section. Merge every group of section takeaways making the same point into a single takeaway and keep its earliest marker. Drop any that only state what the episode is about. Prefer those naming a person, a number, or a specific claim. "at" is the exact [h:mm:ss] marker of the section takeaway it comes from; null only if the source had none.
> 3. topicTags: consolidate and deduplicate the section tags down to the 3 to 8 most overarching themes, one or two words each, lowercase.

### 4.3 Attribution — proposed, and separable

`mapPrompt(transcript)` becomes `mapPrompt(transcript, { title })`, rendering one line above the transcript: `Episode
title: <title>.` The Workflow passes the episode's title, which it already holds. Rule 2 gains: *when this excerpt does
not identify a speaker, describe them by their role rather than writing "the speaker".* The reduce is untouched — it
can only carry forward what the map wrote.

## 5. Acceptance criteria

1. `sectionize` divides 50 minutes into two 25-minute halves and 100 into three of about 33; no section spans more than
   `SECTION_MAX_SEC` and none is shorter than half the longest, across a range of lengths. (Landed.)
2. `mapPrompt` and `reducePrompt` carry the §4.2 rules; `PROMPT_VERSION` is neither `2026-09-13` nor `2026-09-14`.
3. With the attribution step, `mapPrompt` renders the title above the transcript and the Workflow passes the episode's
   own; `test/workflow-ingest.test.ts` sees it in the prompt.
4. `pnpm check` green.
5. The two episodes of §2 re-run under `wrangler dev --env dev` by owner Retry, and judged against §2's specific
   faults: whether the CBC takeaways now cover minutes 20 to 44, whether anyone is still called "the speaker", whether
   any two takeaways still make one point, and whether the summaries still open by narrating the speakers.

## 6. Out of scope

Caption quality and mangled proper nouns; the model choice; the 45-minute cap itself (only how the span is divided
between sections); validating the sentence count; regenerating the back catalogue; richer map-call context than the
title; M4 retrieval.

## 7. `AGENTS.md` and PRD alignment

PRD §4.4 needs one clause if §4.2 is approved: the takeaway bullet already says what a takeaway is, and "deduplicated,
and never a definition or a statement of the topic" belongs there. §9 gains an entry for prompt v3 and the section
split, as prompt v2 has. `AGENTS.md` needs nothing: no rule changes, and the `docs/specs/` layout comment gains
`summary-quality`.
