import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, bindSession, NO_ACCOUNT } from "../src/api";

/**
 * The client's half of the public reads (`docs/specs/route-visibility.md` §1). The API answers
 * those five to a caller with no session; until 2026-09-21 this client refused to *make* the call,
 * so a visitor met "not signed in" in their own browser while `curl` got a 200 from the same route.
 * These tests are what would have caught that.
 */

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function headersOf(fetchMock: ReturnType<typeof stubFetch>): Headers {
  const init = fetchMock.mock.calls[0]?.[1];
  return new Headers(init?.headers ?? {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  bindSession(null);
});

describe("the five public reads, with no session", () => {
  it("sends the request instead of refusing it, and sends no Authorization header", async () => {
    bindSession(null);
    const fetchMock = stubFetch({ channels: [] });

    await expect(api.listChannels()).resolves.toEqual({ channels: [] });
    expect(headersOf(fetchMock).has("Authorization")).toBe(false);
  });

  it("covers all five, not only the catalog", async () => {
    bindSession(null);
    stubFetch({});

    await expect(api.getChannel("UC1")).resolves.toBeDefined();
    await expect(api.listEpisodes("UC1")).resolves.toBeDefined();
    await expect(api.getEpisode("UC1", "e1")).resolves.toBeDefined();
    await expect(api.getEpisodeById("e1")).resolves.toBeDefined();
  });
});

describe("everything else, with no session", () => {
  it("still fails fast rather than sending a request the API would refuse", async () => {
    bindSession(null);
    const fetchMock = stubFetch({});

    await expect(api.getMe()).rejects.toMatchObject({ code: NO_ACCOUNT });
    await expect(api.getCatalog()).rejects.toBeInstanceOf(ApiError);
    await expect(api.listFollows()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("with a session", () => {
  it("sends the bearer token on a public read too — it is richer signed in", async () => {
    bindSession({ token: "t0ken", email: "reader@example.com" });
    const fetchMock = stubFetch({ channels: [] });

    await api.listChannels();
    expect(headersOf(fetchMock).get("Authorization")).toBe("Bearer t0ken");
  });
});
