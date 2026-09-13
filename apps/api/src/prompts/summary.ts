/**
 * The summary prompts (docs/PRD.md §4.4; docs/specs/m3-ingestion.md §3.2), approved by the owner on
 * 2026-09-12 and moved here from the M3 plan. `PROMPT_VERSION` is stored with every summary; editing
 * either prompt is a product decision and bumps it to the date of the edit.
 */

export const PROMPT_VERSION = "2026-09-13";

const MAP_PROMPT =
  "You summarise one episode of a YouTube channel for a reader who has not watched it. Return only JSON " +
  "with three fields: `executiveSummary` (at most three sentences, plain prose, no hype), `takeaways` " +
  '(three to five objects `{ "text", "at" }`: `text` is one concrete claim, example, or recommendation ' +
  "from the episode; `at` is the `[h:mm:ss]` marker nearest to where it is said, or null), `topicTags` " +
  "(one to eight short lowercase tags). Use only what the transcript supports; do not invent names, " +
  "numbers, or timestamps. Transcript follows, with `[h:mm:ss]` markers.";

const REDUCE_PROMPT =
  "You are given summaries of consecutive sections of one YouTube episode, each with timestamped " +
  "takeaways. Return only JSON with the same three fields for the whole episode: `executiveSummary` " +
  "(at most three sentences), `takeaways` (three to five, chosen or merged from the sections, each " +
  "keeping the `at` timestamp of the section takeaway it comes from), `topicTags` (one to eight). Do " +
  "not add anything the sections do not say.";

/** Appended once, when the first answer was not valid JSON of the expected shape. */
export const STRICTER_RETRY_SUFFIX =
  "\n\nYour previous answer was not a valid JSON object of that shape. Answer with the JSON object only: " +
  "no prose before or after it, no code fences, exactly the three fields.";

/** One section's transcript, already formatted with `[h:mm:ss]` markers (lib/summary.ts). */
export function mapPrompt(transcript: string): string {
  return `${MAP_PROMPT}\n\n${transcript}`;
}

/** The map answers of every section, in order, as the model returned them. */
export function reducePrompt(sectionSummaries: readonly string[]): string {
  const sections = sectionSummaries
    .map((summary, index) => `Section ${index + 1}:\n${summary}`)
    .join("\n\n");
  return `${REDUCE_PROMPT}\n\n${sections}`;
}
