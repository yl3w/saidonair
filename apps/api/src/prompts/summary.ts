/**
 * The summary prompts (docs/PRD.md §4.4; docs/specs/summary-json-mode.md §3.1). v2, approved by the
 * owner on 2026-09-14: a persona line, strict requirements, a literal output skeleton the model can
 * copy, then numbered field rules. `PROMPT_VERSION` is stored with every summary and names the whole
 * output contract — these texts and the JSON Schema `lib/ai.ts` sends with them — so editing either
 * bumps it to the date of the edit. Changing a prompt is a product decision.
 */

export const PROMPT_VERSION = "2026-09-14.3";

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
1. executiveSummary: exactly three sentences on the core theme and the main conclusion this section reaches. Write about the subject, never about the recording: do not begin a sentence with "The conversation", "The discussion", "The speakers", or "This episode". Plain prose, objective, no hype.
2. takeaways: 3 to 6 objects, each one distinct, concrete claim, insight, framework, or recommendation a speaker made. Name the person who made it when the transcript identifies them. No two takeaways may make the same point. Do not include a definition of a term the reader could look up, and do not include a statement of what the episode is about. "at" is the exact [h:mm:ss] marker that precedes the point in the transcript, or null if none applies. Keep them in the order they occur.
3. topicTags: 3 to 8 lowercase tags of one or two words each.

Transcript follows, with [h:mm:ss] markers.`;

const SYNTHESIS_PROMPT = `You are an expert editor. You are given the JSON summaries of consecutive sections of an episode, in order, and the takeaways already selected from them. Write one cohesive summary of the whole episode.

STRICT REQUIREMENTS:
- Output ONLY a JSON object. No markdown fences, no text before or after it.
- Every string value, including executiveSummary, must be enclosed in double quotes.
- Rely only on the section summaries. Do not invent details, claims, or timestamps.

OUTPUT STRUCTURE:
{
  "executiveSummary": "…",
  "topicTags": ["…"]
}

FIELD RULES:
1. executiveSummary: exactly three sentences: the core topic or problem, the main discussion or debate, the key conclusion. One narrative of the whole episode, never a list of the sections. Do not label the parts: never write "The key conclusion is". Write about the subject, never about the recording: do not begin a sentence with "The conversation", "The discussion", "The speakers", or "This episode". Plain prose, objective, no hype.
2. topicTags: consolidate and deduplicate the section tags down to the 3 to 8 most overarching themes, one or two words each, lowercase.

Choosing the takeaways is not your task; they are listed only so your summary agrees with them. Section summaries follow, in order.`;

/** Appended once, when the first answer was not valid JSON of the expected shape. */
export const STRICTER_RETRY_SUFFIX =
  "\n\nYour previous answer was not a valid JSON object of that structure. Answer with the JSON " +
  "object only: no text before or after it, no code fences, every string value in double quotes, " +
  "exactly the three fields.";

/** One section's transcript, already formatted with `[h:mm:ss]` markers (lib/summary.ts). */
export function mapPrompt(transcript: string): string {
  return `${MAP_PROMPT}\n\n${transcript}`;
}

/**
 * The section answers, in order, and the takeaways `allocateTakeaways` has already chosen. The
 * synthesis call writes the three sentences and consolidates the tags; it is not asked for
 * takeaways, and its schema does not admit them, because selecting across sections is the one thing
 * it was measured doing badly (docs/specs/summary-coverage.md §2).
 */
export function synthesisPrompt(
  sectionSummaries: readonly string[],
  takeaways: readonly { text: string }[],
): string {
  const sections = sectionSummaries
    .map((summary, index) => `Section ${index + 1}:\n${summary}`)
    .join("\n\n");
  const chosen = takeaways.map((t) => `- ${t.text}`).join("\n");
  return `${SYNTHESIS_PROMPT}\n\nTakeaways already selected:\n${chosen}\n\n${sections}`;
}
