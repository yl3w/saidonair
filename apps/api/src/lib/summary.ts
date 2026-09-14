import type { TranscriptChunk } from "./chunk";

/**
 * The pure half of summarisation (docs/specs/m3-ingestion.md §3.2; docs/specs/m3-3-ai-vectorize.md
 * §3.3): the transcript the model reads, with one `[h:mm:ss]` marker per chunk; the split of a long
 * episode into sections of at most 45 minutes on chunk boundaries, one map call each; and the hand
 * validation of the model's JSON, shape and not just parseability (AGENTS.md → AI code), with each
 * takeaway's marker mapped to a `startSec` a reader can jump to. The prompt asks for an executive
 * summary of exactly three sentences; the count is not validated (owner decision 2026-09-13): a
 * structured answer that runs long serves the reader better than the raw-text fallback a rejection
 * would leave them with. Since 2026-09-14 the bounds here also shape the JSON Schema both calls send
 * (docs/specs/summary-json-mode.md §3.2).
 */

/**
 * One map call reads at most this much of an episode. Twenty minutes, not the forty-five it was
 * until 2026-09-14: a map call trails off in its own last third whatever its length, so a long
 * section leaves a long hole. Measured on two episodes (docs/specs/summary-coverage.md §2): at 45
 * minutes the last half hour went unrepresented and 7 of 10 deciles were touched; at 20 the tail
 * loss is a minute, every decile is touched, the widest gap halves, and the result repeats run to
 * run where the 45-minute one did not.
 */
export const SECTION_MAX_SEC = 20 * 60;
export const MIN_TAKEAWAYS = 3;
/**
 * One bound holds both calls. It is 20 because a reduced summary's budget scales with the episode
 * (`takeawayBudget`): the map still asks for 3 to 6 per section, but a two-and-a-half-hour interview
 * earns far more than the eight that used to be the ceiling for everything.
 */
export const MAX_TAKEAWAYS = 20;
/** A reduced summary never returns fewer than this, however short the episode. */
export const MIN_REDUCED_TAKEAWAYS = 5;
/** About one takeaway per this many minutes of episode. */
export const TAKEAWAY_MINUTES = 8;
export const MIN_TAGS = 1;
export const MAX_TAGS = 8;

/**
 * The JSON Schema both summary calls pass as `response_format.json_schema` (lib/ai.ts), built from
 * the bounds above so the platform's constraint and this file's validation cannot drift. Cloudflare
 * does not guarantee conformance, so `parseSummary` still checks every answer.
 */
export const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    takeaways: {
      type: "array",
      minItems: MIN_TAKEAWAYS,
      maxItems: MAX_TAKEAWAYS,
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          at: { type: ["string", "null"] },
        },
        required: ["text", "at"],
      },
    },
    topicTags: {
      type: "array",
      minItems: MIN_TAGS,
      maxItems: MAX_TAGS,
      items: { type: "string" },
    },
  },
  required: ["executiveSummary", "takeaways", "topicTags"],
} as const;

/**
 * The synthesis call's schema: two fields, because it is no longer asked to choose takeaways.
 * A shorter answer is also a smaller surface for a malformed timestamp it can no longer emit.
 */
export const SYNTHESIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    topicTags: {
      type: "array",
      minItems: MIN_TAGS,
      maxItems: MAX_TAGS,
      items: { type: "string" },
    },
  },
  required: ["executiveSummary", "topicTags"],
} as const;

/**
 * How many takeaways a multi-section episode's summary carries, from its runtime: about one per
 * eight minutes, never fewer than five or more than the validator's ceiling.
 *
 * Measured on 2026-09-14 (docs/specs/summary-quality.md §2): a 146-minute episode's sections offered
 * 23 good timestamped takeaways and a fixed 5-to-8 band kept 7, all from the first 75 minutes. This
 * is a single number rather than a band because nothing negotiates inside it any more —
 * `allocateTakeaways` spends it, not the model.
 */
