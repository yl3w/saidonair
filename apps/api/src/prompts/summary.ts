/**
 * The summary prompts (docs/PRD.md §4.4; docs/specs/summary-json-mode.md §3.1). v2, approved by the
 * owner on 2026-09-14: a persona line, strict requirements, a literal output skeleton the model can
 * copy, then numbered field rules. `PROMPT_VERSION` is stored with every summary and names the whole
 * output contract — these texts and the JSON Schema `lib/ai.ts` sends with them — so editing either
 * bumps it to the date of the edit. Changing a prompt is a product decision.
 */

export const PROMPT_VERSION = "2026-09-14";

// No comments inside the skeletons: a model copies one into its answer, and `//` is not JSON.
const MAP_PROMPT = `You are an expert editor summarising a transcript of an episode for a reader who has not consumed it.

STRICT REQUIREMENTS:
- Output ONLY a JSON object. No markdown fences, no text before or after it.
- Every string value, including executiveSummary, must be enclosed in double quotes.
- Use only what the transcript supports. Do not invent names, numbers, claims, or timestamps.

OUTPUT STRUCTURE:
{
  "executiveSummary": "…",
  "takeaways": [{ "text": "…", "at": "[h:mm:ss]" }],
  "topicTags": ["…"]
}

FIELD RULES:
1. executiveSummary: exactly three sentences on the core theme and the main conclusion. Plain prose, objective, no hype.
2. takeaways: 3 to 6 objects, each one distinct, concrete claim, insight, framework, or recommendation a speaker made; lean toward 6 when the transcript runs past twenty minutes. "at" is the exact [h:mm:ss] marker that precedes the point in the transcript, or null if none applies. Keep them in the order they occur.
3. topicTags: 3 to 8 short lowercase tags.

Transcript follows, with [h:mm:ss] markers.`;

const REDUCE_PROMPT = `You are an expert editor. You are given the JSON summaries of consecutive sections of an episode, in order, each with timestamped takeaways. Synthesise them into one cohesive summary of the whole episode.

STRICT REQUIREMENTS:
- Output ONLY a JSON object. No markdown fences, no text before or after it.
- Every string value, including executiveSummary, must be enclosed in double quotes.
- Rely only on the section summaries. Do not invent details, claims, or timestamps.

OUTPUT STRUCTURE:
{
  "executiveSummary": "…",
  "takeaways": [{ "text": "…", "at": "[h:mm:ss]" }],
  "topicTags": ["…"]
}

REDUCTION RULES:
1. executiveSummary: exactly three sentences: the core topic or problem, the main discussion or debate, the key conclusion. A narrative of the whole episode, never a list of the sections. Plain prose, objective, no hype.
2. takeaways: select 5 to 8 of the most insightful across all sections, deduplicated, in chronological order. "at" is the exact [h:mm:ss] marker of the section takeaway it comes from; when merging overlapping takeaways keep the earliest marker; null only if the source had none.
3. topicTags: consolidate and deduplicate the section tags down to the 3 to 8 most overarching themes, lowercase.

Section summaries follow, in order.`;

/** Appended once, when the first answer was not valid JSON of the expected shape. */
export const STRICTER_RETRY_SUFFIX =
  "\n\nYour previous answer was not a valid JSON object of that structure. Answer with the JSON " +
  "object only: no text before or after it, no code fences, every string value in double quotes, " +
  "exactly the three fields.";

/** One section's transcript, already formatted with `[h:mm:ss]` markers (lib/summary.ts). */
export function mapPrompt(transcript: string): string {
  return `${MAP_PROMPT}\n\n${transcript}`;
}

/** Every section's validated answer, in order, rendered by `formatSectionSummary`. */
export function reducePrompt(sectionSummaries: readonly string[]): string {
  const sections = sectionSummaries
    .map((summary, index) => `Section ${index + 1}:\n${summary}`)
    .join("\n\n");
  return `${REDUCE_PROMPT}\n\n${sections}`;
}
