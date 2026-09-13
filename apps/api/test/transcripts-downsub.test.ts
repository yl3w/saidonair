import { describe, expect, it } from "vitest";
import {
  chooseTrack,
  DOWNSUB_DOWNLOAD_URL,
  downsubSource,
  type FetchLike,
} from "../src/lib/transcripts/downsub";
import {
  TranscriptError,
  type TranscriptFailure,
  transcriptFailure,
} from "../src/lib/transcripts/types";

const VIDEO = "dQw4w9WgXcQ";
const VTT =
  "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello there\n\n00:00:03.000 --> 00:00:05.000\nGeneral Kenobi\n";

/** Routes the download call and any caption-file call to canned responses; counts every request. */
function canned(
  download: () => Response | Promise<Response>,
  vtt: () => Response | Promise<Response> = () =>
    new Response(VTT, { status: 200 }),
) {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return input.startsWith(DOWNSUB_DOWNLOAD_URL) ? download() : vtt();
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const track = (code: string, language = code) => ({
  language,
  code,
  formats: [
    { format: "srt", url: `https://download.downsub.com/srt/${code}` },
    { format: "vtt", url: `https://download.downsub.com/vtt/${code}` },
    { format: "txt", url: `https://download.downsub.com/txt/${code}` },
  ],
});

const found = (subtitles: unknown[], duration = 213) =>
  json({
    status: "success",
    data: {
      state: "subtitles_found",
      duration,
      metadata: { isLiveContent: false },
      subtitles,
      translatedSubtitles: [],
    },
  });

async function failure(
  promise: Promise<unknown>,
): Promise<TranscriptFailure | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(TranscriptError);
    return transcriptFailure(error);
  }
}

