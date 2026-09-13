import type { TranscriptSegment } from "./transcripts/types";

/**
 * Transcript chunking, the hybrid time/token contract of docs/PRD.md §6: group consecutive segments
 * to about a minute of speech; split a group over about 400 tokens on segment boundaries; overlap
 * consecutive chunks by one or two segments so a point on a boundary is still retrievable; never
 * emit more than 480 tokens, because the embedding model truncates silently at 512; split a single
 * oversized segment on sentence, then word boundaries. Pure and deterministic: the Workflow calls it
 * inline, not in a step, so a replay recomputes the same chunks and the same vector ids.
 */

export type TranscriptChunk = {
  index: number;
  text: string;
  startSec: number;
  endSec: number;
};

/** About a minute of speech per chunk. */
export const TARGET_SEC = 60;
/** A group over this many tokens splits on a segment boundary. */
export const SOFT_TOKENS = 400;
/** No chunk ever exceeds this many tokens (the model truncates at 512). */
export const HARD_TOKENS = 480;
/** Consecutive chunks share this many segments, one when the shared segment is long. */
export const OVERLAP_SEGMENTS = 2;
/** A segment longer than this gets one segment of overlap instead of two. */
export const LONG_SEGMENT_SEC = 20;

/** PRD §6's approximation: four characters per token. */
export function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkTranscript(
  segments: readonly TranscriptSegment[],
): TranscriptChunk[] {
  const parts = segments.flatMap(splitOversized);
  const chunks: TranscriptChunk[] = [];
  let start = 0;
  let previousEnd = 0; // exclusive end of the previous group
  while (start < parts.length) {
    const end = groupEnd(parts, start);
    const group = parts.slice(start, end);
    const last = group[group.length - 1];
    const first = group[0];
    if (!first || !last) break;
    chunks.push({
      index: chunks.length,
      text: group.map((part) => part.text).join(" "),
      startSec: first.startSec,
      endSec: last.startSec + last.durationSec,
    });
    if (end >= parts.length) break;
    previousEnd = end;
    start = nextStart(parts, previousEnd, group);
  }
  return chunks;
}

/** The exclusive end of the group starting at `start`: about a minute, under the soft token limit. */
function groupEnd(parts: readonly TranscriptSegment[], start: number): number {
  const first = parts[start];
  if (!first) return start;
  let end = start + 1;
  let text = first.text;
  while (end < parts.length) {
    const next = parts[end];
    if (!next) break;
    const elapsed = next.startSec - first.startSec;
    if (elapsed >= TARGET_SEC) break;
    const candidate = `${text} ${next.text}`;
    if (tokens(candidate) > SOFT_TOKENS) break;
    text = candidate;
    end += 1;
  }
  return end;
}

/**
 * Where the next group starts: one or two segments back into the previous group, as long as the
 * overlapping group still makes progress past it; otherwise less overlap, down to none.
 */
function nextStart(
  parts: readonly TranscriptSegment[],
  previousEnd: number,
  previousGroup: readonly TranscriptSegment[],
): number {
  const last = previousGroup[previousGroup.length - 1];
  const wanted =
    last && last.durationSec > LONG_SEGMENT_SEC ? 1 : OVERLAP_SEGMENTS;
  const maxOverlap = Math.min(wanted, previousGroup.length - 1);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const start = previousEnd - overlap;
    if (groupEnd(parts, start) > previousEnd) return start;
  }
  return previousEnd;
}

/** A segment over the hard cap becomes several, split on sentences, then words, then characters. */
function splitOversized(segment: TranscriptSegment): TranscriptSegment[] {
  if (tokens(segment.text) <= HARD_TOKENS) return [segment];
  const pieces = packPieces(sentencesOf(segment.text));
  const totalChars = pieces.reduce((sum, piece) => sum + piece.length, 0);
  let offset = 0;
  return pieces.map((piece) => {
    const share = piece.length / totalChars;
    const part = {
      text: piece,
      startSec: segment.startSec + segment.durationSec * (offset / totalChars),
      durationSec: segment.durationSec * share,
    };
    offset += piece.length;
    return part;
  });
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Packs sentences into pieces under the hard cap; a sentence over the cap is split on words, then characters. */
function packPieces(sentences: readonly string[]): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current.length > 0) pieces.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    if (tokens(sentence) > HARD_TOKENS) {
      flush();
      pieces.push(...packWords(sentence));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (tokens(candidate) > HARD_TOKENS) {
      flush();
      current = sentence;
    } else {
      current = candidate;
    }
  }
  flush();
  return pieces;
}

function packWords(sentence: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/)) {
    if (tokens(word) > HARD_TOKENS) {
      if (current) pieces.push(current);
      current = "";
      for (let i = 0; i < word.length; i += HARD_TOKENS * 4) {
        pieces.push(word.slice(i, i + HARD_TOKENS * 4));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (tokens(candidate) > HARD_TOKENS) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}
