import { describe, expect, it, vi } from "vitest";
import { robots, sitemap } from "../../src/server/crawl";

const ORIGIN = "https://example.test";

function api(answers: Record<string, unknown>) {
  return {
    fetch: vi.fn(async (input: Request) => {
      const body = answers[new URL(input.url).pathname];
      if (body === undefined) return new Response("", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  } as unknown as Fetcher;
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
  lastIngestedAt: Date.UTC(2026, 8, 5),
  episodes: { available: 1, pending: 1, failed: 0, skipped: 0 },
  following: false,
  followerCount: 0,
};

const EPISODE = {
  episodeId: "abc",
  channelId: "UC1",
  channelTitle: "CBC Ideas",
  title: "How cities forget",
  publishedAt: Date.UTC(2026, 8, 1),
  status: "available",
  skipReason: null,
  waitReason: null,
  summaryAvailableAt: Date.UTC(2026, 8, 2),
  summary: null,
  related: [],
};

describe("robots", () => {
  it("keeps crawlers off every guarded screen", () => {
    const text = robots(ORIGIN);
    for (const path of [
      "/queue",
      "/history",
      "/chats",
      "/account",
      "/curate",
      "/sign-in",
      "/auth/",
    ]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
  });

  it("disallows exactly /sources, not the channels beneath it", () => {
    // A bare `Disallow: /sources` is a prefix match and would take /sources/UC… with it — and a
    // channel page is public (docs/specs/public-reading.md §3, decision 2b).
    expect(robots(ORIGIN)).toContain("Disallow: /sources$");
    expect(robots(ORIGIN)).not.toMatch(/^Disallow: \/sources$/m);
  });

  it("points at this origin's sitemap, not a hardcoded one", () => {
    expect(robots(ORIGIN)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots("https://other.test")).toContain(
      "https://other.test/sitemap.xml",
    );
  });
});

describe("sitemap", () => {
  it("lists the landing page, each public channel, and each readable episode", async () => {
    const xml = await sitemap(
      ORIGIN,
      api({
        "/channels": { channels: [CHANNEL] },
        "/channels/UC1/episodes": { episodes: [EPISODE] },
      }),
    );
    expect(xml).toContain(`<loc>${ORIGIN}</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/sources/UC1</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/read/abc</loc>`);
    expect(xml).toContain("<lastmod>2026-09-02</lastmod>");
  });

  it("leaves out a hidden channel and an episode with nothing to read", async () => {
    const declined = { ...CHANNEL, channelId: "UC2", status: "declined" };
    const pending = { ...EPISODE, episodeId: "pend", status: "pending" };
    const xml = await sitemap(
      ORIGIN,
      api({
        "/channels": { channels: [CHANNEL, declined] },
        "/channels/UC1/episodes": { episodes: [EPISODE, pending] },
      }),
    );
    expect(xml).not.toContain("UC2");
    expect(xml).not.toContain("/read/pend");
  });

  it("asks for the API's maximum, not its default of 20", async () => {
    // Without this the sitemap silently lists a channel's newest twenty episodes and nothing
    // else — which it did, and which no test and no crawler would have reported.
    const fetcher = api({
      "/channels": { channels: [CHANNEL] },
      "/channels/UC1/episodes": { episodes: [EPISODE] },
    });
    await sitemap(ORIGIN, fetcher);
    const calls = (fetcher.fetch as unknown as { mock: { calls: [Request][] } })
      .mock.calls;
    const episodesCall = calls.find(([request]) =>
      request.url.includes("/episodes"),
    );
    expect(episodesCall?.[0].url).toContain("limit=200");
  });

  it("is still valid when the catalog cannot be read", async () => {
    const xml = await sitemap(ORIGIN, api({}));
    expect(xml).toContain("<urlset");
    expect(xml).toContain(`<loc>${ORIGIN}</loc>`);
  });

  it("escapes what goes into the XML", async () => {
    const xml = await sitemap(
      `${ORIGIN}/?a=1&b=2`,
      api({ "/channels": { channels: [] } }),
    );
    expect(xml).toContain("&amp;");
    expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;)/);
  });
});
