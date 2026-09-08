import { SELF } from "cloudflare:test";
import { MeResponseSchema } from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { ALICE, expectShape, OWNER } from "./helpers";

function me(email?: string) {
  const headers: Record<string, string> =
    email === undefined ? {} : { "X-User-Email": email };
  return SELF.fetch("http://api/me", { headers });
}

describe("identity middleware via GET /me", () => {
  it("leaves /health public", async () => {
    const response = await SELF.fetch("http://api/health");
    expect(response.status).toBe(200);
  });

  it("returns 400 when X-User-Email is missing or malformed", async () => {
    expect((await me()).status).toBe(400);
    expect((await me("not-an-email")).status).toBe(400);
    expect((await me("   ")).status).toBe(400);
  });

  it("auto-registers and returns the normalized identity", async () => {
    const response = await me("  Alice@Example.COM ");
    expect(response.status).toBe(200);
    const body = await response.json();
    expectShape(MeResponseSchema, body);
    expect(body).toEqual({ email: ALICE, role: "user" });
  });

  it("reports the seeded owner", async () => {
    const response = await me(OWNER);
    expect(await response.json()).toEqual({ email: OWNER, role: "owner" });
  });
});
