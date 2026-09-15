import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALICE, CHANNEL_A, OWNER, seedApprovedChannel } from "./helpers";

/**
 * The 400 contract in one place (docs/specs/api-reference.md §6, §10.6): every rejection the API
 * produces is `{ error, code: "INVALID_INPUT" }` with the field named, whether the header, the
 * body, the query, or the body's encoding is at fault. The route tests keep their own scattered
 * assertions; this file is the pinned contract.
 */

async function send(
  method: string,
  path: string,
  init: { email?: string; body?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (init.email !== undefined) headers["X-User-Email"] = init.email;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers,
    body: init.body,
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

function expectInvalidInput(
  result: { status: number; json: Record<string, unknown> },
  naming: string,
): void {
  expect(result.status).toBe(400);
  expect(result.json).toMatchObject({
    error: expect.stringContaining(naming),
    code: "INVALID_INPUT",
  });
}

describe("the 400 contract", () => {
  it("a missing header", async () => {
    expectInvalidInput(await send("GET", "/me"), "X-User-Email");
  });

  it("a body that is not JSON", async () => {
    expectInvalidInput(
      await send("POST", "/channels", { email: ALICE, body: "not json" }),
      "JSON",
    );
  });

  it("a body missing its required field", async () => {
    expectInvalidInput(
      await send("POST", "/channels", { email: ALICE, body: "{}" }),
      "channelId",
    );
  });

  it.each([
    ["empty", ""],
    ["whitespace", "  "],
    ["null", null],
  ])("optional text that is %s", async (_label, title) => {
    expectInvalidInput(
      await send("POST", "/channels", {
        email: ALICE,
        body: JSON.stringify({ channelId: CHANNEL_A, title }),
      }),
      "title",
    );
  });

  it("an unknown scope", async () => {
    expectInvalidInput(
      await send("GET", "/channels?scope=bogus", { email: ALICE }),
      "scope",
    );
  });

  it("a digest bound that is not a timestamp", async () => {
    expectInvalidInput(
      await send("GET", "/digest?from=yesterday", { email: ALICE }),
      "from",
    );
  });

  it("a digest cursor the route did not issue", async () => {
    expectInvalidInput(
      await send("GET", "/digest?cursor=not-a-position", { email: ALICE }),
      "cursor",
    );
  });

  it("an empty limit", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    expectInvalidInput(
      await send("GET", `/channels/${CHANNEL_A}/episodes?limit=`, {
        email: ALICE,
      }),
      "limit",
    );
  });

  it("a no-body action with no content type is accepted", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const result = await send("POST", `/channels/${CHANNEL_A}/pause`, {
      email: OWNER,
    });
    expect(result.status).toBe(200);
    expect(result.json.channel).toMatchObject({ paused: true });
  });
});
