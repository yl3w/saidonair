import { describe, expect, it } from "vitest";
import { parseTimestamp, parseVtt } from "../src/lib/transcripts/vtt";

const vtt = (body: string) => `WEBVTT\n\n${body}`;

describe("parseVtt", () => {
  it("parses cues with dot or comma milliseconds into segments", () => {
    const segments = parseVtt(
      vtt(
        "00:00:01.000 --> 00:00:03.500\nHello there\n\n00:00:03,500 --> 00:00:06,000\nGeneral Kenobi",
      ),
    );
    expect(segments).toEqual([
      { text: "Hello there", startSec: 1, durationSec: 2.5 },
      { text: "General Kenobi", startSec: 3.5, durationSec: 2.5 },
    ]);
  });

  it("strips tags and joins multi-line cues with one space", () => {
    const segments = parseVtt(
      vtt(
        "1\n00:00:00.000 --> 00:00:02.000\n<c.colorE5E5E5>first</c> line\n<00:00:01.000><c>second</c>   line\n",
      ),
    );
    expect(segments).toEqual([
      { text: "first line second line", startSec: 0, durationSec: 2 },
    ]);
  });

  it("drops cues whose text is empty after stripping", () => {
    const segments = parseVtt(
      vtt(
        "00:00:00.000 --> 00:00:01.000\n<c></c>\n\n00:00:01.000 --> 00:00:02.000\n   \n\n00:00:02.000 --> 00:00:03.000\nkept",
      ),
    );
    expect(segments).toEqual([{ text: "kept", startSec: 2, durationSec: 1 }]);
  });

  it("returns no segments for an empty or header-only file", () => {
    expect(parseVtt("")).toEqual([]);
    expect(parseVtt("WEBVTT\n")).toEqual([]);
    expect(parseVtt("WEBVTT\nKind: captions\nLanguage: en\n\n")).toEqual([]);
  });

  it("skips a cue with a malformed timing line or a start not before its end, keeping the rest", () => {
    const segments = parseVtt(
      vtt(
        "00:00:00.000 --> nonsense\nbroken\n\n00:00:05.000 --> 00:00:04.000\nbackwards\n\n00:00:06.000 --> 00:00:06.000\nzero\n\n00:00:07.000 --> 00:00:08.000\nfine",
      ),
    );
    expect(segments).toEqual([{ text: "fine", startSec: 7, durationSec: 1 }]);
  });

  it("accepts mm:ss timings, hours over 99, and Windows line endings", () => {
    const segments = parseVtt(
      "WEBVTT\r\n\r\n01:02.250 --> 01:03.000\r\nshort form\r\n\r\n100:00:00.000 --> 100:00:01.000\r\nlong video\r\n",
    );
    expect(segments).toEqual([
      { text: "short form", startSec: 62.25, durationSec: 0.75 },
      { text: "long video", startSec: 360_000, durationSec: 1 },
    ]);
  });
});

describe("parseTimestamp", () => {
  it.each([
    ["00:00:00.000", 0],
    ["00:01:02.500", 62.5],
    ["01:02", 62],
    ["1:02:03,04", 3723.04],
    ["01:02:03.5", 3723.5],
  ])("parses %s", (value, expected) => {
    expect(parseTimestamp(value)).toBeCloseTo(expected, 3);
  });

  it.each([
    ["", null],
    ["abc", null],
    ["00:60:00.000", null],
    ["00:00:60.000", null],
    ["1.5", null],
  ])("rejects %s", (value, expected) => {
    expect(parseTimestamp(value)).toBe(expected);
  });
});
