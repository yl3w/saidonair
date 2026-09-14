import { describe, expect, it } from "vitest";
import type { StructuredSummary } from "../src/lib/summary";
import {
  DEFAULT_THRESHOLDS,
  scoreSummary,
  splitSentences,
} from "../src/lib/summary-eval";

/** A summary with the given takeaways and a clean three-sentence executive summary. */
function summary(over: Partial<StructuredSummary> = {}): StructuredSummary {
  return {
    executiveSummary:
      "Alberta weighs separation. Both sides marshal economic arguments. No outcome is settled.",
    takeaways: [
      { text: "Janet Brown puts support near 27 percent.", startSec: 60 },
      { text: "Exports to China rose thirty percent.", startSec: 600 },
      {
        text: "A reset of the constitutional arrangement is proposed.",
        startSec: 1200,
      },
    ],
    topicTags: ["alberta", "referendum"],
    ...over,
  };
}

describe("splitSentences", () => {
  it("survives the abbreviations and version numbers a summary contains", () => {
    expect(splitSentences("One. Two. Three.")).toHaveLength(3);
    expect(
      splitSentences("Version 3.5 shipped, e.g. today. That is all."),
    ).toHaveLength(2);
    expect(splitSentences("Dr. Brown spoke. She agreed.")).toHaveLength(2);
    expect(splitSentences("No trailing period")).toHaveLength(1);
    expect(splitSentences("")).toEqual([]);
  });
});

describe("scoreSummary", () => {
  it("passes a clean summary with nothing flagged", () => {
    const f = scoreSummary(summary(), 1800);
    expect(f.sentenceCount).toBe(3);
    expect(f.bannedOpeners).toEqual([]);
    expect(f.labelsParts).toBe(false);
    expect(f.anonymousTakeaways).toEqual([]);
    expect(f.probableDuplicates).toEqual([]);
    expect(f.nullTimestamps).toBe(0);
    expect(f.outOfOrder).toBe(false);
    expect(f.longTags).toEqual([]);
  });

  it("catches the summary that narrates the recording instead of the subject", () => {
    // The fault in 14 of the first 20 real summaries.
    const f = scoreSummary(
      summary({
        executiveSummary:
          "The conversation revolves around Alberta. The speakers discuss the economics. The key conclusion is that nothing is settled.",
      }),
      1800,
    );
    expect(f.bannedOpeners).toHaveLength(2);
    expect(f.labelsParts).toBe(true);
  });

  it("catches a takeaway attributed to nobody, and excuses one named on the spot", () => {
    const f = scoreSummary(
      summary({
        takeaways: [
          // A capitalised country is not an attribution: this is the false negative that hid the
          // CBC episode's four anonymous takeaways.
          {
            text: "The speaker loves Canada but resents its treatment of Alberta.",
            startSec: 60,
          },
          {
            text: "The host, Steven Bartlett, opens with a question.",
            startSec: 120,
          },
          { text: "Janet Brown puts support near 27 percent.", startSec: 180 },
        ],
      }),
      1800,
    );
    expect(f.anonymousTakeaways).toEqual([0]);
  });

  it("flags two takeaways that make one point", () => {
    const f = scoreSummary(
      summary({
        takeaways: [
          {
            text: "The new model uses opaque recurrence, worrying experts.",
            startSec: 60,
          },
          {
            text: "The new model combines opaque recurrence with chain of thought, worrying experts.",
            startSec: 1200,
          },
          { text: "Watermarking survives paraphrase poorly.", startSec: 1500 },
        ],
      }),
      1800,
    );
    expect(f.probableDuplicates).toEqual([[0, 1]]);
  });

  it("measures the coverage hole that a fixed takeaway band used to leave", () => {
    // q2cg1gEYWJQ as published before the quota: 146 minutes, nothing after 1:48:07.
    const f = scoreSummary(
      summary({
        takeaways: [
          { text: "a", startSec: 0 },
          { text: "b", startSec: 572 },
          { text: "c", startSec: 6487 },
        ],
      }),
      8785,
    );
    expect(f.largestGapRatio).toBeCloseTo((6487 - 572) / 8785, 3);
    expect(f.largestGapRatio).toBeGreaterThan(DEFAULT_THRESHOLDS.maxGapRatio);
    // Two of the three markers sit in the first tenth; the episode touches two deciles of ten.
    expect(f.coveredDeciles).toBe(2);
  });

  it("reports no coverage when the runtime is unknown, rather than guessing", () => {
    const f = scoreSummary(summary(), null);
    expect(f.largestGapRatio).toBeNull();
    expect(f.coveredDeciles).toBeNull();
  });

  it("counts null and out-of-order timestamps", () => {
    const f = scoreSummary(
      summary({
        takeaways: [
          { text: "a", startSec: 600 },
          { text: "b", startSec: 60 },
          { text: "c", startSec: null },
        ],
      }),
      1800,
    );
    expect(f.nullTimestamps).toBe(1);
    expect(f.outOfOrder).toBe(true);
  });

  it("flags tags that are phrases rather than one or two words", () => {
    const f = scoreSummary(
      summary({ topicTags: ["ai", "chain of thought", "opaque recurrence"] }),
      1800,
    );
    expect(f.longTags).toEqual(["chain of thought"]);
  });
});
