import { SELF } from "cloudflare:test";
import { PreferencesResponseSchema } from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { ALICE, BOB, expectShape, userDO } from "./helpers";

type Json = Record<string, unknown>;

async function call(
  email: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const response = await SELF.fetch("http://api/preferences", {
    method,
    headers: {
      "X-User-Email": email,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

describe("preference routes", () => {
  it("reads empty rules, saves them, clears them, and keeps them private per caller", async () => {
    const empty = await call(ALICE, "GET");
    expect(empty.status).toBe(200);
    expectShape(PreferencesResponseSchema, empty.json);
    expect(empty.json.preferences).toEqual({
      systemRules: "",
      updatedAt: null,
    });

    const saved = await call(ALICE, "PUT", { systemRules: "  Be brief.  " });
    expect(saved.status).toBe(200);
    expectShape(PreferencesResponseSchema, saved.json);
    expect(saved.json.preferences).toMatchObject({ systemRules: "Be brief." });
    expect((saved.json.preferences as Json).updatedAt).toEqual(
      expect.any(Number),
    );
    expect((await call(ALICE, "GET")).json.preferences).toMatchObject({
      systemRules: "Be brief.",
    });

    // Rules are one caller's own: Bob's User DO knows nothing of Alice's.
    expect((await call(BOB, "GET")).json.preferences).toMatchObject({
      systemRules: "",
    });
    expect(await (await userDO(BOB)).getPreferences()).toMatchObject({
      systemRules: "",
    });

    // An empty string clears them, which is why it is not the blank the API rejects elsewhere.
    expect(
      ((await call(ALICE, "PUT", { systemRules: "" })).json.preferences as Json)
        .systemRules,
    ).toBe("");
  });

  it("rejects a missing body, a wrong type, and rules past the cap", async () => {
    expect((await call(ALICE, "PUT", {})).status).toBe(400);
    expect((await call(ALICE, "PUT", { systemRules: 7 })).status).toBe(400);
    expect(
      (await call(ALICE, "PUT", { systemRules: "x".repeat(4001) })).status,
    ).toBe(400);
  });
});