describe("downsubSource", () => {
  it("asks for the public watch URL with the key as a bearer token, then fetches the chosen VTT once", async () => {
    const { fetchImpl, calls } = canned(() =>
      found([track("en", "English"), track("en_auto")]),
    );
    const result = await downsubSource("k3y", fetchImpl).fetch(VIDEO);
    expect(result).toEqual({
      segments: [
        { text: "Hello there", startSec: 1, durationSec: 2 },
        { text: "General Kenobi", startSec: 3, durationSec: 2 },
      ],
      durationSec: 213,
      isLive: false,
      captionStatus: "english",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toBe(
      `${DOWNSUB_DOWNLOAD_URL}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${VIDEO}`)}`,
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer k3y",
    );
    expect(calls[1]?.input).toBe("https://download.downsub.com/vtt/en");
    expect(calls[1]?.init?.headers).not.toHaveProperty("authorization");
  });

  it("reports no captions when the provider says so, and downloads nothing", async () => {
    const { fetchImpl, calls } = canned(() =>
      json({
        status: "success",
        data: {
          state: "no_subtitles",
          duration: 900,
          metadata: {},
          subtitles: [],
        },
      }),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toEqual({
      segments: null,
      durationSec: 900,
      isLive: false,
      captionStatus: "none",
    });
    expect(calls).toHaveLength(1);
  });

  it("reports non-English when tracks exist but none is English by code, without downloading", async () => {
    const { fetchImpl, calls } = canned(() =>
      found([track("fr", "English"), track("de-DE", "undefined")]),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toMatchObject({
      segments: null,
      captionStatus: "non_english",
    });
    expect(calls).toHaveLength(1);
  });

  it("reports no captions when subtitles_found carries no tracks at all", async () => {
    const { fetchImpl } = canned(() => found([]));
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toMatchObject({
      captionStatus: "none",
    });
  });

  it("reports no captions when the chosen English file has no usable cue", async () => {
    const { fetchImpl } = canned(
      () => found([track("en_auto")]),
      () =>
        new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<c></c>\n", {
          status: 200,
        }),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toEqual({
      segments: null,
      durationSec: 213,
      isLive: false,
      captionStatus: "none",
    });
  });

  it("reads a live stream's reason-less error as waiting, with its duration", async () => {
    const { fetchImpl } = canned(() =>
      json({
        status: "success",
        data: {
          state: "error",
          duration: 36712,
          metadata: { author: "Lofi Girl" },
          subtitles: [],
        },
      }),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toEqual({
      segments: null,
      durationSec: 36712,
      isLive: true,
      captionStatus: "none",
    });
  });

  it("reads an error with a playability reason as unplayable, carrying the reason", async () => {
    const { fetchImpl } = canned(() =>
      json({
        status: "success",
        data: {
          state: "error",
          duration: 0,
          metadata: {
            isLiveContent: false,
            playabilityStatus: "ERROR",
            playabilityReason: "This video is unavailable",
          },
          subtitles: [],
        },
      }),
    );
    let caught: unknown;
    try {
      await downsubSource("k", fetchImpl).fetch(VIDEO);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TranscriptError);
    expect((caught as TranscriptError).reason).toBe("UNPLAYABLE");
    expect((caught as TranscriptError).message).toBe(
      "UNPLAYABLE: This video is unavailable",
    );
  });

  it("reads a reason-less error with an empty metadata object and no title or duration as unplayable", async () => {
    // Seen for a bogus id on 2026-09-13: the same id had carried a playabilityReason minutes earlier.
    const { fetchImpl } = canned(() =>
      json({
        status: "success",
        data: {
          state: "error",
          title: "",
          thumbnail: "",
          duration: 0,
          metadata: {},
          subtitles: [],
        },
      }),
    );
    let caught: unknown;
    try {
      await downsubSource("k", fetchImpl).fetch(VIDEO);
    } catch (error) {
      caught = error;
    }
    expect(transcriptFailure(caught)).toBe("UNPLAYABLE");
    expect((caught as TranscriptError).message).toMatch(/no video metadata/);
  });

  it("reads a reason-less error for a video with a title but no duration yet as waiting", async () => {
    // An upcoming premiere: known to YouTube, not started.
    const { fetchImpl } = canned(() =>
      json({
        status: "success",
        data: {
          state: "error",
          title: "Premiere",
          duration: 0,
          metadata: { channelId: "UCx" },
          subtitles: [],
        },
      }),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toEqual({
      segments: null,
      durationSec: null,
      isLive: true,
      captionStatus: "none",
    });
  });

  it("reads a live thumbnail as live even with a playability reason", async () => {
    const { fetchImpl } = canned(() =>
      json({
        status: "success",
        data: {
          state: "error",
          title: "radio",
          thumbnail: "https://i.ytimg.com/vi/x/maxresdefault_live.jpg",
          duration: 10,
          metadata: { playabilityReason: "This live event will begin soon" },
          subtitles: [],
        },
      }),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toMatchObject({
      isLive: true,
    });
  });

  it("lets known live metadata win over a playability reason", async () => {
    const { fetchImpl } = canned(() =>
      json({
        status: "success",
        data: {
          state: "error",
          duration: 100,
          metadata: {
            isLiveContent: true,
            playabilityReason: "This live event will begin soon",
          },
          subtitles: [],
        },
      }),
    );
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toMatchObject({
      isLive: true,
    });
  });

  it.each([
    [401, "PROVIDER_AUTH"],
    [403, "PROVIDER_LIMIT"],
    [429, "PROVIDER_RATE_LIMIT"],
    [500, "PROVIDER_HTTP"],
    [502, "PROVIDER_HTTP"],
  ] as const)("maps HTTP %s to %s", async (status, reason) => {
    const { fetchImpl } = canned(() => json({ error: "x" }, status));
    expect(await failure(downsubSource("k", fetchImpl).fetch(VIDEO))).toBe(
      reason,
    );
  });

  it.each([
    [
      "a network failure",
      () => Promise.reject(new TypeError("fetch failed")),
      "PROVIDER_HTTP",
    ],
    [
      "a body that is not JSON",
      () => new Response("<html>", { status: 200 }),
      "PROVIDER_PARSE",
    ],
    [
      "JSON without data.state",
      () => json({ status: "success", data: {} }),
      "PROVIDER_PARSE",
    ],
    [
      "an unknown state",
      () => json({ status: "success", data: { state: "processing" } }),
      "PROVIDER_PARSE",
    ],
  ] as const)("maps %s to %s", async (_label, respond, reason) => {
    const { fetchImpl } = canned(respond);
    expect(await failure(downsubSource("k", fetchImpl).fetch(VIDEO))).toBe(
      reason,
    );
  });

  it("maps a failed or unparsable caption download to PROVIDER_PARSE", async () => {
    const failing = canned(
      () => found([track("en")]),
      () => new Response("gone", { status: 500 }),
    );
    expect(
      await failure(downsubSource("k", failing.fetchImpl).fetch(VIDEO)),
    ).toBe("PROVIDER_PARSE");
    const noUrl = canned(() =>
      found([
        {
          language: "English",
          code: "en",
          formats: [{ format: "srt", url: "https://x/srt" }],
        },
      ]),
    );
    expect(
      await failure(downsubSource("k", noUrl.fetchImpl).fetch(VIDEO)),
    ).toBe("PROVIDER_PARSE");
  });

  it("throws PROVIDER_AUTH without calling out when no key is configured", async () => {
    for (const key of [undefined, "", "  "]) {
      const { fetchImpl, calls } = canned(() => found([track("en")]));
      expect(await failure(downsubSource(key, fetchImpl).fetch(VIDEO))).toBe(
        "PROVIDER_AUTH",
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("treats a zero or missing duration as unknown", async () => {
    const { fetchImpl } = canned(() => found([track("en")], 0));
    expect(await downsubSource("k", fetchImpl).fetch(VIDEO)).toMatchObject({
      durationSec: null,
    });
  });
});

describe("chooseTrack", () => {
  const t = (code: string) => ({ code, vttUrl: `https://x/${code}` });

  it("prefers a manual English track over auto-captions, by code", () => {
    expect(chooseTrack([t("en_auto"), t("en")])).toEqual({
      kind: "english",
      track: t("en"),
    });
    expect(chooseTrack([t("en_auto"), t("en-GB")])).toEqual({
      kind: "english",
      track: t("en-GB"),
    });
  });

  it("falls back to English auto-captions, including regional ones", () => {
    expect(chooseTrack([t("fr"), t("en_auto")])).toEqual({
      kind: "english",
      track: t("en_auto"),
    });
    expect(chooseTrack([t("en-US_auto")])).toEqual({
      kind: "english",
      track: t("en-US_auto"),
    });
  });

  it("never reads labels: a track labelled English with code fr is not English", () => {
    expect(chooseTrack([{ code: "fr", vttUrl: "https://x/fr" }])).toEqual({
      kind: "non_english",
    });
    expect(chooseTrack([t("english"), t("eng")])).toEqual({
      kind: "non_english",
    });
  });

  it("distinguishes no tracks from non-English tracks", () => {
    expect(chooseTrack([])).toEqual({ kind: "none" });
    expect(chooseTrack([t("de-DE")])).toEqual({ kind: "non_english" });
  });
});
