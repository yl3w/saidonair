import { SELF } from "cloudflare:test";
import {
  DigestResponseSchema,
  FollowResponseSchema,
  FollowsResponseSchema,
} from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  expectShape,
  OWNER,
  registry,
  seedEpisode,
  seedSummary,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
} from "./helpers";

type Json = Record<string, unknown>;

async function call(
  email: string,
  method: string,
  path: string,
): Promise<{ status: number; json: Json }> {
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers: { "X-User-Email": email },
  });
  return { status: response.status, json: (await response.json()) as Json };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const VIDEO_D = "ddddddddddd";
const VIDEO_OLD = "olderolderx";

/**
 * A: approved, VIDEO_A (1h ago), VIDEO_B (3d ago), VIDEO_OLD (10d ago) processed with summaries,
 * VIDEO_C failed. B: approved, VIDEO_D (2h ago). C: requested. D: declined (was approved).
 */
async function seedCatalog(now: number) {
  const stub = registry();
  for (const [id, title] of [
    [CHANNEL_A, "A"],
    [CHANNEL_B, "B"],
    [CHANNEL_D, "D"],
  ] as const) {
    await stub.createChannel(OWNER, {
      channelId: id,
      title,
      status: "approved",
    });
  }
  await stub.createChannel(ALICE, {
    channelId: CHANNEL_C,
    title: "C",
    status: "requested",
  });
  await stub.declineChannel(OWNER, CHANNEL_D);

  await seedEpisode(VIDEO_A, CHANNEL_A, { publishedAt: now - HOUR });
  await seedSummary(VIDEO_A, { relatedVideoIds: [VIDEO_D, VIDEO_B] });
  await seedEpisode(VIDEO_B, CHANNEL_A, { publishedAt: now - 3 * DAY });
  await seedSummary(VIDEO_B);
  await seedEpisode(VIDEO_OLD, CHANNEL_A, { publishedAt: now - 10 * DAY });
  await seedSummary(VIDEO_OLD);
  await seedEpisode(VIDEO_C, CHANNEL_A, {
    publishedAt: now - 2 * HOUR,
    status: "failed",
  });
  await seedEpisode(VIDEO_D, CHANNEL_B, { publishedAt: now - 2 * HOUR });
  await seedSummary(VIDEO_D);
  return stub;
}

describe("follow routes", () => {
  it("refuses only declined channels and lists follows with counts, unread, and status", async () => {
    const now = Date.now();
    const stub = await seedCatalog(now);

    const followed = await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    expectShape(FollowResponseSchema, followed.json);
    expect(followed.status).toBe(200);
    expect(followed.json.follow).toMatchObject({
      channelId: CHANNEL_A,
      unfollowedAt: null,
      unreadCount: 3,
      channel: { following: true, status: "approved", processedCount: 3 },
    });
    expect((await call(ALICE, "PUT", `/follows/${CHANNEL_D}`)).status).toBe(
      409,
    );
    expect(
      (await call(ALICE, "PUT", "/follows/UCZZZZZZZZZZZZZZZZZZZZZZ")).status,
    ).toBe(404);
    expect((await call(ALICE, "PUT", "/follows/bad")).status).toBe(400);

    expect((await call(BOB, "GET", "/follows")).json.follows).toEqual([]);
    const list = await call(ALICE, "GET", "/follows");
    expectShape(FollowsResponseSchema, list.json);
    expect((list.json.follows as Json[]).map((f) => f.channelId)).toEqual([
      CHANNEL_A,
    ]);

    // Reading the channel's episodes records receipts, so unread drops to zero for Alice only.
    await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(
      ((await call(ALICE, "GET", "/follows")).json.follows as Json[])[0]
        ?.unreadCount,
    ).toBe(0);
    await call(BOB, "PUT", `/follows/${CHANNEL_A}`);
    expect(
      ((await call(BOB, "GET", "/follows")).json.follows as Json[])[0]
        ?.unreadCount,
    ).toBe(3);

    // Declining keeps the follow row and shows the note; approving again brings the reads back.
    await stub.declineChannel(OWNER, CHANNEL_A, { explanation: "withdrawn" });
    const declined = await call(ALICE, "GET", "/follows");
    expect((declined.json.follows as Json[])[0]).toMatchObject({
      channelId: CHANNEL_A,
      channel: { status: "declined", reviewNote: "withdrawn" },
    });
    await stub.approveChannel(OWNER, CHANNEL_A);
    const restored = await call(ALICE, "GET", "/follows");
    expect((restored.json.follows as Json[])[0]).toMatchObject({
      channel: { status: "approved" },
    });

    const unfollowed = await call(ALICE, "DELETE", `/follows/${CHANNEL_A}`);
    expect(unfollowed.status).toBe(200);
    expect((unfollowed.json.follow as Json).unfollowedAt).toEqual(
      expect.any(Number),
    );
    expect((unfollowed.json.follow as Json).channel).toMatchObject({
      following: false,
    });
    expect((await call(ALICE, "GET", "/follows")).json.follows).toEqual([]);
    expect((await call(ALICE, "DELETE", `/follows/${CHANNEL_A}`)).status).toBe(
      200,
    );
    expect((await call(ALICE, "DELETE", `/follows/${CHANNEL_B}`)).status).toBe(
      404,
    );
    // A channel awaiting review can be followed too; only a declined one is refused.
    expect((await call(ALICE, "PUT", `/follows/${CHANNEL_C}`)).status).toBe(
      200,
    );
    // Bob's follow is untouched by any of Alice's changes.
    expect((await call(BOB, "GET", "/follows")).json.follows).toHaveLength(1);
  });
});

