/**
 * Scoring a published summary against the faults real episodes actually showed
 * (docs/specs/summary-quality.md §2, docs/specs/summary-coverage.md §2), so a quality regression is
 * visible without a human reading every digest. Pure, and deliberately free: every check here runs on a stored summary with no model
 * call, which is what lets it sweep the whole catalog as often as we like. The checks that need an
 * embedding — true semantic duplication, groundedness against the transcript — are a separate,
 * costed pass and are not in this file.
 *
 * These are proxies, not verdicts. A flag means "a person should look", and the thresholds are the
 * arbitrary part: they were set by hand against the first two episodes and should move when a sweep
 * disagrees with a reader.
 */

import type { StructuredSummary } from "./summary";

/** Openers that narrate the recording instead of the subject (prompt v3 bans them by name). */
const BANNED_OPENERS = [
  "the conversation",
  "the discussion",
  "the speakers",
  "the speaker",
  "this episode",
  "the episode",
  "the video",
  "the podcast",
];

/** Rule 1's own scaffolding, quoted back at us. */
const PART_LABELS = [
  "the key conclusion is",
  "the core topic is",
  "the main discussion is",
  "the main debate is",
];

/** A takeaway naming nobody says one of these and no proper noun. */
const ANONYMOUS_SUBJECT =
  /\b(?:the|a|one|another|each|both)\s+(?:speaker|host|guest|interviewee|panelist|panellist|presenter|narrator|author|expert|researcher)s?\b/i;

/** Words that carry no topic, dropped before comparing two takeaways. */
const STOPWORDS = new Set(
  "a about after all also an and any are as at be because been but by can could did do does for from had has have he her his how in into is it its more most no not of on one only or other our out over said same she should so some such than that the their them then there these they this those to too up very was we were what when which who will with would you your".split(
    " ",
  ),
);

export type SummaryFaults = {
  /** Sentences in the executive summary; the prompt asks for exactly three, nothing validates it. */
  sentenceCount: number;
  takeawayCount: number;
  tagCount: number;
  /** Tags longer than the two words the prompt asks for. */
  longTags: string[];
  /** Sentences of the executive summary that narrate the recording rather than its subject. */
  bannedOpeners: string[];
  /** The executive summary labelled rule 1's three parts instead of just writing them. */
  labelsParts: boolean;
  /** Takeaways whose subject is "the speaker" and which name nobody. */
  anonymousTakeaways: number[];
  /** Takeaways carrying no usable timestamp. */
  nullTimestamps: number;
  /** Timestamps that do not ascend, which rule 2 requires of both prompts. */
  outOfOrder: boolean;
  /** Pairs of takeaways whose content words overlap enough to read as one point twice. */
  probableDuplicates: [number, number][];
  /**
   * The widest stretch of the episode with no takeaway in it, as a fraction of the runtime, and how
   * many tenths of the episode hold at least one. Null when the runtime is unknown. This is the
   * check that would have caught the 45+5 section split on its first episode.
   */
  largestGapRatio: number | null;
  coveredDeciles: number | null;
};

export type FaultThresholds = {
  /** Content-word overlap above which two takeaways are probably one point. */
  duplicateOverlap: number;
  /** Runtime fraction a gap may span before it is a coverage hole. */
  maxGapRatio: number;
};

export const DEFAULT_THRESHOLDS: FaultThresholds = {
  duplicateOverlap: 0.34,
  maxGapRatio: 0.25,
};

