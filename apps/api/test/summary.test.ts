import { describe, expect, it } from "vitest";
import { chunkTranscript, type TranscriptChunk } from "../src/lib/chunk";
import type { StructuredSummary } from "../src/lib/summary";
import {
  allocateTakeaways,
  formatSectionSummary,
  formatTimestamp,
  formatTranscript,
  MAX_TAGS,
  MAX_TAKEAWAYS,
  MIN_TAGS,
  MIN_TAKEAWAYS,
  parseSummary,
  parseSynthesis,
  parseTimestampMarker,
  SECTION_MAX_SEC,
  SUMMARY_RESPONSE_SCHEMA,
  SYNTHESIS_RESPONSE_SCHEMA,
  sectionize,
  takeawayCount,
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
  it("keeps twenty minutes in one section and divides a hundred into five", () => {
    expect(sectionize(minutes(20))).toHaveLength(1);
    const sections = sectionize(minutes(100));
    expect(sections.map((s) => s.length)).toEqual([20, 20, 20, 20, 20]);
    expect(sections.flat()).toEqual(minutes(100));
    expect(sectionize([])).toEqual([]);
  });

  it("divides the episode that exposed the problem into eight even sections", () => {
    // q2cg1gEYWJQ, 146 minutes: eight sections of about eighteen, where 45-minute sections left
    // the last half hour unrepresented (docs/specs/summary-coverage.md §2).
    const sections = sectionize(minutes(146));
    expect(sections).toHaveLength(8);
    expect(sections.map((s) => s.length)).toEqual([
      18, 18, 18, 19, 18, 18, 18, 19,
    ]);
  });

  it("never leaves a runt, and never exceeds the cap, at any length", () => {
    // 135 minutes used to come out as seven 19-minute sections and a 2-minute tail no fold could
    // absorb; a 2-minute section would draw a full map call and a full share of the budget.
    for (const total of [
      21, 25, 40, 46, 50, 67, 90, 91, 100, 135, 136, 146, 200,
    ]) {
      const sections = sectionize(minutes(total));
      const spans = sections.map((section) => {
        const first = section[0];
        const last = section[section.length - 1];
        return (last?.endSec ?? 0) - (first?.startSec ?? 0);
      });
      const longest = Math.max(...spans);
      expect(longest).toBeLessThanOrEqual(SECTION_MAX_SEC);
      expect(Math.min(...spans)).toBeGreaterThan(longest / 2);
      expect(sections.flat()).toEqual(minutes(total));
    }
  });

  it("works on real chunker output", () => {
    const chunks = chunkTranscript(englishSegments(1200, 5)); // 100 minutes of speech
    const sections = sectionize(chunks);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(sections.flat()).toEqual(chunks);
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

  it("keeps an executive summary that runs past the three sentences the prompt asks for", () => {
    const long = "One. Two. Three. Four. Version 3.5 shipped, e.g. today.";
    const summary = parseSummary(
      JSON.stringify({ ...VALID, executiveSummary: long }),
      3600,
    );
    expect(summary?.executiveSummary).toBe(long);
    expect(summary?.takeaways).toHaveLength(3);
  });

  it("accepts as many takeaways as a long reduce may return", () => {
    const eight = Array.from({ length: MAX_TAKEAWAYS }, (_, i) => ({
      text: `point ${i}`,
      at: "0:01:00",
    }));
    const summary = parseSummary(
      JSON.stringify({ ...VALID, takeaways: eight }),
      3600,
    );
    expect(summary?.takeaways).toHaveLength(MAX_TAKEAWAYS);
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
    ["an empty summary", JSON.stringify({ ...VALID, executiveSummary: "  " })],
    [
      "two takeaways",
      JSON.stringify({ ...VALID, takeaways: VALID.takeaways.slice(0, 2) }),
    ],
    [
      "one takeaway more than the ceiling",
      JSON.stringify({
        ...VALID,
        takeaways: Array.from({ length: MAX_TAKEAWAYS + 1 }, (_, i) => ({
          text: `point ${i}`,
          at: "0:01:00",
        })),
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

describe("the response schema", () => {
  it("carries the validator's own bounds, so the platform and parseSummary cannot drift", () => {
    const { takeaways, topicTags } = SUMMARY_RESPONSE_SCHEMA.properties;
    expect(takeaways.minItems).toBe(MIN_TAKEAWAYS);
    expect(takeaways.maxItems).toBe(MAX_TAKEAWAYS);
    expect(topicTags.minItems).toBe(MIN_TAGS);
    expect(topicTags.maxItems).toBe(MAX_TAGS);
    expect(SUMMARY_RESPONSE_SCHEMA.required).toEqual([
      "executiveSummary",
      "takeaways",
      "topicTags",
    ]);
    expect(takeaways.items.properties.at.type).toEqual(["string", "null"]);
  });
});

describe("formatSectionSummary", () => {
  it("renders a validated section back into the markers the reduce prompt promises", () => {
    const rendered = formatSectionSummary({
      executiveSummary: "One. Two. Three.",
      takeaways: [
        { text: "Plan first", startSec: 223 },
        { text: "No marker", startSec: null },
        { text: "Then test", startSec: 3723 },
      ],
      topicTags: ["planning"],
    });
    expect(JSON.parse(rendered)).toEqual({
      executiveSummary: "One. Two. Three.",
      takeaways: [
        { text: "Plan first", at: "[0:03:43]" },
        { text: "No marker", at: null },
        { text: "Then test", at: "[1:02:03]" },
      ],
      topicTags: ["planning"],
    });
    // And the reduce call's answer round-trips: what it echoes back validates to the same seconds.
    expect(parseSummary(rendered, 7200)?.takeaways).toEqual([
      { text: "Plan first", startSec: 223 },
      { text: "No marker", startSec: null },
      { text: "Then test", startSec: 3723 },
    ]);
  });
});

describe("takeawayCount", () => {
  it("scales with the runtime, within the validator's bounds", () => {
    // The 146-minute episode that exposed the fault: 23 takeaways offered, 7 kept.
    expect(takeawayCount(146 * 60)).toBe(18);
    expect(takeawayCount(50 * 60)).toBe(6);
    expect(takeawayCount(6 * 3600)).toBe(MAX_TAKEAWAYS);
    expect(takeawayCount(10 * 60)).toBe(5);
    expect(takeawayCount(null)).toBe(8);
    for (const minutes of [25, 45, 60, 90, 146, 180, 300]) {
      const n = takeawayCount(minutes * 60);
      expect(n).toBeGreaterThanOrEqual(MIN_TAKEAWAYS);
      expect(n).toBeLessThanOrEqual(MAX_TAKEAWAYS);
    }
  });
});

/** `count` takeaways a minute apart, starting at `fromSec`. */
function section(fromSec: number, count: number): StructuredSummary {
  return {
    executiveSummary: `section at ${fromSec}`,
    takeaways: Array.from({ length: count }, (_, i) => ({
      text: `point ${fromSec}/${i}`,
      startSec: fromSec + i * 60,
    })),
    topicTags: ["tag"],
  };
}

describe("allocateTakeaways", () => {
  it("represents every section before it represents any section twice", () => {
    const sections = [section(0, 6), section(1200, 6), section(2400, 6)];
    const picked = allocateTakeaways(sections, 3);
    // One from each, not three from the first: the failure this replaces.
    expect(picked.map((t) => t.startSec)).toEqual([0, 1200, 2400]);
  });

  it("spreads within a section instead of taking its first few", () => {
    const picked = allocateTakeaways([section(0, 5)], 3);
    // Indices 0, 2, 4 of five - not 0, 1, 2, which would front-load one level down.
    expect(picked.map((t) => t.startSec)).toEqual([0, 120, 240]);
  });

  it("hands an underfilled section's quota to the others", () => {
    const sections = [section(0, 1), section(1200, 6), section(2400, 6)];
    const picked = allocateTakeaways(sections, 9);
    expect(picked).toHaveLength(9);
    // The short section gives its one; the other two cover the rest.
    expect(
      picked.filter((t) => t.startSec !== null && t.startSec < 1200),
    ).toHaveLength(1);
  });

  it("returns everything when more is asked for than exists, and nothing for nothing", () => {
    const sections = [section(0, 3), section(1200, 2)];
    expect(allocateTakeaways(sections, 99)).toHaveLength(5);
    expect(allocateTakeaways(sections, 0)).toEqual([]);
    expect(allocateTakeaways([], 5)).toEqual([]);
  });

  it("keeps the result chronological across sections", () => {
    const sections = [
      section(0, 6),
      section(1200, 6),
      section(2400, 6),
      section(3600, 6),
    ];
    const picked = allocateTakeaways(sections, 18);
    const marks = picked.map((t) => t.startSec ?? 0);
    expect(marks).toEqual([...marks].sort((a, b) => a - b));
    // Every section contributes: the guarantee the model would not give us.
    for (const from of [0, 1200, 2400, 3600]) {
      expect(marks.some((m) => m >= from && m < from + 600)).toBe(true);
    }
  });
});

describe("parseSynthesis", () => {
  it("accepts the two fields and rejects anything else", () => {
    expect(
      parseSynthesis(
        JSON.stringify({
          executiveSummary: "One. Two. Three.",
          topicTags: ["A", " b "],
        }),
      ),
    ).toEqual({ executiveSummary: "One. Two. Three.", topicTags: ["a", "b"] });
    expect(parseSynthesis("not json")).toBeNull();
    expect(
      parseSynthesis(
        JSON.stringify({ executiveSummary: " ", topicTags: ["a"] }),
      ),
    ).toBeNull();
    expect(
      parseSynthesis(JSON.stringify({ executiveSummary: "x", topicTags: [] })),
    ).toBeNull();
    expect(
      parseSynthesis(
        JSON.stringify({
          executiveSummary: "x",
          topicTags: "abcdefghi".split(""),
        }),
      ),
    ).toBeNull();
  });

  it("carries the validator's tag bounds into the schema", () => {
    expect(SYNTHESIS_RESPONSE_SCHEMA.properties.topicTags.minItems).toBe(
      MIN_TAGS,
    );
    expect(SYNTHESIS_RESPONSE_SCHEMA.properties.topicTags.maxItems).toBe(
      MAX_TAGS,
    );
    expect(SYNTHESIS_RESPONSE_SCHEMA.required).toEqual([
      "executiveSummary",
      "topicTags",
    ]);
  });
});
