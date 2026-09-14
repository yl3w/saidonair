# Feature spec — Summary prompt v2 and Workers AI JSON mode

**Written:** 2026-09-13, against `main` at `1c58a47` (M3 complete). A follow-up to `docs/specs/m3-3-ai-vectorize.md`
§3.2–§3.4 (the summary wrapper and the approved prompt texts) and to the summarise step of
`docs/specs/m3-5-episode-workflow.md`; PRD §4.4 governs.
**Status:** APPROVED and IMPLEMENTED on 2026-09-14, Steps 0 to 3.1; `PROMPT_VERSION` is `2026-09-14`. The owner rewrote
the two persona lines on the prompts themselves during that implementation; §2 and §3.1 below carry their wording, not
the draft's. Criterion 5's second half, the real episode over 45 minutes summarised end to end, is still owed and is the
owner's to run (it spends a DownSub credit on a channel of their choosing). Plan:
`docs/specs/summary-json-mode-plan.md`, whose Walkthrough record carries the probe's three observations. No new
dependencies. Changing a prompt is a product decision (`AGENTS.md` → AI code); the owner asked for this one.

## 1. Summary

Two raw-text fallbacks appeared on 2026-09-13, the first day summaries existed. One was our own rule (the
three-sentence cap, since relaxed). The other was the model's: a CBC News clip came back as JSON whose
`executiveSummary` value had no quotation marks, twice, so the validator could not read it and the reader saw the JSON
text under "unformatted summary". This spec does three things about that. The map and reduce prompts are rewritten
around a literal JSON skeleton and explicit rules, from the owner's two drafts of 2026-09-13. Both summary calls ask
Workers AI for JSON mode, a `response_format` with a JSON Schema, so the platform shapes the answer before we ever see
it. And a latent defect in the reduce input is fixed: the section summaries handed to the reduce call carry seconds
where the prompt promises `[h:mm:ss]` markers, so no multi-section episode could have kept its timestamps. The validator
stays as the second line of defence; the retry and raw fallback of PRD §4.4 stay as the last.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Prompt shape | A short persona line, three STRICT REQUIREMENTS, a literal OUTPUT STRUCTURE skeleton with no comments inside it, numbered rules below the skeleton, then the input. Full texts in §3.1. | Models copy a skeleton more reliably than they follow prose. A `//` comment inside the skeleton would be copied too and is invalid JSON, the failure class this spec exists to remove. |
| The reduce's job | Synthesis, not repetition: a three-sentence narrative (core topic or problem, main discussion or debate, key conclusion), takeaways selected and deduplicated across sections in chronological order, tags consolidated. From the owner's reduce draft. | A reduce that concatenates section summaries reads as three summaries; the 1-2-3 template gives the model the shape of one. |
| Persona | "an expert editor summarising a transcript of an episode for a reader who has not consumed it"; the reduce's is the same editor over "consecutive sections of an episode". Owner wording, set on the prompts themselves on 2026-09-14. | The owner's first draft said "podcast editor" and the spec's own revision said "one episode of a YouTube channel"; both name a medium the model cannot see. What reaches it is a transcript, and a reader consumes an episode by watching or listening, so the persona says neither podcast nor YouTube. |
| Takeaway range | One shared bound of **3 to 8** in the validator (`MAX_TAKEAWAYS` 5 → 8), the JSON Schema, and PRD §4.4 ("3–5" → "3–8"). Inside it the prompts guide: the map asks for **3 to 6**, leaning toward 6 when the transcript runs past twenty minutes; the reduce asks for **5 to 8**. | The owner's drafts asked for 5 to 8 (map) and 6 to 10 (reduce). A three-minute clip cannot honestly give five distinct points, and a minimum of six would force padding when two sections yield five between them; ten bullets is a long digest card. The reduce runs only for episodes over 45 minutes, so its higher range is earned. `parseSummary` is one function for both answers, so the boundary is one bound. |
| Reduce input | The Workflow renders each section's validated takeaways back to `{ text, at: "[h:mm:ss]" }` (or `at: null`) before building the reduce prompt, instead of serialising the internal `{ text, startSec }` shape. | Today the reduce call sees `startSec` seconds while its prompt promises markers; a numeric `at` in the answer fails validation. The fake masked it by answering `null` timestamps when it found no marker. Found on 2026-09-13 reviewing the reduce draft; no multi-section episode has completed the reduce for real yet. |
| Tags | Both prompts ask for 3 to 8; the validator and the schema keep 1 to 8. | Guidance in the prompt, tolerance at the boundary: a short clip with two honest tags must not fall back. |
| Sentences | The prompt asks for exactly three; nothing validates the count (owner decision 2026-09-13 stands). | Uniform output without a rejection rule. |
| JSON mode | Both `summarizeSection` and `reduceSections` pass `response_format: { type: "json_schema", json_schema: SUMMARY_RESPONSE_SCHEMA }`. The schema is exported from `lib/summary.ts`, built from the same constants the validator uses, so the two cannot drift. `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is on the platform's supported list (docs read 2026-09-13). | The platform constrains the model's output to the schema. Cloudflare says it cannot guarantee conformance, so the validator remains. |
| Object responses | In JSON mode the platform returns `response` as a parsed object, not a string. `realClient` serialises an object response with `JSON.stringify` and passes a string response through, so `Summarizer` keeps its `Promise<string>` contract and `parseSummary`, the retry, and the raw fallback are unchanged. | One contract for the Workflow, the fake, and the fallback storage; a raw fallback then holds well-formed JSON text at worst. |
| "JSON Mode couldn't be met" | The platform's error for a task it cannot fit to the schema is thrown by the wrapper, so it takes the step's retry policy and ends `SUMMARY_FAILED` like any other model failure. It is not the invalid-answer path. | The invalid-answer path exists for a string we could not parse; a thrown error is a failed call. |
| The stricter retry | Kept, since the platform does not guarantee conformance; reworded to name the object-only rule and the quoting rule. | Names the failure we saw. |
| `PROMPT_VERSION` | Bumps to the edit date. The version names the whole output contract: prompt texts and `response_format` together. If the edit lands on 2026-09-13 the value is `2026-09-13.2`, since `2026-09-13` is taken. | PRD §4.4: prompts are versioned; changing one is a product decision. |
| `SUMMARY_MAX_TOKENS` | 1024, unchanged. | Six takeaways with timestamps, three sentences, and eight tags are about 500 tokens. |
| The fake | `AI_FAKE` ignores `response_format`; its canned summary (three takeaways, markers echoed from the prompt) satisfies the new bounds unchanged and, once the reduce input carries markers again, answers non-null timestamps on the reduce too. The stub-binding test asserts the real client passes the schema. | Determinism in tests; the platform contract is checked where it is issued; the reduce path's timestamps become observable in tests. |
| Existing summaries | Not regenerated. Owner Retry per episode is the path, one DownSub credit each. | A regeneration sweep is a separate decision with a cost. |
| Section length | 45 minutes, unchanged. | Not implicated; the empty-response failure on a long broadcast is out of scope here (§5). |

## 3. Contract

### 3.1 `prompts/summary.ts`

`PROMPT_VERSION` per §2. `mapPrompt(transcript)` is `MAP_PROMPT`, two newlines, the transcript; `reducePrompt(sections)`
is `REDUCE_PROMPT`, two newlines, the sections as "Section n:" blocks as today; `STRICTER_RETRY_SUFFIX` unchanged in
role. The texts:

`MAP_PROMPT`:

> You are an expert editor summarising a transcript of an episode for a reader who has not consumed it.
>
> STRICT REQUIREMENTS:
> - Output ONLY a JSON object. No markdown fences, no text before or after it.
> - Every string value, including executiveSummary, must be enclosed in double quotes.
> - Use only what the transcript supports. Do not invent names, numbers, claims, or timestamps.
>
> OUTPUT STRUCTURE:
> {
>   "executiveSummary": "…",
>   "takeaways": [{ "text": "…", "at": "[h:mm:ss]" }],
>   "topicTags": ["…"]
> }
>
> FIELD RULES:
> 1. executiveSummary: exactly three sentences on the core theme and the main conclusion. Plain prose, objective, no hype.
> 2. takeaways: 3 to 6 objects, each one distinct, concrete claim, insight, framework, or recommendation a speaker made; lean toward 6 when the transcript runs past twenty minutes. "at" is the exact [h:mm:ss] marker that precedes the point in the transcript, or null if none applies. Keep them in the order they occur.
> 3. topicTags: 3 to 8 short lowercase tags.
>
> Transcript follows, with [h:mm:ss] markers.

`REDUCE_PROMPT`:

> You are an expert editor. You are given the JSON summaries of consecutive sections of an episode, in order, each with timestamped takeaways. Synthesise them into one cohesive summary of the whole episode.
>
> STRICT REQUIREMENTS:
> - Output ONLY a JSON object. No markdown fences, no text before or after it.
> - Every string value, including executiveSummary, must be enclosed in double quotes.
> - Rely only on the section summaries. Do not invent details, claims, or timestamps.
>
> OUTPUT STRUCTURE:
> {
>   "executiveSummary": "…",
>   "takeaways": [{ "text": "…", "at": "[h:mm:ss]" }],
>   "topicTags": ["…"]
> }
>
> REDUCTION RULES:
> 1. executiveSummary: exactly three sentences: the core topic or problem, the main discussion or debate, the key conclusion. A narrative of the whole episode, never a list of the sections. Plain prose, objective, no hype.
> 2. takeaways: select 5 to 8 of the most insightful across all sections, deduplicated, in chronological order. "at" is the exact [h:mm:ss] marker of the section takeaway it comes from; when merging overlapping takeaways keep the earliest marker; null only if the source had none.
> 3. topicTags: consolidate and deduplicate the section tags down to the 3 to 8 most overarching themes, lowercase.
>
> Section summaries follow, in order.

`STRICTER_RETRY_SUFFIX`:

> Your previous answer was not a valid JSON object of that structure. Answer with the JSON object only: no text before or after it, no code fences, every string value in double quotes, exactly the three fields.

### 3.2 `lib/summary.ts`

```ts
export const MIN_TAKEAWAYS = 3;
export const MAX_TAKEAWAYS = 8;                                  // was 5; the map asks 3–6, the reduce 5–8
export const MIN_TAGS = 1;
export const MAX_TAGS = 8;
/** The JSON Schema both summary calls pass as `response_format.json_schema`; built from the bounds above. */
export const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    takeaways: {
      type: "array", minItems: MIN_TAKEAWAYS, maxItems: MAX_TAKEAWAYS,
      items: { type: "object", properties: { text: { type: "string" }, at: { type: ["string", "null"] } }, required: ["text", "at"] },
    },
    topicTags: { type: "array", minItems: MIN_TAGS, maxItems: MAX_TAGS, items: { type: "string" } },
  },
  required: ["executiveSummary", "takeaways", "topicTags"],
} as const;
```

`parseSummary` is otherwise unchanged: shape validation, timestamp mapping, tag lower-casing, `null` for anything else.

```ts
/** A validated section answer as the reduce prompt must see it: markers, not seconds. */
export function formatSectionSummary(summary: StructuredSummary): string {
  return JSON.stringify({
    executiveSummary: summary.executiveSummary,
    takeaways: summary.takeaways.map((t) => ({ text: t.text, at: t.startSec === null ? null : `[${formatTimestamp(t.startSec)}]` })),
    topicTags: summary.topicTags,
  });
}
```

`workflows/ingest.ts` builds the reduce prompt from `formatSectionSummary(a.structured)` for a structured section and
`a.raw` for one that fell back, replacing today's `JSON.stringify(a.structured)`.

### 3.3 `lib/ai.ts`

```ts
const complete = async (prompt: string): Promise<string> => {
  const result = await binding.run(SUMMARY_MODEL, {
    messages: [{ role: "user", content: prompt }],
    max_tokens: SUMMARY_MAX_TOKENS,
    response_format: { type: "json_schema", json_schema: SUMMARY_RESPONSE_SCHEMA },
  });
  // JSON mode answers a parsed object; a string passes through; anything else is a failed call.
  if (typeof result?.response === "string") return result.response;
  if (result?.response !== null && typeof result?.response === "object") return JSON.stringify(result.response);
  throw new Error("SUMMARY_FAILED: the model returned no response");
};
```

`Summarizer`, `Embedder`, the fake, and the `[[invalid-once]]`, `[[invalid]]`, `[[throw]]` markers are unchanged.

### 3.4 Docs

PRD §4.4: "3–5 takeaways" becomes "3–8 takeaways (the map prompt asks for 3–6, the reduce for 5–8)" and the bullet
says the model is asked in JSON mode with the schema mirroring the validator. `docs/specs/m3-3-ai-vectorize.md` §3.4 gains one line pointing here as the current texts.
`AGENTS.md` → AI code names `SUMMARY_RESPONSE_SCHEMA` beside the prompts; the `docs/specs/` layout comment lists this
spec.

## 4. Acceptance criteria

1. A stub binding sees `response_format.type === "json_schema"` and `response_format.json_schema` deep-equal to
   `SUMMARY_RESPONSE_SCHEMA` on both `summarizeSection` and `reduceSections`; an object `response` comes back as its
   JSON text; a string passes through; a missing response throws `SUMMARY_FAILED`.
2. `parseSummary` accepts eight takeaways and rejects two and nine; tags one to eight; the schema's bounds equal the
   validator's constants (one test reads both).
2a. `formatSectionSummary` renders `startSec` 223 as `"at": "[0:03:43]"` and a null as `null`; the Workflow's reduce
   prompt contains `[h:mm:ss]` markers, and with the fake the reduced summary's takeaways carry non-null `startSec`
   (today they are null, which is how the defect hid).
3. `mapPrompt` and `reducePrompt` contain the STRICT REQUIREMENTS, the skeleton, and the rules of §3.1 (the reduce's
   1-2-3 sentence template and "chronological order" included); `STRICTER_RETRY_SUFFIX` names double quotes;
   `PROMPT_VERSION` is not `2026-09-13`.
4. The fake still answers the canned summary and drives the three failure paths; `test/workflow-ingest.test.ts` is
   unchanged and green.
5. Probe under `wrangler dev --env dev`: one call with the fixture transcript and the schema answers an object of the
   right shape (its `response` type, latency, and takeaway count recorded); one real episode longer than 45 minutes,
   summarised end to end on a scratch state, comes back `structured` through the reduce with 5 to 8 takeaways, its
   timestamps mapped and non-null where the sections had them.
6. `pnpm check` green; PRD §4.4, the M3.3 spec pointer, and `AGENTS.md` updated.

## 5. Out of scope

Regenerating existing summaries (owner Retry per episode); the model choice and the 45-minute section length; the
`SUMMARY_FAILED` "no response text" failure seen on a long CBC broadcast on 2026-09-13, which JSON mode may or may not
change (the probe notes what it sees, nothing more); JSON mode for anything but the two summary calls; M4 retrieval.

## 6. `AGENTS.md` and PRD alignment

PRD §4.4 per §3.4. `AGENTS.md` → AI code: the bullet on prompts gains "the JSON Schema both summary calls pass lives in
`lib/summary.ts` beside the validator's bounds"; no rule changes. The repo layout comment lists `summary-json-mode`.