export function scoreSummary(
  summary: StructuredSummary,
  durationSec: number | null,
  thresholds: FaultThresholds = DEFAULT_THRESHOLDS,
): SummaryFaults {
  const sentences = splitSentences(summary.executiveSummary);
  const lower = summary.executiveSummary.toLowerCase();
  const marks = summary.takeaways
    .map((t) => t.startSec)
    .filter((sec): sec is number => sec !== null);

  return {
    sentenceCount: sentences.length,
    takeawayCount: summary.takeaways.length,
    tagCount: summary.topicTags.length,
    longTags: summary.topicTags.filter(
      (tag) => tag.trim().split(/\s+/).length > 2,
    ),
    bannedOpeners: sentences.filter((sentence) =>
      BANNED_OPENERS.some((opener) =>
        sentence.toLowerCase().startsWith(opener),
      ),
    ),
    labelsParts: PART_LABELS.some((label) => lower.includes(label)),
    anonymousTakeaways: summary.takeaways
      .map((t, i) => (isAnonymous(t.text) ? i : -1))
      .filter((i) => i >= 0),
    nullTimestamps: summary.takeaways.length - marks.length,
    outOfOrder: marks.some((sec, i) => i > 0 && sec < (marks[i - 1] ?? 0)),
    probableDuplicates: duplicatePairs(
      summary.takeaways.map((t) => t.text),
      thresholds.duplicateOverlap,
    ),
    ...coverage(marks, durationSec),
  };
}

/**
 * True when the point is attributed to "the speaker" rather than to a person. Any other proper noun
 * in the sentence is irrelevant — "The speaker loves Canada" names a country, not a source — so the
 * only excuse is an appositive naming them on the spot ("the host, Steven Bartlett, argues").
 */
function isAnonymous(text: string): boolean {
  const match = ANONYMOUS_SUBJECT.exec(text);
  if (!match) return false;
  const after = text.slice(match.index + match[0].length);
  return !/^\s*,\s*[A-Z][a-z]+/.test(after);
}

/**
 * Content-word overlap (Jaccard) as a cheap stand-in for "these are the same point". It catches the
 * restatements the real episodes produced, where the wording barely moves; it will miss two
 * takeaways that agree in substance and share no vocabulary, which is what the costed embedding
 * pass is for.
 */
function duplicatePairs(
  texts: readonly string[],
  threshold: number,
): [number, number][] {
  const bags = texts.map(contentWords);
  const pairs: [number, number][] = [];
  for (let i = 0; i < bags.length; i++) {
    for (let j = i + 1; j < bags.length; j++) {
      if (overlap(bags[i], bags[j]) >= threshold) pairs.push([i, j]);
    }
  }
  return pairs;
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

function overlap(
  a: Set<string> | undefined,
  b: Set<string> | undefined,
): number {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Where the takeaways fall across the runtime. The gap before the first and after the last count:
 * an episode whose every takeaway sits in the final five minutes is the failure this measures.
 */
function coverage(
  marks: readonly number[],
  durationSec: number | null,
): { largestGapRatio: number | null; coveredDeciles: number | null } {
  if (durationSec === null || durationSec <= 0 || marks.length === 0) {
    return { largestGapRatio: null, coveredDeciles: null };
  }
  const sorted = [...marks].sort((a, b) => a - b);
  let largest = (sorted[0] ?? 0) - 0;
  for (let i = 1; i < sorted.length; i++) {
    largest = Math.max(largest, (sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
  }
  largest = Math.max(largest, durationSec - (sorted[sorted.length - 1] ?? 0));
  const deciles = new Set(
    sorted.map((sec) => Math.min(9, Math.floor((sec / durationSec) * 10))),
  );
  return {
    largestGapRatio: largest / durationSec,
    coveredDeciles: deciles.size,
  };
}

/**
 * Sentence boundaries that survive the abbreviations and version numbers a summary actually
 * contains: a period ends a sentence only before whitespace and a capital, and never after a known
 * abbreviation.
 */
const ABBREVIATIONS =
  /\b(?:e\.g|i\.e|etc|vs|dr|mr|mrs|ms|prof|sr|jr|st|no|fig|approx|u\.s|u\.k)\.$/i;

export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  const parts = text.split(/(?<=[.!?])\s+/);
  for (const part of parts) {
    current = current ? `${current} ${part}` : part;
    const endsMidNumber = /\b\d+\.$/.test(current);
    if (ABBREVIATIONS.test(current) || endsMidNumber) continue;
    if (/[.!?]["')\]]?$/.test(current)) {
      sentences.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length > 0) sentences.push(current.trim());
  return sentences;
}
