import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isAllowedOrigin, parseOrigins } from "../src/lib/cors";
import { ALICE, signedIn } from "./helpers";

// vitest.config.ts pins WEB_ORIGINS to an exact origin plus a subdomain wildcard.
const ALLOWED = "http://localhost:5173";
const PREVIEW = "https://abc123.example.pages.dev";
const DENIED = "https://evil.example";

describe("origin allowlist", () => {
  it("parses the list and matches exact origins and subdomain wildcards", () => {
    const allowed = parseOrigins(
      " http://localhost:5173/, https://*.example.pages.dev ,, ",
    );
    expect(allowed).toEqual([
      "http://localhost:5173",
      "https://*.example.pages.dev",
    ]);
    expect(isAllowedOrigin("http://localhost:5173", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5174", allowed)).toBe(false);
    expect(isAllowedOrigin("https://abc.example.pages.dev", allowed)).toBe(
      true,
    );
    // The wildcard needs a subdomain, the same scheme, and a host-only label.
    expect(isAllowedOrigin("https://example.pages.dev", allowed)).toBe(false);
    expect(isAllowedOrigin("http://abc.example.pages.dev", allowed)).toBe(
      false,
    );
    expect(
      isAllowedOrigin("https://evil.com/.example.pages.dev", allowed),
    ).toBe(false);
    expect(isAllowedOrigin("", allowed)).toBe(false);
    expect(isAllowedOrigin("https://abc.example.pages.dev", [])).toBe(false);
  });
});

describe("CORS", () => {
  it("answers a preflight for an allowed origin without touching identity", async () => {
    const response = await SELF.fetch("http://api/me", {
      method: "OPTIONS",
      headers: {
        Origin: PREVIEW,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(PREVIEW);
    // A header missing from this list is refused by the browser before the request is made, and
    // surfaces as a bare "NetworkError" with nothing about CORS in it — which is how it was found
    // in A6. `x-user-email` is gone from it since A7, along with the header itself.
    const allowedHeaders = response.headers
      .get("access-control-allow-headers")
      ?.toLowerCase();
    expect(allowedHeaders).toContain("authorization");
    expect(allowedHeaders).not.toContain("x-user-email");
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "DELETE",
    );
    expect(response.headers.get("access-control-max-age")).toBe("86400");
  });

  it("marks actual responses for allowed origins only", async () => {
    const allowed = await SELF.fetch("http://api/me", {
      headers: { Origin: ALLOWED, ...(await signedIn(ALICE)) },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(allowed.headers.get("vary")).toContain("Origin");

    const denied = await SELF.fetch("http://api/me", {
      headers: { Origin: DENIED, ...(await signedIn(ALICE)) },
    });
    expect(denied.status).toBe(200);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const deniedPreflight = await SELF.fetch("http://api/me", {
      method: "OPTIONS",
      headers: { Origin: DENIED, "Access-Control-Request-Method": "GET" },
    });
    expect(
      deniedPreflight.headers.get("access-control-allow-origin"),
    ).toBeNull();
  });
});