export function takeawayCount(durationSec: number | null): number {
  // An unknown runtime cannot happen on the path that uses this (the Workflow resolves one from the
  // chunks), so this is a floor for safety, not a case worth tuning.
  if (durationSec === null || durationSec <= 0) return 8;
  const target = Math.round(durationSec / 60 / TAKEAWAY_MINUTES);
  return Math.min(MAX_TAKEAWAYS, Math.max(MIN_REDUCED_TAKEAWAYS, target));
}

export type StructuredSummary = {
  executiveSummary: string;
  takeaways: { text: string; startSec: number | null }[];
  topicTags: string[];
};

/**
 * The takeaway budget spent across a multi-section episode's sections.
 *
 * This exists because the model would not do it. Asked to select across sections it filled the list
 * from the earliest and stopped, twice measured, losing the back half of a two-hour episode
 * (docs/specs/summary-coverage.md §2). Round-robin, so every section is represented before any is
 * represented twice; evenly spaced within a section, because a section's takeaways are chronological
 * and taking its first few reproduces the same front-loading one level down; and a section with less
 * to give hands its remainder to the others rather than holding places open.
 *
 * Pure, and chronological by construction: sections arrive in order and each keeps its own order.
 */
export function allocateTakeaways(
  sections: readonly StructuredSummary[],
  total: number,
): StructuredSummary["takeaways"] {
  const pools = sections.map((section) => section.takeaways);
  const quota = pools.map(() => 0);
  let remaining = Math.max(0, total);
  let gave = true;
  while (remaining > 0 && gave) {
    gave = false;
    for (const [i, pool] of pools.entries()) {
      if (remaining === 0) break;
      const taken = quota[i] ?? 0;
      if (taken < pool.length) {
        quota[i] = taken + 1;
        remaining--;
        gave = true;
      }
    }
  }
  return pools.flatMap((pool, i) => spread(pool, quota[i] ?? 0));
}

/** `count` items of `items`, spaced evenly across it by index; the whole thing when it is short. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (count >= items.length) return [...items];
  if (count === 1) return items[0] === undefined ? [] : [items[0]];
  const picked: T[] = [];
  for (let i = 0; i < count; i++) {
    const item = items[Math.round((i * (items.length - 1)) / (count - 1))];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/** `h:mm:ss`, hours always present so the prompt's marker shape is one shape (`0:04:12`, `1:02:03`). */
export function formatTimestamp(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** One line per chunk: the marker of its start, then its text. */
export function formatTranscript(chunks: readonly TranscriptChunk[]): string {
  return chunks
    .map((chunk) => `[${formatTimestamp(chunk.startSec)}] ${chunk.text}`)
    .join("\n");
}

/**
 * A validated section answer as the reduce prompt must see it: `[h:mm:ss]` markers, not the internal
 * seconds. Serialising `StructuredSummary` directly would hand the reduce call an `at` the prompt
 * never promised, and a numeric `at` in its answer fails validation.
 */
export function formatSectionSummary(summary: StructuredSummary): string {
  return JSON.stringify({
    executiveSummary: summary.executiveSummary,
    takeaways: summary.takeaways.map((t) => ({
      text: t.text,
      at: t.startSec === null ? null : `[${formatTimestamp(t.startSec)}]`,
    })),
    topicTags: summary.topicTags,
  });
}

/**
 * Consecutive chunks grouped into the sections one map call each reads, no section spanning more
 * than `maxSec`.
 *
 * The count is the fewest sections of that size the episode needs, and the chunks are then divided
 * into that many near-equal groups *by count*, not by filling each group to a time target. Filling
 * by time leaves a remainder — 135 minutes came out as seven 19-minute sections and a 2-minute tail
 * that no fold could absorb, because its neighbour was already at the cap — and a 2-minute section
 * would draw a map call and a share of the takeaway budget equal to a full one. Dividing by count
 * cannot leave a remainder, and since chunks are token-bounded it also balances what each call
 * reads. If speech is sparse enough that a group still spans more than the cap, one more section is
 * tried. A single section skips the synthesis call.
 */
export function sectionize(
  chunks: readonly TranscriptChunk[],
  maxSec: number = SECTION_MAX_SEC,
): TranscriptChunk[][] {
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (!first || !last) return [];
  const span = last.endSec - first.startSec;
  let count = Math.max(1, Math.ceil(span / maxSec));
  while (count < chunks.length) {
    const sections = splitEvenly(chunks, count);
    if (sections.every((section) => sectionSpan(section) <= maxSec)) {
      return sections;
    }
    count++;
  }
  return splitEvenly(chunks, count);
}

/** `count` consecutive groups of as near the same number of chunks as the array allows. */
function splitEvenly(
  chunks: readonly TranscriptChunk[],
  count: number,
): TranscriptChunk[][] {
  const sections: TranscriptChunk[][] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * chunks.length) / count);
    const to = Math.floor(((i + 1) * chunks.length) / count);
    if (to > from) sections.push(chunks.slice(from, to));
  }
  return sections;
}

