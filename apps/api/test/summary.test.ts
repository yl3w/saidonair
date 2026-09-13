import { describe, expect, it } from "vitest";
import { chunkTranscript, type TranscriptChunk } from "../src/lib/chunk";
import {
  countSentences,
  formatTimestamp,
  formatTranscript,
  parseSummary,
  parseTimestampMarker,
  SECTION_MAX_SEC,
  sectionize,
} from "../src/lib/summary";
import { englishSegments } from "./fixtures/transcripts";

/** Chunks of exactly one minute each, `count` of them. */
function minutes(count: number): TranscriptChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    text: `minute ${i}`,
    startSec: i * 60,
    endSec: i * 60 + 60,
  }));
}

const VALID = {
  executiveSummary:
    "The host explains the plan. Then a guest disagrees. They settle on a test.",
  takeaways: [
    { text: "Plan first", at: "0:01:10" },
    { text: "Disagree openly", at: "[0:12:00]" },
    { text: "Test it", at: "45:30" },
  ],
  topicTags: ["Planning", " testing "],
};

describe("formatting", () => {
  it("writes h:mm:ss markers with hours always present", () => {
    expect(formatTimestamp(252)).toBe("0:04:12");
    expect(formatTimestamp(3723.9)).toBe("1:02:03");
    expect(formatTimestamp(0)).toBe("0:00:00");
    expect(formatTranscript(minutes(2))).toBe(
      "[0:00:00] minute 0\n[0:01:00] minute 1",
    );
  });

  it("parses markers with or without brackets, h:mm:ss or mm:ss, and rejects the rest", () => {
    expect(parseTimestampMarker("0:04:12")).toBe(252);
    expect(parseTimestampMarker("[1:02:03]")).toBe(3723);
    expect(parseTimestampMarker("45:30")).toBe(2730);
    expect(parseTimestampMarker(" [ 4:12 ] ")).toBe(252);
    for (const bad of ["", "abc", "4:60", "1:2:3:4", "12", "0:99:00"]) {
      expect(parseTimestampMarker(bad)).toBeNull();
    }
  });
});

describe("sectionize", () => {
  it("keeps forty minutes in one section and splits a hundred into three on chunk boundaries", () => {
    expect(sectionize(minutes(40))).toHaveLength(1);
    const sections = sectionize(minutes(100));
    expect(sections.map((s) => s.length)).toEqual([45, 45, 10]);
    for (const section of sections) {
      const first = section[0];
      const last = section[section.length - 1];
      expect((last?.endSec ?? 0) - (first?.startSec ?? 0)).toBeLessThanOrEqual(
        SECTION_MAX_SEC,
      );
    }
    expect(sections.flat()).toEqual(minutes(100));
    expect(sectionize([])).toEqual([]);
  });

  it("works on real chunker output", () => {
    const chunks = chunkTranscript(englishSegments(1200, 5)); // 100 minutes of speech
    const sections = sectionize(chunks);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.flat()).toEqual(chunks);
  });
});

describe("countSentences", () => {
  it("counts terminal punctuation and ignores decimal points", () => {
    expect(countSentences("One. Two! Three?")).toBe(3);
    expect(countSentences("Version 3.5 shipped. It costs 2.50 dollars.")).toBe(
      2,
    );
    expect(countSentences("No terminal punctuation")).toBe(1);
    expect(countSentences("Ends with dots...")).toBe(1);
  });
});

describe("parseSummary", () => {
  it("accepts valid JSON, fenced JSON, and prose around JSON, mapping markers to seconds and lower-casing tags", () => {
    const expected = {
      executiveSummary: VALID.executiveSummary,
      takeaways: [
        { text: "Plan first", startSec: 70 },
        { text: "Disagree openly", startSec: 720 },
        { text: "Test it", startSec: 2730 },
      ],
      topicTags: ["planning", "testing"],
    };
    expect(parseSummary(JSON.stringify(VALID), 3600)).toEqual(expected);
    const fenced = ["```json", JSON.stringify(VALID), "```"].join("\n");
    expect(parseSummary(fenced, 3600)).toEqual(expected);
    expect(
      parseSummary(
        `Sure! Here it is: ${JSON.stringify(VALID)} Hope that helps.`,
        3600,
      ),
    ).toEqual(expected);
  });

  it("nulls a timestamp that is absent, unparsable, or past the known duration, and keeps it with no known duration", () => {
    const summary = parseSummary(
      JSON.stringify({
        ...VALID,
        takeaways: [
          { text: "a", at: null },
          { text: "b", at: "later" },
          { text: "c", at: "1:00:00" },
          { text: "d" },
        ],
      }),
      1800,
    );
    expect(summary?.takeaways.map((t) => t.startSec)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const unknown = parseSummary(
      JSON.stringify({
        ...VALID,
        takeaways: [
          { text: "c", at: "1:00:00" },
          { text: "d", at: "0:00:01" },
          { text: "e", at: "0:00:02" },
        ],
      }),
      null,
    );
    expect(unknown?.takeaways.map((t) => t.startSec)).toEqual([3600, 1, 2]);
  });

  it.each([
    ["no JSON at all", "I cannot help with that."],
    ["broken JSON", "{ executiveSummary: oops"],
    ["two objects in an array", JSON.stringify([VALID, VALID])],
    [
      "four sentences",
      JSON.stringify({ ...VALID, executiveSummary: "One. Two. Three. Four." }),
    ],
    ["an empty summary", JSON.stringify({ ...VALID, executiveSummary: "  " })],
    [
      "two takeaways",
      JSON.stringify({ ...VALID, takeaways: VALID.takeaways.slice(0, 2) }),
    ],
    [
      "six takeaways",
      JSON.stringify({
        ...VALID,
        takeaways: [...VALID.takeaways, ...VALID.takeaways],
      }),
    ],
    [
      "a takeaway without text",
      JSON.stringify({
        ...VALID,
        takeaways: [{ at: "0:00:01" }, ...VALID.takeaways],
      }),
    ],
    [
      "a numeric at",
      JSON.stringify({
        ...VALID,
        takeaways: [{ text: "x", at: 12 }, ...VALID.takeaways.slice(0, 2)],
      }),
    ],
    ["zero tags", JSON.stringify({ ...VALID, topicTags: [] })],
    [
      "nine tags",
      JSON.stringify({ ...VALID, topicTags: "abcdefghi".split("") }),
    ],
    ["a non-string tag", JSON.stringify({ ...VALID, topicTags: ["ok", 3] })],
    [
      "a non-string summary",
      JSON.stringify({ ...VALID, executiveSummary: ["x"] }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseSummary(raw, 3600)).toBeNull();
  });
});
