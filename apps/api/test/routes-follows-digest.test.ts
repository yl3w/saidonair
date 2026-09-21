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
  approveAs,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  declineAs,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  expectShape,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  signedIn,
  userDO,
} from "./helpers";

type Json = Record<string, unknown>;

async function call(
  email: string,
  method: string,
  path: string,
): Promise<{ status: number; json: Json }> {
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers: await signedIn(email),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EPISODE_D = "ddddddddddd";
const EPISODE_OLD = "olderolderx";

/**
 * A: approved, EPISODE_A (1h ago), EPISODE_B (3d ago), EPISODE_OLD (10d ago) available with summaries,
 * EPISODE_C failed. B: approved, EPISODE_D (2h ago). C: requested. D: declined (was approved).
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
  await declineAs(OWNER, CHANNEL_D);

  await seedEpisode(EPISODE_A, CHANNEL_A, { publishedAt: now - HOUR });
  await seedSummary(EPISODE_A, { relatedEpisodeIds: [EPISODE_D, EPISODE_B] });
  await seedEpisode(EPISODE_B, CHANNEL_A, { publishedAt: now - 3 * DAY });
  await seedSummary(EPISODE_B);
  await seedEpisode(EPISODE_OLD, CHANNEL_A, { publishedAt: now - 10 * DAY });
  await seedSummary(EPISODE_OLD);
  await seedEpisode(EPISODE_C, CHANNEL_A, {
    publishedAt: now - 2 * HOUR,
    status: "failed",
  });
  await seedEpisode(EPISODE_D, CHANNEL_B, { publishedAt: now - 2 * HOUR });
  await seedSummary(EPISODE_D);
  return stub;
}

describe("follow routes", () => {
  it("refuses only declined channels and lists follows with counts, unread, and status", async () => {
    const now = Date.now();
    await seedCatalog(now);

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
    for (const episodeId of [EPISODE_A, EPISODE_B, EPISODE_OLD]) {
      await call(
        ALICE,
        "POST",
        `/channels/${CHANNEL_A}/episodes/${episodeId}/read`,
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
    await declineAs(OWNER, CHANNEL_A, { explanation: "withdrawn" });
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
    await approveAs(OWNER, CHANNEL_A);
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
  it("returns eligible summaries newest availability first, with no window, recording nothing", async () => {
    const now = Date.now();
    await seedCatalog(now);
    await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    await call(ALICE, "PUT", `/follows/${CHANNEL_B}`);
    await call(BOB, "PUT", `/follows/${CHANNEL_A}`);

    // No `from`, no `to`: every day is kept, so the ten-day-old summary is in the answer. The
    // 24-hour default and the seven-day clamp are gone (docs/PRD.md §4.4, decided 2026-09-14).
    const first = await call(ALICE, "GET", "/digest");
    expectShape(DigestResponseSchema, first.json);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ compact: false, nextCursor: null });
    const episodes = first.json.episodes as Json[];
    expect(episodes.map((e) => e.episodeId)).toEqual([
      EPISODE_A,
      EPISODE_D,
      EPISODE_B,
      EPISODE_OLD,
    ]);
    expect(episodes[0]).toMatchObject({
      channelTitle: "A",
      summary: { format: "structured" },
      read: false,
      // EPISODE_D is eligible for Alice (she follows B); both related titles are in her scope.
      related: [
        { episodeId: EPISODE_D, title: `Episode ${EPISODE_D}` },
        { episodeId: EPISODE_B, title: `Episode ${EPISODE_B}` },
      ],
    });
    expect(episodes[0]).toHaveProperty("processing");

    // The digest is a pure read (docs/PRD.md §4.4): a second fetch still says unread, and only the
    // explicit write marks one done.
    const second = await call(ALICE, "GET", "/digest");
    expect((second.json.episodes as Json[]).map((e) => e.read)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(
      await (await userDO(ALICE)).readEpisodeIds([EPISODE_A, EPISODE_D]),
    ).toEqual([]);
    await call(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );
    expect(
      ((await call(ALICE, "GET", "/digest")).json.episodes as Json[]).map(
        (e) => e.read,
      ),
    ).toEqual([true, false, false, false]);

    // Bob's receipts are his own, and he does not follow B.
    const bob = await call(BOB, "GET", "/digest");
    expect((bob.json.episodes as Json[]).map((e) => e.episodeId)).toEqual([
      EPISODE_A,
      EPISODE_B,
      EPISODE_OLD,
    ]);
    expect((bob.json.episodes as Json[])[0]).toMatchObject({
      read: false,
      related: [{ episodeId: EPISODE_B }],
    });

    // A paused channel is still eligible: its existing summaries stay readable (spec §3.2).
    await registry().pauseChannel(CHANNEL_A);
    expect(
      ((await call(BOB, "GET", "/digest")).json.episodes as Json[])[0],
    ).toMatchObject({
      episodeId: EPISODE_A,
      summary: { format: "structured" },
    });
  });

  it("bounds the range, filters unread and by channel, pages by cursor, and answers compact rows", async () => {
    const now = Date.now();
    await seedCatalog(now);
    await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    await call(ALICE, "PUT", `/follows/${CHANNEL_B}`);
    const ids = async (query: string) =>
      (
        (await call(ALICE, "GET", `/digest${query}`)).json.episodes as Json[]
      ).map((e) => e.episodeId);
    const iso = (at: number) => encodeURIComponent(new Date(at).toISOString());

    // `from` is inclusive and `to` exclusive: one day of History is one half-open range.
    expect(await ids(`?from=${iso(now - 4 * DAY)}`)).toEqual([
      EPISODE_A,
      EPISODE_D,
      EPISODE_B,
    ]);
    expect(
      await ids(`?from=${iso(now - 4 * DAY)}&to=${iso(now - 2 * HOUR)}`),
    ).toEqual([EPISODE_B]);
    expect(await ids(`?to=${iso(now - 2 * HOUR)}`)).toEqual([
      EPISODE_B,
      EPISODE_OLD,
    ]);

    // The queue is the same range with a receipt filter; History is the range without one.
    await call(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );
    expect(await ids("?unread=true")).toEqual([
      EPISODE_D,
      EPISODE_B,
      EPISODE_OLD,
    ]);
    expect(await ids("?unread=false")).toHaveLength(4);
    await call(
      ALICE,
      "DELETE",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );
    expect(await ids("?unread=true")).toHaveLength(4);

    // Nothing waiting is an empty page that ends, not a cursor the client chases.
    for (const [channelId, episodeId] of [
      [CHANNEL_A, EPISODE_A],
      [CHANNEL_A, EPISODE_B],
      [CHANNEL_A, EPISODE_OLD],
      [CHANNEL_B, EPISODE_D],
    ] as const) {
      await call(
        ALICE,
        "POST",
        `/channels/${channelId}/episodes/${episodeId}/read`,
      );
    }
    expect((await call(ALICE, "GET", "/digest?unread=true")).json).toEqual({
      compact: false,
      episodes: [],
      nextCursor: null,
    });
    for (const [channelId, episodeId] of [
      [CHANNEL_A, EPISODE_A],
      [CHANNEL_A, EPISODE_B],
      [CHANNEL_A, EPISODE_OLD],
      [CHANNEL_B, EPISODE_D],
    ] as const) {
      await call(
        ALICE,
        "DELETE",
        `/channels/${channelId}/episodes/${episodeId}/read`,
      );
    }

    // `channelId` repeats, and an id the caller is not eligible for simply matches nothing.
    expect(await ids(`?channelId=${CHANNEL_B}`)).toEqual([EPISODE_D]);
    expect(
      await ids(`?channelId=${CHANNEL_A}&channelId=${CHANNEL_B}`),
    ).toHaveLength(4);
    expect(await ids(`?channelId=${CHANNEL_D}`)).toEqual([]);

    // A cursor walks the range without overlap or gap, and the last page says there is no more.
    const walked: unknown[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const response = await call(ALICE, "GET", `/digest${query}`);
      walked.push(
        ...(response.json.episodes as Json[]).map((e) => e.episodeId),
      );
      cursor = response.json.nextCursor as string | null;
      pages++;
    } while (cursor !== null && pages < 5);
    expect(pages).toBe(2);
    expect(walked).toEqual([EPISODE_A, EPISODE_D, EPISODE_B, EPISODE_OLD]);

    // `compact` answers the same page as rows: the day, the channel, the receipt, nothing else.
    const compact = await call(ALICE, "GET", "/digest?compact=true&limit=1");
    expectShape(DigestResponseSchema, compact.json);
    expect(compact.json).toMatchObject({ compact: true });
    expect(compact.json).not.toHaveProperty("episodes");
    expect(compact.json.rows).toEqual([
      {
        episodeId: EPISODE_A,
        channelId: CHANNEL_A,
        summaryAvailableAt: expect.any(Number),
        read: false,
      },
    ]);
    expect(compact.json.nextCursor).toEqual(expect.any(String));

    // Both ends of the page size have to be servable. A page asks the Registry for one row more
    // than it needs so the end of the range is visible without a second request — and at the
    // documented ceiling there is no room for that extra row, which is what made `limit=200`
    // answer 400 for a day (fixed 2026-09-15).
    for (const size of [1, 199, 200]) {
      const page = await call(ALICE, "GET", `/digest?limit=${size}`);
      expect(page.status, `limit=${size}`).toBe(200);
      expect(
        (await call(ALICE, "GET", `/digest?compact=true&limit=${size}`)).status,
        `compact limit=${size}`,
      ).toBe(200);
    }
    // At the ceiling, a range that fits inside one page still says it is finished.
    const ceiling = await call(ALICE, "GET", "/digest?limit=200");
    expect(ceiling.json.nextCursor).toBeNull();
    expect((ceiling.json.episodes as Json[]).length).toBe(4);
    // A page of one walks the whole range and stops, rather than looping on its own cursor.
    const single: unknown[] = [];
    let step: string | null = null;
    for (let read = 0; read < 6; read++) {
      const query: string = `?limit=1${step === null ? "" : `&cursor=${encodeURIComponent(step)}`}`;
      const answer = await call(ALICE, "GET", `/digest${query}`);
      single.push(...(answer.json.episodes as Json[]).map((e) => e.episodeId));
      step = answer.json.nextCursor as string | null;
      if (step === null) break;
    }
    expect(single).toEqual([EPISODE_A, EPISODE_D, EPISODE_B, EPISODE_OLD]);

    // Input the route cannot page or bound is refused rather than silently widened.
    for (const query of [
      "?from=yesterday",
      "?to=whenever",
      `?from=${iso(now)}&to=${iso(now - DAY)}`,
      `?from=${iso(now)}&to=${iso(now)}`,
      "?limit=0",
      "?limit=201",
      "?limit=x",
      "?cursor=not-a-position",
      "?unread=maybe",
    ]) {
      expect((await call(ALICE, "GET", `/digest${query}`)).status, query).toBe(
        400,
      );
    }

    // A declined channel leaves every past day, and a caller with nothing eligible gets an
    // empty page of the shape they asked for.
    await declineAs(OWNER, CHANNEL_A);
    expect(await ids("")).toEqual([EPISODE_D]);
    expect((await call(BOB, "GET", "/digest")).json).toEqual({
      compact: false,
      episodes: [],
      nextCursor: null,
    });
    expect((await call(BOB, "GET", "/digest?compact=true")).json).toEqual({
      compact: true,
      rows: [],
      nextCursor: null,
    });
  });

  it("keeps a receipt through unfollow, so a refollowed day reads as it did", async () => {
    const now = Date.now();
    await seedCatalog(now);
    await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    await call(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );

    // Unfollowing removes the channel's rows from every past day (docs/PRD.md §4.4)...
    await call(ALICE, "DELETE", `/follows/${CHANNEL_A}`);
    expect((await call(ALICE, "GET", "/digest")).json.episodes).toEqual([]);

    // ...and refollowing restores them along with the receipts they had.
    await call(ALICE, "PUT", `/follows/${CHANNEL_A}`);
    const restored = (await call(ALICE, "GET", "/digest")).json
      .episodes as Json[];
    expect(restored.map((e) => [e.episodeId, e.read])).toEqual([
      [EPISODE_A, true],
      [EPISODE_B, false],
      [EPISODE_OLD, false],
    ]);
  });
});
