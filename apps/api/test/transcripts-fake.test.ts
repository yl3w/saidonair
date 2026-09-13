import { describe, expect, it } from "vitest";
import { fakeProviderHealth, transcriptSource } from "../src/lib/transcripts";
import { transcriptProviderHealth } from "../src/lib/transcripts/status";
import {
  TranscriptError,
  transcriptFailure,
} from "../src/lib/transcripts/types";
import {
  FAKE_TRANSCRIPTS,
  VIDEO_ENGLISH,
  VIDEO_LIMIT_FAILS,
  VIDEO_LIVE,
} from "./fixtures/transcripts";

const FAKE = { TRANSCRIPTS_FAKE: JSON.stringify(FAKE_TRANSCRIPTS) };

describe("the transcript fake", () => {
  it("serves canned results by video id", async () => {
    const source = transcriptSource(FAKE);
    const english = await source.fetch(VIDEO_ENGLISH);
    expect(english.captionStatus).toBe("english");
    expect(english.segments?.length).toBe(120);
    expect(await source.fetch(VIDEO_LIVE)).toMatchObject({
      isLive: true,
      segments: null,
    });
  });

  it("throws the canned failure with its reason", async () => {
    let caught: unknown;
    try {
      await transcriptSource(FAKE).fetch(VIDEO_LIMIT_FAILS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TranscriptError);
    expect(transcriptFailure(caught)).toBe("PROVIDER_LIMIT");
  });

  it("fails loudly on a video the fake does not know", async () => {
    let caught: unknown;
    try {
      await transcriptSource(FAKE).fetch("unknown0001");
    } catch (error) {
      caught = error;
    }
    expect(transcriptFailure(caught)).toBe("PROVIDER_HTTP");
  });

  it("answers the provider's health from the fake and fetches nothing", async () => {
    expect(fakeProviderHealth(FAKE)).toEqual({
      remainingCredits: 1000,
      status: "ok",
    });
    expect(
      await transcriptProviderHealth({ ...FAKE, DOWNSUB_API_KEY: "real-key" }),
    ).toEqual({
      remainingCredits: 1000,
      status: "ok",
    });
    const noStatus = { TRANSCRIPTS_FAKE: JSON.stringify({ videos: {} }) };
    expect(fakeProviderHealth(noStatus)).toEqual({
      remainingCredits: null,
      status: "unreachable",
    });
    expect(fakeProviderHealth({})).toBeNull();
  });

  it("rejects an unknown failure reason at parse time", () => {
    expect(() =>
      transcriptSource({
        TRANSCRIPTS_FAKE: JSON.stringify({
          videos: { a: { failure: "NOPE" } },
        }),
      }),
    ).toThrow(/unknown failure NOPE/);
  });
});

describe("transcriptFailure", () => {
  it("recovers every reason from an error that crossed a step boundary, and null otherwise", () => {
    for (const reason of [
      "UNPLAYABLE",
      "PROVIDER_AUTH",
      "PROVIDER_LIMIT",
      "PROVIDER_RATE_LIMIT",
      "PROVIDER_HTTP",
      "PROVIDER_PARSE",
    ] as const) {
      expect(transcriptFailure(new Error(`${reason}: some detail`))).toBe(
        reason,
      );
      expect(transcriptFailure(new Error(reason))).toBe(reason);
      expect(transcriptFailure(new TranscriptError(reason))).toBe(reason);
    }
    expect(transcriptFailure(new Error("INVALID_STATE: nope"))).toBeNull();
    expect(transcriptFailure("PROVIDER_AUTH")).toBeNull();
    expect(transcriptFailure(null)).toBeNull();
  });
});
