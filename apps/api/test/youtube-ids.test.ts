import { describe, expect, it } from "vitest";
import { domainErrorCode } from "../src/lib/errors";
import {
  CHANNEL_ID_INSTRUCTIONS,
  extractChannelId,
  requireChannelIds,
} from "../src/lib/youtube/ids";
import { CHANNEL_A, CHANNEL_B } from "./helpers";

function rejection(input: string): { code: string | null; message: string } {
  try {
    extractChannelId(input);
  } catch (error) {
    return {
      code: domainErrorCode(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error(`expected ${input} to be rejected`);
}

describe("channel id extraction", () => {
  it("accepts a bare id or any URL carrying /channel/UC…", () => {
    expect(extractChannelId(CHANNEL_A)).toBe(CHANNEL_A);
    expect(extractChannelId(`  ${CHANNEL_A}\n`)).toBe(CHANNEL_A);
    for (const url of [
      `https://www.youtube.com/channel/${CHANNEL_A}`,
      `https://www.youtube.com/channel/${CHANNEL_A}/videos`,
      `https://m.youtube.com/channel/${CHANNEL_A}?si=abc`,
      `youtube.com/channel/${CHANNEL_A}#tab`,
    ]) {
      expect(extractChannelId(url)).toBe(CHANNEL_A);
    }
  });

  it("rejects handles, other URLs, and junk with the copy-the-id instructions", () => {
    for (const input of [
      "@veritasium",
      "https://www.youtube.com/@veritasium",
      "https://www.youtube.com/c/veritasium",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UCtooShort",
      "UC",
      "",
      "not a channel",
    ]) {
      const { code, message } = rejection(input);
      expect(code, input).toBe("INVALID_INPUT");
      expect(message, input).toContain(CHANNEL_ID_INSTRUCTIONS);
    }
  });

  it("validates and dedupes id lists", () => {
    expect(requireChannelIds([CHANNEL_B, CHANNEL_A, CHANNEL_B])).toEqual([
      CHANNEL_B,
      CHANNEL_A,
    ]);
    expect(() => requireChannelIds([CHANNEL_A, "@nope"])).toThrow(
      /INVALID_INPUT/,
    );
  });
});
