import { SELF } from "cloudflare:test";
import { MeResponseSchema } from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { ALICE, expectShape, identityOf, OWNER, signedIn } from "./helpers";

async function me(email?: string) {
  const headers = email === undefined ? {} : await signedIn(email);
  return SELF.fetch("http://api/me", { headers });
}

describe("identity middleware via GET /me", () => {
  it("leaves /health public", async () => {
    const response = await SELF.fetch("http://api/health");
    expect(response.status).toBe(200);
  });

  it("returns 401 UNAUTHENTICATED without a session the API accepts", async () => {
    // No header, a token that was never minted, and a malformed one: the same answer to all three,
    // because a caller learns nothing from which of them it was.
    const attempts: (Record<string, string> | undefined)[] = [
      undefined,
      { Authorization: "Bearer not-a-real-token" },
      { Authorization: "nonsense" },
    ];
    for (const headers of attempts) {
      const response = await SELF.fetch("http://api/me", { headers });
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
  });

  it("auto-registers and returns the normalized identity", async () => {
    const response = await me("  Alice@Example.COM ");
    expect(response.status).toBe(200);
    const body = await response.json();
    expectShape(MeResponseSchema, body);
    expect(body).toEqual({
      userId: await identityOf(ALICE),
      email: ALICE,
      role: "user",
    });
  });

  it("reports the seeded owner", async () => {
    const response = await me(OWNER);
    expect(await response.json()).toEqual({
      userId: await identityOf(OWNER),
      email: OWNER,
      role: "owner",
    });
  });
});
