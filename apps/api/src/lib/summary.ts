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

export const SECTION_MAX_SEC = 45 * 60;
export const MIN_TAKEAWAYS = 3;
/** The map prompt asks for 3 to 6 and the reduce for 5 to 8; one bound holds both. */
export const MAX_TAKEAWAYS = 8;
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
 * than `maxSec`. The count is the fewest sections of that size the episode needs, and the span is
 * then divided evenly between them rather than filling each to the cap: filling greedily left a
 * fifty-minute episode as forty-five minutes plus a five-minute tail, and the reduce weighs every
 * section's takeaways alike, so that tail spoke as loudly as the whole body before it (found on a
 * real episode 2026-09-14, docs/specs/summary-quality.md §2). A single section skips the reduce.
 */
export function sectionize(
  chunks: readonly TranscriptChunk[],
  maxSec: number = SECTION_MAX_SEC,
): TranscriptChunk[][] {
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (!first || !last) return [];
  const span = last.endSec - first.startSec;
  const count = Math.max(1, Math.ceil(span / maxSec));
  if (count === 1) return [[...chunks]];

  const target = span / count;
  const sections: TranscriptChunk[][] = [];
  let current: TranscriptChunk[] = [];
  for (const chunk of chunks) {
    const head = current[0];
    if (head && chunk.endSec - head.startSec > target) {
      sections.push(current);
      current = [];
    }
    current.push(chunk);
  }
  if (current.length > 0) sections.push(current);
  return foldTrailingRunt(sections, target, maxSec);
}

/**
 * Dividing on chunk boundaries can round a section past the target and leave a short last one — the
 * very thing even sections exist to prevent — so fold it back when the cap still allows.
 */
function foldTrailingRunt(
  sections: TranscriptChunk[][],
  target: number,
  maxSec: number,
): TranscriptChunk[][] {
  const tail = sections[sections.length - 1];
  const previous = sections[sections.length - 2];
  const tailHead = tail?.[0];
  const tailLast = tail?.[tail.length - 1];
  const previousHead = previous?.[0];
  if (!tail || !previous || !tailHead || !tailLast || !previousHead) {
    return sections;
  }
  if (tailLast.endSec - tailHead.startSec >= target / 2) return sections;
  if (tailLast.endSec - previousHead.startSec > maxSec) return sections;
  return [...sections.slice(0, -2), [...previous, ...tail]];
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
