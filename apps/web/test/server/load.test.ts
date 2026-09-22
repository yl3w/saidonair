import { describe, expect, it, vi } from "vitest";
import { load } from "../../src/server/load";

/** A stand-in for the service binding: one canned answer per path, or a status to fail with. */
function api(answers: Record<string, unknown>, status = 200) {
  const calls: Request[] = [];
  const fetcher = {
    fetch: vi.fn(async (input: Request) => {
      calls.push(input);
      const path = new URL(input.url).pathname;
      const body = answers[path];
      if (body === undefined) return new Response("", { status: 404 });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  };
  return { fetcher: fetcher as unknown as Fetcher, calls };
}

const CHANNEL = {
  channelId: "UC1",
  title: "CBC Ideas",
  canonicalUrl: "u",
  status: "approved",
  paused: false,
  approvedAt: 1,
  reviewedAt: 1,
  reviewNote: null,
  lastIngestedAt: 2,
  episodes: { available: 1, pending: 0, failed: 0, skipped: 0 },
  following: false,
  followerCount: 0,
};

const EPISODE = {
  episodeId: "abc",
  channelId: "UC1",
  channelTitle: "CBC Ideas",
  title: "How cities forget",
  publishedAt: 1,
  status: "available",
  skipReason: null,
  waitReason: null,
  summaryAvailableAt: 2,
  summary: null,
  related: [],
};

describe("load", () => {
  it("never sends an Authorization header — the anonymous shape is the point", async () => {
    const { fetcher, calls } = api({ "/channels": { channels: [CHANNEL] } });
    await load({ name: "landing" }, fetcher);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.has("Authorization")).toBe(false);
  });

  it("filters the landing catalog to what a visitor may see", async () => {
    const declined = { ...CHANNEL, channelId: "UC2", status: "declined" };
    const { fetcher } = api({ "/channels": { channels: [CHANNEL, declined] } });
    const result = await load({ name: "landing" }, fetcher);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.data.route !== "landing")
      throw new Error("shape");
    expect(result.data.channels).toHaveLength(1);
  });

  it("renders a hidden channel rather than 404ing it", async () => {
    // docs/specs/public-reading.md §3, decision 5. An earlier draft answered 404 here and was
    // reversed the same day: the channel name on a shared summary has to lead somewhere.
    const declined = {
      ...CHANNEL,
      status: "declined",
      reviewNote: "Not a fit",
    };
    const { fetcher } = api({
      "/channels/UC1": { channel: declined },
      "/channels/UC1/episodes": { episodes: [EPISODE] },
    });
    const result = await load({ name: "channel", channelId: "UC1" }, fetcher);
    expect(result.kind).toBe("ok");
  });

  it("drops the episodes a visitor is not shown", async () => {
    const failed = { ...EPISODE, episodeId: "f", status: "failed" };
    const { fetcher } = api({
      "/channels/UC1": { channel: CHANNEL },
      "/channels/UC1/episodes": { episodes: [EPISODE, failed] },
    });
    const result = await load({ name: "channel", channelId: "UC1" }, fetcher);
    if (result.kind !== "ok" || result.data.route !== "channel")
      throw new Error("shape");
    expect(result.data.episodes.map((e) => e.episodeId)).toEqual(["abc"]);
  });

  it("is `missing` when the API says 404", async () => {
    const { fetcher } = api({});
    expect(
      (await load({ name: "episode", episodeId: "gone" }, fetcher)).kind,
    ).toBe("missing");
  });

  it("is `unavailable` when the API breaks", async () => {
    const { fetcher } = api({ "/channels": { channels: [] } }, 500);
    expect((await load({ name: "landing" }, fetcher)).kind).toBe("unavailable");
  });

  it("is `unavailable` when the binding itself throws", async () => {
    const fetcher = {
      fetch: vi.fn(async () => {
        throw new Error("no route to host");
      }),
    } as unknown as Fetcher;
    expect(
      (await load({ name: "episode", episodeId: "abc" }, fetcher)).kind,
    ).toBe("unavailable");
  });
});
