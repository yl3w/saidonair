import { describe, expect, it } from "vitest";
import {
  chunkTranscript,
  HARD_TOKENS,
  LONG_SEGMENT_SEC,
  TARGET_SEC,
  tokens,
} from "../src/lib/chunk";
import type { TranscriptSegment } from "../src/lib/transcripts/types";
import { englishSegments } from "./fixtures/transcripts";

const seg = (
  text: string,
  startSec: number,
  durationSec: number,
): TranscriptSegment => ({
  text,
  startSec,
  durationSec,
});

/** `count` segments of `secondsEach`, each `chars` characters of prose. */
function uniform(
  count: number,
  secondsEach: number,
  chars = 80,
): TranscriptSegment[] {
  return Array.from({ length: count }, (_, i) =>
    seg(
      `segment ${i} ${"word ".repeat(Math.max(0, Math.ceil((chars - 12) / 5)))}`.trim(),
      i * secondsEach,
      secondsEach,
    ),
  );
}

describe("chunkTranscript", () => {
  it("returns nothing for no segments", () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it("returns one chunk for one short segment", () => {
    expect(chunkTranscript([seg("hello world", 3, 2)])).toEqual([
      { index: 0, text: "hello world", startSec: 3, endSec: 5 },
    ]);
  });

  it("groups a forty-minute transcript into overlapping chunks of about a minute, none over the cap", () => {
    const chunks = chunkTranscript(englishSegments(480, 5)); // 40 minutes
    expect(chunks.length).toBeGreaterThan(35);
    expect(chunks.length).toBeLessThan(60);
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.index).toBe(i);
      expect(tokens(chunk.text)).toBeLessThanOrEqual(HARD_TOKENS);
      expect(chunk.endSec).toBeGreaterThan(chunk.startSec);
      expect(chunk.endSec - chunk.startSec).toBeLessThanOrEqual(
        TARGET_SEC + 10,
      );
      const previous = chunks[i - 1];
      if (previous) {
        expect(chunk.startSec).toBeGreaterThan(previous.startSec);
        // Overlap: the next chunk begins before the previous one ended.
        expect(chunk.startSec).toBeLessThan(previous.endSec);
      }
    }
    const last = chunks[chunks.length - 1];
    expect(last?.endSec).toBe(480 * 5);
  });

  it("splits a group on a segment boundary when it would pass the soft token limit", () => {
    // 200-character segments: two fit under 400 tokens, three do not, so a minute of them splits.
    const chunks = chunkTranscript(uniform(12, 5, 800));
    for (const chunk of chunks)
      expect(tokens(chunk.text)).toBeLessThanOrEqual(HARD_TOKENS);
    expect(chunks.length).toBeGreaterThan(4);
  });

  it("keeps a 480-token segment whole and splits a 481-token one without exceeding the cap", () => {
    const whole = chunkTranscript([seg("a".repeat(HARD_TOKENS * 4), 0, 10)]);
    expect(whole).toHaveLength(1);
    expect(tokens(whole[0]?.text ?? "")).toBe(HARD_TOKENS);

    const sentence =
      "This is a sentence that goes on for a while and then stops. ";
    const long = sentence.repeat(
      Math.ceil((HARD_TOKENS * 4 + 4) / sentence.length),
    );
    expect(tokens(long)).toBeGreaterThan(HARD_TOKENS);
    const split = chunkTranscript([seg(long, 100, 60)]);
    expect(split.length).toBeGreaterThan(1);
    for (const chunk of split) {
      expect(tokens(chunk.text)).toBeLessThanOrEqual(HARD_TOKENS);
      expect(chunk.startSec).toBeGreaterThanOrEqual(100);
      expect(chunk.endSec).toBeLessThanOrEqual(160 + 1e-6);
    }
    expect(split[0]?.startSec).toBe(100);
    expect(split[split.length - 1]?.endSec).toBeCloseTo(160, 6);
  });

  it("splits an oversized segment with no sentence boundaries on words, and a single huge word on characters", () => {
    const words = chunkTranscript([seg("word ".repeat(600).trim(), 0, 30)]);
    expect(words.length).toBeGreaterThan(1);
    for (const chunk of words)
      expect(tokens(chunk.text)).toBeLessThanOrEqual(HARD_TOKENS);
    const huge = chunkTranscript([
      seg("x".repeat(HARD_TOKENS * 4 * 2 + 5), 0, 30),
    ]);
    expect(huge).toHaveLength(3);
    for (const chunk of huge)
      expect(tokens(chunk.text)).toBeLessThanOrEqual(HARD_TOKENS);
  });

  it("overlaps by one segment after a long segment and by two otherwise", () => {
    const short = chunkTranscript(uniform(40, 5));
    // Two-segment overlap: the second chunk starts two segments before the first ended.
    expect(short[1]?.startSec).toBe((short[0]?.endSec ?? 0) - 10);

    const long = chunkTranscript(uniform(10, LONG_SEGMENT_SEC + 5));
    expect(long[1]?.startSec).toBe(
      (long[0]?.endSec ?? 0) - (LONG_SEGMENT_SEC + 5),
    );
  });

  it("is deterministic", () => {
    const input = englishSegments(300, 7);
    expect(chunkTranscript(input)).toEqual(chunkTranscript(input));
  });
});