function sectionSpan(section: readonly TranscriptChunk[]): number {
  const first = section[0];
  const last = section[section.length - 1];
  return first && last ? last.endSec - first.startSec : 0;
}

/**
 * `h:mm:ss` or `mm:ss`, with or without the surrounding brackets, to seconds; null for anything
 * else. Tolerant on the way back from the model, one shape on the way in.
 */
export function parseTimestampMarker(value: string): number | null {
  const match = /^\[?\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*\]?$/.exec(value.trim());
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * The model's raw text to a validated summary, or null when it is not one: the JSON between the
 * first `{` and the last `}` (models wrap answers in prose and fences), then the shape. A takeaway's
 * `at` becomes `startSec`, null when absent, unparsable, or past the episode's known duration.
 */
export function parseSummary(
  raw: string,
  durationSec: number | null,
): StructuredSummary | null {
  const value = jsonObject(raw);
  if (!value) return null;

  const executiveSummary = nonEmpty(value.executiveSummary);
  if (executiveSummary === null) return null;

  if (!Array.isArray(value.takeaways)) return null;
  if (
    value.takeaways.length < MIN_TAKEAWAYS ||
    value.takeaways.length > MAX_TAKEAWAYS
  ) {
    return null;
  }
  const takeaways: StructuredSummary["takeaways"] = [];
  for (const item of value.takeaways) {
    const takeaway = record(item);
    const text = nonEmpty(takeaway?.text);
    if (!takeaway || text === null) return null;
    const at = takeaway.at;
    if (at !== undefined && at !== null && typeof at !== "string") return null;
    takeaways.push({
      text,
      startSec: startSecOf(typeof at === "string" ? at : null, durationSec),
    });
  }

  if (!Array.isArray(value.topicTags)) return null;
  if (value.topicTags.length < MIN_TAGS || value.topicTags.length > MAX_TAGS) {
    return null;
  }
  const topicTags: string[] = [];
  for (const tag of value.topicTags) {
    const text = nonEmpty(tag);
    if (text === null) return null;
    topicTags.push(text.toLowerCase());
  }

  return { executiveSummary, takeaways, topicTags };
}

/**
 * The synthesis call's answer: the executive summary and the tags, or null when it is not one.
 * Shares `parseSummary`'s tolerance for prose and fences around the object.
 */
export function parseSynthesis(
  raw: string,
): { executiveSummary: string; topicTags: string[] } | null {
  const value = jsonObject(raw);
  if (!value) return null;
  const executiveSummary = nonEmpty(value.executiveSummary);
  if (executiveSummary === null) return null;
  if (!Array.isArray(value.topicTags)) return null;
  if (value.topicTags.length < MIN_TAGS || value.topicTags.length > MAX_TAGS) {
    return null;
  }
  const topicTags: string[] = [];
  for (const tag of value.topicTags) {
    const text = nonEmpty(tag);
    if (text === null) return null;
    topicTags.push(text.toLowerCase());
  }
  return { executiveSummary, topicTags };
}

/** The JSON object between the first `{` and the last `}`, or null. Models wrap answers. */
function jsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return record(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function startSecOf(
  at: string | null,
  durationSec: number | null,
): number | null {
  if (at === null) return null;
  const sec = parseTimestampMarker(at);
  if (sec === null) return null;
  if (durationSec !== null && sec > durationSec) return null;
  return sec;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
