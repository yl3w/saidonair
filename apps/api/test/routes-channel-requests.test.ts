import { SELF } from "cloudflare:test";
import {
  ApproveChannelRequestResponseSchema,
  ChannelRequestResponseSchema,
  ChannelRequestsResponseSchema,
} from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  CHANNEL_E,
  expectShape,
  OWNER,
  registry,
  setChannelState,
} from "./helpers";

type Json = Record<string, unknown>;

async function call(
  email: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers: {
      "X-User-Email": email,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

// Feeds come from YOUTUBE_FEEDS_FAKE (vitest.config.ts): A…D titled "Feed A"…"Feed D", E is a 404.

/** A: available; B: pending; C: deleted (was available). D and E are not in the catalog. */
async function seedCatalog() {
  const stub = registry();
  await stub.configureChannel(OWNER, { channelId: CHANNEL_A, title: "A" });
  await stub.configureChannel(OWNER, { channelId: CHANNEL_B, title: "B" });
  await stub.configureChannel(OWNER, { channelId: CHANNEL_C, title: "C" });
  await setChannelState(CHANNEL_A, { status: "available", availableAt: 10 });
  await setChannelState(CHANNEL_C, { status: "available", availableAt: 10 });
  await stub.deleteChannel(OWNER, CHANNEL_C);
  return stub;
}

describe("channel request routes", () => {
  it("submits by id or URL, refuses available channels and unknown ids, stores the feed title", async () => {
    await seedCatalog();

    const handle = await call(ALICE, "POST", "/channel-requests", {
      channelId: "https://www.youtube.com/@veritasium",
    });
    expect(handle.status).toBe(400);
    expect(String(handle.json.error)).toContain("Copy channel ID");

    const unknown = await call(ALICE, "POST", "/channel-requests", {
      channelId: CHANNEL_E,
    });
    expect(unknown.status).toBe(400);
    expect(String(unknown.json.error)).toContain("no YouTube channel");

    const available = await call(ALICE, "POST", "/channel-requests", {
      channelId: CHANNEL_A,
    });
    expect(available.status).toBe(409);
    expect(available.json).toEqual({
      error: expect.stringContaining("follow it instead"),
      code: "INVALID_STATE",
      channelId: CHANNEL_A,
    });

    const url = `https://www.youtube.com/channel/${CHANNEL_D}/videos`;
    const created = await call(ALICE, "POST", "/channel-requests", {
      channelId: ` ${url} `,
    });
    expectShape(ChannelRequestResponseSchema, created.json);
    expect(created.status).toBe(201);
    expect(created.json.request).toMatchObject({
      userEmail: ALICE,
      channelId: CHANNEL_D,
      channelTitle: "Feed D",
      submittedUrl: url,
      status: "pending",
      outcome: "awaiting_review",
      channel: { state: "not_in_catalog", failureCode: null },
    });

    // Pending and deleted channels may still be requested; the owner decides.
    expect(
      (await call(ALICE, "POST", "/channel-requests", { channelId: CHANNEL_B }))
        .status,
    ).toBe(201);
    expect(
      (await call(BOB, "POST", "/channel-requests", { channelId: CHANNEL_C }))
        .status,
    ).toBe(201);
    expect((await call(ALICE, "POST", "/channel-requests", {})).status).toBe(
      400,
    );
  });

  it("shows requesters their own requests and the owner everyone's", async () => {
    await seedCatalog();
    await call(ALICE, "POST", "/channel-requests", { channelId: CHANNEL_B });
    await call(BOB, "POST", "/channel-requests", { channelId: CHANNEL_D });

    const alice = await call(ALICE, "GET", "/channel-requests");
    expect(alice.json.requests).toEqual([
      expect.objectContaining({
        channelId: CHANNEL_B,
        channelTitle: "Feed B",
        outcome: "awaiting_review",
        channel: { state: "pending", failureCode: null },
      }),
    ]);
    const bob = await call(BOB, "GET", "/channel-requests");
    expect((bob.json.requests as Json[]).map((r) => r.channelId)).toEqual([
      CHANNEL_D,
    ]);

    expect(
      (await call(ALICE, "GET", "/channel-requests?scope=all")).status,
    ).toBe(403);
    const all = await call(OWNER, "GET", "/channel-requests?scope=all");
    expectShape(ChannelRequestsResponseSchema, all.json);
    expect(
      (all.json.requests as Json[]).map((r) => r.userEmail).sort(),
    ).toEqual([ALICE, BOB]);
    expect(
      (await call(OWNER, "GET", "/channel-requests")).json.requests,
    ).toEqual([]);
  });

  it("approves with the stored title, reuses the channel for later requesters, and rejects", async () => {
    await seedCatalog();
    const first = await call(ALICE, "POST", "/channel-requests", {
      channelId: CHANNEL_D,
    });
    const second = await call(BOB, "POST", "/channel-requests", {
      channelId: CHANNEL_D,
    });
    const firstId = (first.json.request as Json).requestId;
    const secondId = (second.json.request as Json).requestId;

    expect(
      (await call(ALICE, "POST", `/channel-requests/${firstId}/approve`))
        .status,
    ).toBe(403);

    // No body at all is a valid approval.
    const approved = await call(
      OWNER,
      "POST",
      `/channel-requests/${firstId}/approve`,
    );
    expectShape(ApproveChannelRequestResponseSchema, approved.json);
    expect(approved.status).toBe(200);
    expect(approved.json).toMatchObject({
      channelCreated: true,
      request: {
        status: "approved",
        outcome: "importing",
        reviewedByEmail: OWNER,
      },
      channel: {
        channelId: CHANNEL_D,
        title: "Feed D",
        status: "pending",
        management: { requesterCount: 2 },
      },
    });

    const reused = await call(
      OWNER,
      "POST",
      `/channel-requests/${secondId}/approve`,
      { explanation: " welcome ", title: "ignored: channel exists" },
    );
    expect(reused.json).toMatchObject({
      channelCreated: false,
      request: { ownerExplanation: "welcome" },
      channel: { title: "Feed D" },
    });

    // Outcomes follow the channel's state from here on.
    await setChannelState(CHANNEL_D, { status: "available", availableAt: 5 });
    const mine = await call(ALICE, "GET", "/channel-requests");
    expect((mine.json.requests as Json[])[0]).toMatchObject({
      outcome: "approved_pending_follow",
      channel: { state: "available" },
    });

    const third = await call(ALICE, "POST", "/channel-requests", {
      channelId: CHANNEL_B,
    });
    const thirdId = (third.json.request as Json).requestId;
    const rejected = await call(
      OWNER,
      "POST",
      `/channel-requests/${thirdId}/reject`,
      { explanation: "not now" },
    );
    expectShape(ChannelRequestResponseSchema, rejected.json);
    expect(rejected.status).toBe(200);
    expect(rejected.json.request).toMatchObject({
      status: "rejected",
      outcome: "rejected",
      ownerExplanation: "not now",
      channel: { state: "pending" },
    });
    expect(
      (await call(OWNER, "POST", `/channel-requests/${thirdId}/approve`))
        .status,
    ).toBe(409);
    expect(
      (await call(OWNER, "POST", "/channel-requests/nope/reject")).status,
    ).toBe(404);
  });

  it("refuses to approve a request whose channel is deleted", async () => {
    await seedCatalog();
    const forDeleted = await call(BOB, "POST", "/channel-requests", {
      channelId: CHANNEL_C,
    });
    const id = (forDeleted.json.request as Json).requestId;
    expect((forDeleted.json.request as Json).channel).toEqual({
      state: "deleted",
      failureCode: null,
    });

    const refused = await call(
      OWNER,
      "POST",
      `/channel-requests/${id}/approve`,
    );
    expect(refused.status).toBe(409);
    expect(String(refused.json.error)).toContain("restore it first");

    await call(OWNER, "POST", `/channels/${CHANNEL_C}/restore`);
    const approved = await call(
      OWNER,
      "POST",
      `/channel-requests/${id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.json).toMatchObject({
      channelCreated: false,
      request: { outcome: "approved_pending_follow" },
    });
  });
});
