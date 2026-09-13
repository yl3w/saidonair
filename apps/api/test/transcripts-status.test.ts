import { describe, expect, it } from "vitest";
import {
  DOWNSUB_STATUS_URL,
  type FetchLike,
  providerHealthReader,
  STATUS_CACHE_MS,
} from "../src/lib/transcripts/status";

const KEY = { DOWNSUB_API_KEY: "test-key" };

/** A fetch that answers with one canned response and counts its calls. */
function canned(
  respond: (input: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return respond(input, init);
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("transcript provider health", () => {
  it("reads the remaining credits from a 2xx body and sends the key as a bearer token", async () => {
    // The live shape, confirmed 2026-09-12: the credits sit inside a `data` envelope.
    const { fetchImpl, calls } = canned(() =>
      json({
        status: "ok",
        data: {
          remainingCredits: 144,
          monthlyCredits: 2000,
          bonusCredits: 0,
          expiresAt: "2026-10-08T00:00:00Z",
          plan: "trial",
        },
      }),
    );
    const read = providerHealthReader({ fetch: fetchImpl });
    expect(await read(KEY)).toEqual({ remainingCredits: 144, status: "ok" });
    expect(calls[0]?.input).toBe(DOWNSUB_STATUS_URL);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );
  });

  it("reads a 401 as a rejected key", async () => {
    const { fetchImpl } = canned(() => json({ error: "unauthorized" }, 401));
    const read = providerHealthReader({ fetch: fetchImpl });
    expect(await read(KEY)).toEqual({
      remainingCredits: null,
      status: "auth_failed",
    });
  });

  it.each([
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["a 500", () => json({ data: { remainingCredits: 1 } }, 500)],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    [
      "a body without the credit field",
      () => json({ data: { plan: "trial" } }),
    ],
    [
      "the credit field outside the data envelope",
      () => json({ remainingCredits: 5 }),
    ],
    ["a negative credit count", () => json({ data: { remainingCredits: -1 } })],
  ])("reads %s as unreachable with no credits", async (_label, respond) => {
    const { fetchImpl } = canned(respond);
    const read = providerHealthReader({ fetch: fetchImpl });
    expect(await read(KEY)).toEqual({
      remainingCredits: null,
      status: "unreachable",
    });
  });

  it("gives up after the timeout and reads that as unreachable", async () => {
    const { fetchImpl } = canned(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const read = providerHealthReader({ fetch: fetchImpl, timeoutMs: 20 });
    expect(await read(KEY)).toEqual({
      remainingCredits: null,
      status: "unreachable",
    });
  });

  it("caches one result per reader for five minutes", async () => {
    let clock = 1_000_000;
    let credits = 10;
    const { fetchImpl, calls } = canned(() =>
      json({ data: { remainingCredits: credits } }),
    );
    const read = providerHealthReader({ fetch: fetchImpl, now: () => clock });

    expect((await read(KEY)).remainingCredits).toBe(10);
    credits = 9;
    clock += STATUS_CACHE_MS - 1;
    expect((await read(KEY)).remainingCredits).toBe(10);
    expect(calls).toHaveLength(1);

    clock += 2;
    expect((await read(KEY)).remainingCredits).toBe(9);
    expect(calls).toHaveLength(2);
  });

  it("asks nothing when no key is configured", async () => {
    const { fetchImpl, calls } = canned(() =>
      json({ data: { remainingCredits: 5 } }),
    );
    const read = providerHealthReader({ fetch: fetchImpl });
    for (const env of [
      {},
      { DOWNSUB_API_KEY: "" },
      { DOWNSUB_API_KEY: "  " },
    ]) {
      expect(await read(env)).toEqual({
        remainingCredits: null,
        status: "unreachable",
      });
    }
    expect(calls).toHaveLength(0);
  });
});