describe("digest route", () => {
  it("returns eligible summaries in the window, newest first, marking them read for the caller", async () => {
    const now = Date.now();
    await seedCatalog(now);
    await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    await call(ALICE, "PUT", `/follows/${CHANNEL_B}`);
    await call(BOB, "PUT", `/follows/${CHANNEL_A}`);

    const first = await call(ALICE, "GET", "/digest");
    expectShape(DigestResponseSchema, first.json);
    expect(first.status).toBe(200);
    expect(first.json.since).toBeGreaterThan(now - DAY - 5_000);
    const episodes = first.json.episodes as Json[];
    expect(episodes.map((e) => e.videoId)).toEqual([VIDEO_A, VIDEO_D]);
    expect(episodes[0]).toMatchObject({
      channelTitle: "A",
      summary: { format: "structured" },
      wasUnread: true,
      // VIDEO_D is eligible for Alice (she follows B); VIDEO_B is outside the window but still related.
      related: [
        { videoId: VIDEO_D, title: `Episode ${VIDEO_D}` },
        { videoId: VIDEO_B, title: `Episode ${VIDEO_B}` },
      ],
    });
    expect(episodes[0]).not.toHaveProperty("processing");

    const second = await call(ALICE, "GET", "/digest");
    expect((second.json.episodes as Json[]).map((e) => e.wasUnread)).toEqual([
      false,
      false,
    ]);

    // Bob's receipts are his own, and he does not follow B.
    const bob = await call(BOB, "GET", "/digest");
    expect((bob.json.episodes as Json[]).map((e) => e.videoId)).toEqual([
      VIDEO_A,
    ]);
    expect((bob.json.episodes as Json[])[0]).toMatchObject({
      wasUnread: true,
      related: [{ videoId: VIDEO_B }],
    });
  });

  it("widens with ?since up to seven days, rejects garbage, and excludes declined channels", async () => {
    const now = Date.now();
    const stub = await seedCatalog(now);
    await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);

    const fourDays = new Date(now - 4 * DAY).toISOString();
    const widened = await call(ALICE, "GET", `/digest?since=${fourDays}`);
    expect((widened.json.episodes as Json[]).map((e) => e.videoId)).toEqual([
      VIDEO_A,
      VIDEO_B,
    ]);

    // Thirty days back is clamped to seven: the ten-day-old episode never appears.
    const month = new Date(now - 30 * DAY).toISOString();
    const clamped = await call(ALICE, "GET", `/digest?since=${month}`);
    expect((clamped.json.episodes as Json[]).map((e) => e.videoId)).toEqual([
      VIDEO_A,
      VIDEO_B,
    ]);
    expect(clamped.json.since).toBeGreaterThanOrEqual(now - 7 * DAY - 5_000);

    expect((await call(ALICE, "GET", "/digest?since=yesterday")).status).toBe(
      400,
    );

    await stub.declineChannel(OWNER, CHANNEL_A);
    expect((await call(ALICE, "GET", "/digest")).json.episodes).toEqual([]);
    expect((await call(BOB, "GET", "/digest")).json).toMatchObject({
      episodes: [],
    });
  });
});
