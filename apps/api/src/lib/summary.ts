import type { TranscriptChunk } from "./chunk";

/**
 * The pure half of summarisation (docs/specs/m3-ingestion.md §3.2; docs/specs/m3-3-ai-vectorize.md
 * §3.3): the transcript the model reads, with one `[h:mm:ss]` marker per chunk; the split of a long
 * episode into sections of at most 45 minutes on chunk boundaries, one map call each; and the hand
 * validation of the model's JSON, shape and not just parseability (AGENTS.md → AI code), with each
 * takeaway's marker mapped to a `startSec` a reader can jump to.
 */

export const SECTION_MAX_SEC = 45 * 60;
export const MAX_SUMMARY_SENTENCES = 3;
export const MIN_TAKEAWAYS = 3;
export const MAX_TAKEAWAYS = 5;
export const MIN_TAGS = 1;
export const MAX_TAGS = 8;

export type StructuredSummary = {
  executiveSummary: string;
  takeaways: { text: string; startSec: number | null }[];
  topicTags: string[];
};

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
 * Consecutive chunks grouped so no section spans more than `maxSec` from its first chunk's start to
 * its last chunk's end. A single section means the reduce call is skipped.
 */
export function sectionize(
  chunks: readonly TranscriptChunk[],
  maxSec: number = SECTION_MAX_SEC,
): TranscriptChunk[][] {
  const sections: TranscriptChunk[][] = [];
  let current: TranscriptChunk[] = [];
  for (const chunk of chunks) {
    const first = current[0];
    if (first && chunk.endSec - first.startSec > maxSec) {
      sections.push(current);
      current = [];
    }
    current.push(chunk);
  }
  if (current.length > 0) sections.push(current);
  return sections;
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

// A private-use character stands in for a decimal point while sentences are counted.
const DECIMAL_POINT = String.fromCharCode(0xe000);

/** Sentences end in `.`, `!`, or `?` followed by whitespace or the end; a decimal point between digits does not. */
export function countSentences(text: string): number {
  const guarded = text.trim().replace(/(\d)\.(\d)/g, `$1${DECIMAL_POINT}$2`);
  return guarded
    .split(/[.!?]+(?:\s+|$)/)
    .filter((piece) => piece.trim().length > 0).length;
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
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const value = record(parsed);
  if (!value) return null;

  const executiveSummary = nonEmpty(value.executiveSummary);
  if (
    executiveSummary === null ||
    countSentences(executiveSummary) > MAX_SUMMARY_SENTENCES
  ) {
    return null;
  }

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
