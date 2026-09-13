import type { TranscriptSegment } from "./types";

/**
 * WebVTT cues → transcript segments (docs/specs/m3-1-transcripts-chunking.md §3.2). Tolerant by
 * design: a caption file is provider output, not user input, so a malformed cue is skipped and the
 * rest kept, and an empty or header-only file is simply no segments. Only WebVTT is parsed; the
 * adapter asks the provider for that format.
 */

const TIMING = /^(\S+)\s+-->\s+(\S+)/;
const TAGS = /<[^>]*>/g;

export function parseVtt(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) continue;
    const timing = TIMING.exec(lines[timingIndex] ?? "");
    if (!timing) continue;
    const start = parseTimestamp(timing[1] ?? "");
    const end = parseTimestamp(timing[2] ?? "");
    if (start === null || end === null || end <= start) continue;
    const cueText = lines
      .slice(timingIndex + 1)
      .map((line) => line.replace(TAGS, "").trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ");
    if (cueText.length === 0) continue;
    segments.push({ text: cueText, startSec: start, durationSec: end - start });
  }
  return segments;
}

/** `hh:mm:ss.mmm`, `mm:ss.mmm`, with `.` or `,` before the milliseconds; null for anything else. */
export function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = match[4] ? Number(match[4].padEnd(3, "0")) : 0;
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}
