import { SELF } from "cloudflare:test";
import {
  ChannelDeclinedResponseSchema,
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
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  userDO,
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
 * A: approved, VIDEO_A (1h ago), VIDEO_B (3d ago), VIDEO_OLD (10d ago) available with summaries,
 * VIDEO_C failed. B: approved, VIDEO_D (2h ago). C: requested. D: declined (was approved).
 */
async function seedCatalog(now: number) {
  const stub = registry();
  for (const [id, title] of [
    [CHANNEL_A, "A"],
    [CHANNEL_B, "B"],
    [CHANNEL_D, "D"],
  ] as const) {
    await seedApprovedChannel(id, title);
  }
  await stub.createChannel({ channelId: CHANNEL_C, title: "C" });
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
      channel: {
        following: true,
        status: "approved",
        episodes: expect.objectContaining({ available: 3 }),
        followerCount: 1,
      },
    });
    const channelsAfterFollow = await call(ALICE, "GET", "/channels");
    expect(
      (channelsAfterFollow.json.channels as Json[]).find(
        (row) => row.channelId === CHANNEL_A,
      ),
    ).toMatchObject({ following: true, followerCount: 1 });

    // Alice is the only follower; unfollowing pauses the channel, and refollowing resumes it.
    // `paused` is the top-level boolean; the reason lives in `management`, present for everyone.
    const soleUnfollow = await call(ALICE, "DELETE", `/follows/${CHANNEL_A}`);
    expect(soleUnfollow.json.follow).toMatchObject({
      channel: {
        paused: true,
        followerCount: 0,
        management: { pausedBy: "system" },
      },
    });
    expect((soleUnfollow.json.follow as Json).channel).not.toHaveProperty(
      "pausedBy",
    );
    // One record of follows: `following` and `followerCount` come from the same rows and agree
    // in the same response (docs/specs/follows-single-owner.md §6.2).
    expect(
      ((await call(ALICE, "GET", "/channels")).json.channels as Json[]).find(
        (row) => row.channelId === CHANNEL_A,
      ),
    ).toMatchObject({ following: false, followerCount: 0 });
    expect(
      (await call(OWNER, "GET", `/channels/${CHANNEL_A}/followers`)).json,
    ).toEqual({ followers: [] });
    const soleRefollow = await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    expect(soleRefollow.json.follow).toMatchObject({
      channel: { paused: false, followerCount: 1 },
    });

    const declinedFollow = await call(ALICE, "PUT", `/follows/${CHANNEL_D}`);
    expect(declinedFollow.status).toBe(409);
    expectShape(ChannelDeclinedResponseSchema, declinedFollow.json);
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

    // Reading records nothing; marking the three summaries done drops unread to zero for Alice only.
    await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(
      ((await call(ALICE, "GET", "/follows")).json.follows as Json[])[0]
        ?.unreadCount,
    ).toBe(3);
    for (const videoId of [VIDEO_A, VIDEO_B, VIDEO_OLD]) {
      await call(
        ALICE,
        "POST",
        `/channels/${CHANNEL_A}/episodes/${videoId}/read`,
      );
    }
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
    // Unread counts eligible episodes only, so Bob's three unread summaries read zero while the
    // channel is declined, and count again once it is approved (spec §4).
    const declinedForBob = await call(BOB, "GET", "/follows");
    expect((declinedForBob.json.follows as Json[])[0]).toMatchObject({
      channelId: CHANNEL_A,
      unreadCount: 0,
    });
    await stub.approveChannel(OWNER, CHANNEL_A);
    expect(
      ((await call(BOB, "GET", "/follows")).json.follows as Json[])[0]
        ?.unreadCount,
    ).toBe(3);
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
  it("returns eligible summaries in the window, newest first, recording nothing", async () => {
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
      read: false,
      // VIDEO_D is eligible for Alice (she follows B); VIDEO_B is outside the window but still related.
      related: [
        { videoId: VIDEO_D, title: `Episode ${VIDEO_D}` },
        { videoId: VIDEO_B, title: `Episode ${VIDEO_B}` },
      ],
    });
    expect(episodes[0]).toHaveProperty("processing");

    // The digest is a pure read (docs/PRD.md §4.4): a second fetch still says unread, and only the
    // explicit write marks one done.
    const second = await call(ALICE, "GET", "/digest");
    expect((second.json.episodes as Json[]).map((e) => e.read)).toEqual([
      false,
      false,
    ]);
    expect(await userDO(ALICE).readVideoIds([VIDEO_A, VIDEO_D])).toEqual([]);
    await call(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${VIDEO_A}/read`,
    );
    expect(
      ((await call(ALICE, "GET", "/digest")).json.episodes as Json[]).map(
        (e) => e.read,
      ),
    ).toEqual([true, false]);

    // Bob's receipts are his own, and he does not follow B.
    const bob = await call(BOB, "GET", "/digest");
    expect((bob.json.episodes as Json[]).map((e) => e.videoId)).toEqual([
      VIDEO_A,
    ]);
    expect((bob.json.episodes as Json[])[0]).toMatchObject({
      read: false,
      related: [{ videoId: VIDEO_B }],
    });

    // A paused channel is still eligible: its existing summaries stay readable (spec §3.2).
    await registry().pauseChannel(CHANNEL_A);
    const paused = await call(BOB, "GET", "/digest");
    expect((paused.json.episodes as Json[]).map((e) => e.videoId)).toEqual([
      VIDEO_A,
    ]);
    expect((paused.json.episodes as Json[])[0]).toMatchObject({
      summary: { format: "structured" },
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
