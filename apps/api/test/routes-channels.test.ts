import { SELF } from "cloudflare:test";
import {
  CatalogResponseSchema,
  ChannelDeclinedResponseSchema,
  ChannelResponseSchema,
  ChannelsResponseSchema,
  EpisodeResponseSchema,
  EpisodesResponseSchema,
  FollowersResponseSchema,
  IngestionRunsResponseSchema,
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
  seedEpisode,
  seedRun,
  seedSummary,
  userDO,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
} from "./helpers";

type Json = Record<string, unknown>;

/** An extra 11-character video id, for the skipped episode seeded mid-test. */
const VIDEO_SKIPPED = "sssssssssss";

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

// Feeds come from the YOUTUBE_FEEDS_FAKE binding in vitest.config.ts: CHANNEL_A…D have titles
// "Feed A"…"Feed D"; CHANNEL_E answers 404 like an unknown id. Nothing here reaches YouTube.

/** A: approved with two available episodes and one failed; B: requested; C: declined (was approved). */
async function seedCatalog() {
  const stub = registry();
  await stub.createChannel(OWNER, {
    channelId: CHANNEL_A,
    title: "A",
    status: "approved",
  });
  await stub.createChannel(ALICE, {
    channelId: CHANNEL_B,
    title: "B",
    status: "requested",
  });
  await stub.createChannel(OWNER, {
    channelId: CHANNEL_C,
    title: "C",
    status: "approved",
  });
  await stub.declineChannel(OWNER, CHANNEL_C);
  // The owner's add pauses a channel nobody follows yet (Ruling R4); these fixtures want A running.
  await stub.resumeChannel(OWNER, CHANNEL_A);
  await seedEpisode(VIDEO_A, CHANNEL_A, { publishedAt: 3_000 });
  await seedSummary(VIDEO_A, { relatedVideoIds: [VIDEO_B] });
  await seedEpisode(VIDEO_B, CHANNEL_A, { publishedAt: 2_000 });
  await seedSummary(VIDEO_B);
  await seedEpisode(VIDEO_C, CHANNEL_A, {
    publishedAt: 1_000,
    status: "failed",
  });
  return stub;
}

describe("channel and catalog routes", () => {
  it("refuses owner-only operations for users and accepts them for the owner", async () => {
    await seedCatalog();
    const ownerOnly: [string, string, unknown?][] = [
      ["GET", "/catalog"],
      ["GET", "/channels?scope=all"],
      ["GET", `/channels/${CHANNEL_A}/ingestion-runs`],
      ["GET", `/channels/${CHANNEL_A}/followers`],
      ["POST", `/channels/${CHANNEL_A}/episodes/${VIDEO_C}/retry`],
      ["POST", `/channels/${CHANNEL_A}/episodes/${VIDEO_C}/skip`],
    ];
    for (const [method, path, body] of ownerOnly) {
      const { status, json } = await call(ALICE, method, path, body);
      expect(status, `${method} ${path}`).toBe(403);
      expect(json.code).toBe("NOT_OWNER");
    }

    const followers = await call(
      OWNER,
      "GET",
      `/channels/${CHANNEL_A}/followers`,
    );
    expect(followers.status).toBe(200);
    expectShape(FollowersResponseSchema, followers.json);
    expect(followers.json.followers).toEqual([]);

    const catalog = await call(OWNER, "GET", "/catalog");
    expectShape(CatalogResponseSchema, catalog.json);
    expect(catalog.status).toBe(200);
    expect(catalog.json.catalog).toMatchObject({
      channels: { requested: 1, approved: 1, paused: 0, declined: 1 },
      episodes: { available: 2, pending: 0, waiting: 0, failed: 1, skipped: 0 },
      attention: { failedEpisodes: 1, neverStarted: 1, requested: 1 },
    });

    expect((await call(ALICE, "GET", "/channels?scope=bogus")).status).toBe(
      400,
    );
  });

  it("lists requested and approved channels for readers and every status with management for the owner", async () => {
    await seedCatalog();
    await userDO(ALICE).follow(CHANNEL_A);

    const alice = await call(ALICE, "GET", "/channels");
    expectShape(ChannelsResponseSchema, alice.json);
    expect(alice.status).toBe(200);
    const aliceRows = alice.json.channels as Json[];
    expect(aliceRows.map((row) => row.channelId)).toEqual([
      CHANNEL_A,
      CHANNEL_B,
    ]);
    expect(aliceRows[0]).toMatchObject({
      channelId: CHANNEL_A,
      title: "A",
      status: "approved",
      paused: false,
      following: true,
      episodes: expect.objectContaining({ available: 2 }),
    });
    expect(aliceRows[0]).not.toHaveProperty("management");

    const owner = await call(OWNER, "GET", "/channels?scope=all");
    expectShape(ChannelsResponseSchema, owner.json);
    const rows = owner.json.channels as Json[];
    expect(rows.map((row) => row.channelId).sort()).toEqual(
      [CHANNEL_A, CHANNEL_B, CHANNEL_C].sort(),
    );
    const b = rows.find((row) => row.channelId === CHANNEL_B);
    expect(b).toMatchObject({
      status: "requested",
      approvedAt: null,
      following: false,
      management: { neverStarted: false, latestRun: null },
    });
    const cRow = rows.find((row) => row.channelId === CHANNEL_C);
    expect(cRow).toMatchObject({
      status: "declined",
      approvedAt: expect.any(Number),
      management: { reviewedByEmail: OWNER },
    });
  });

  it("shows one channel to every caller in any status, and adds management for the owner", async () => {
    await seedCatalog();

    const requested = await call(ALICE, "GET", `/channels/${CHANNEL_B}`);
    expect(requested.status).toBe(200);
    expect(requested.json.channel).toMatchObject({ status: "requested" });
    expect(requested.json.channel).not.toHaveProperty("management");
    expect(
      (
        (await call(ALICE, "GET", `/channels/${CHANNEL_C}`)).json
          .channel as Json
      ).status,
    ).toBe("declined");
    expect((await call(ALICE, "GET", `/channels/${CHANNEL_D}`)).status).toBe(
      404,
    );
    expect((await call(ALICE, "GET", "/channels/not-an-id")).status).toBe(400);

    const a = await call(ALICE, "GET", `/channels/${CHANNEL_A}`);
    expect(a.status).toBe(200);
    expect(a.json.channel).toMatchObject({
      channelId: CHANNEL_A,
      following: false,
      episodes: expect.objectContaining({ available: 2 }),
    });
    expect(a.json.channel).not.toHaveProperty("management");

    const b = await call(OWNER, "GET", `/channels/${CHANNEL_B}`);
    expectShape(ChannelResponseSchema, b.json);
    expect(b.status).toBe(200);
    expect(b.json.channel).toMatchObject({
      status: "requested",
      management: { neverStarted: false, initialImportCount: 5 },
    });
  });

  it("creates a channel only for a real feed; an existing one is followed instead of duplicated", async () => {
    const handle = await call(OWNER, "POST", "/channels", {
      channelId: "@veritasium",
    });
    expect(handle.status).toBe(400);
    expect(String(handle.json.error)).toContain("Copy channel ID");

    const missing = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_E,
    });
    expect(missing.status).toBe(400);
    expect(String(missing.json.error)).toContain("no YouTube channel");

    const created = await call(OWNER, "POST", "/channels", {
      channelId: `https://www.youtube.com/channel/${CHANNEL_D}`,
      initialImportCount: 3,
    });
    expect(created.status).toBe(201);
    expect(created.json.channel).toMatchObject({
      channelId: CHANNEL_D,
      title: "Feed D",
      status: "approved",
      management: { initialImportCount: 3, neverStarted: true },
    });

    // Anyone else's add is a request awaiting review, without the owner's block.
    const requested = await call(ALICE, "POST", "/channels", {
      channelId: CHANNEL_A,
    });
    expect(requested.status).toBe(201);
    expectShape(ChannelResponseSchema, requested.json);
    expect(requested.json.channel).toMatchObject({
      channelId: CHANNEL_A,
      title: "Feed A",
      status: "requested",
      following: true,
      episodes: expect.objectContaining({ available: 0 }),
    });
    expect(requested.json.channel).not.toHaveProperty("management");

    // An id already in the catalog is simply followed again, not refused.
    const duplicate = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_D,
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.json.channel).toMatchObject({ following: true });

    // Optional text is omitted or non-blank; a blank never falls back to the feed title (owner decision 2026-09-08).
    const blank = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_B,
      title: "",
    });
    expect(blank.status).toBe(400);
    expect(String(blank.json.error)).toContain(
      "title must be omitted or non-blank",
    );
    const nulled = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_B,
      title: null,
    });
    expect(nulled.status).toBe(400);
    expect(String(nulled.json.error)).toContain("title");

    const titled = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_B,
      title: "  Given  ",
    });
    expect(titled.status).toBe(201);
    expect((titled.json.channel as Json).title).toBe("Given");

    const unnamed = await call(OWNER, "POST", "/channels", { nope: 1 });
    expect(unnamed.status).toBe(400);
    expect(unnamed.json).toMatchObject({ code: "INVALID_INPUT" });
    expect(String(unnamed.json.error)).toContain("channelId");

    // Not JSON at all: Hono's validator raises an HTTPException that must keep this API's 400 shape.
    const malformed = await SELF.fetch("http://api/channels", {
      method: "POST",
      headers: { "X-User-Email": OWNER, "Content-Type": "application/json" },
      body: "not json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(
      (
        await call(OWNER, "POST", "/channels", {
          channelId: CHANNEL_C,
          initialImportCount: 0,
        })
      ).status,
    ).toBe(400);
  });

  it("serves episodes with follower-dependent detail and records receipts for the caller only", async () => {
    await seedCatalog();
    await userDO(ALICE).follow(CHANNEL_A);

    const bob = await call(BOB, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(bob.status).toBe(200);
    const bobEpisodes = bob.json.episodes as Json[];
    expect(bobEpisodes.map((e) => e.videoId)).toEqual([
      VIDEO_A,
      VIDEO_B,
      VIDEO_C,
    ]);
    for (const episode of bobEpisodes) {
      expect(episode.summary).toBeNull();
      expect(episode.related).toEqual([]);
      expect(episode).not.toHaveProperty("wasUnread");
      expect(episode).not.toHaveProperty("processing");
    }

    const first = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/episodes?limit=2`,
    );
    const firstEpisodes = first.json.episodes as Json[];
    expect(firstEpisodes).toHaveLength(2);
    expect(firstEpisodes[0]).toMatchObject({
      videoId: VIDEO_A,
      summary: { format: "structured" },
      related: [{ videoId: VIDEO_B, title: `Episode ${VIDEO_B}` }],
      wasUnread: true,
    });
    expect(firstEpisodes[0]).not.toHaveProperty("processing");

    const second = await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    const secondEpisodes = second.json.episodes as Json[];
    expect(secondEpisodes.map((e) => e.wasUnread)).toEqual([
      false,
      false,
      undefined,
    ]);

    // Bob's receipts are his own: following now, everything is still new to him.
    await userDO(BOB).follow(CHANNEL_A);
    const bobAgain = await call(BOB, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect((bobAgain.json.episodes as Json[]).map((e) => e.wasUnread)).toEqual([
      true,
      true,
      undefined,
    ]);

    const owner = await call(OWNER, "GET", `/channels/${CHANNEL_A}/episodes`);
    expectShape(EpisodesResponseSchema, owner.json);
    const ownerEpisodes = owner.json.episodes as Json[];
    expect(ownerEpisodes[2]).toMatchObject({
      status: "failed",
      summary: null,
      processing: { attemptCount: 1, chunkCount: null },
    });
    // Related titles follow the caller's eligible channels; the owner follows nothing.
    expect(ownerEpisodes[0]?.related).toEqual([]);

    // A skipped episode tells every reader why there is no summary, while the rest of the
    // processing detail stays owner-only (Ruling R15).
    await seedEpisode(VIDEO_SKIPPED, CHANNEL_A, {
      publishedAt: 500,
      status: "skipped",
      skipReason: "NO_CAPTIONS",
    });
    const withSkipped = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/episodes`,
    );
    const skippedEpisode = (withSkipped.json.episodes as Json[]).at(-1);
    expect(skippedEpisode).toMatchObject({
      videoId: VIDEO_SKIPPED,
      status: "skipped",
      skipReason: "NO_CAPTIONS",
      summary: null,
    });
    expect(skippedEpisode).not.toHaveProperty("processing");

    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes?limit=0`))
        .status,
    ).toBe(400);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes?limit=x`))
        .status,
    ).toBe(400);
    // A requested channel simply has no episodes to show yet.
    const requested = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_B}/episodes`,
    );
    expect(requested.status).toBe(200);
    expect(requested.json.episodes).toEqual([]);
    expect(
      (await call(OWNER, "GET", `/channels/${CHANNEL_B}/episodes`)).status,
    ).toBe(200);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_D}/episodes`)).status,
    ).toBe(404);
  });

  it("gives a follower of a declined channel titles only", async () => {
    const stub = await seedCatalog();
    await userDO(ALICE).follow(CHANNEL_A);
    await stub.declineChannel(OWNER, CHANNEL_A, { explanation: "withdrawn" });

    const alice = await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(alice.status).toBe(200);
    for (const episode of alice.json.episodes as Json[]) {
      expect(episode.summary).toBeNull();
      expect(episode).not.toHaveProperty("wasUnread");
    }
  });

  it("exposes ingestion runs as a channel sub-resource for the owner", async () => {
    await seedCatalog();
    await seedRun(CHANNEL_A, {
      kind: "scheduled",
      status: "completed",
      finishedAt: 5,
    });

    const runs = await call(
      OWNER,
      "GET",
      `/channels/${CHANNEL_A}/ingestion-runs`,
    );
    expectShape(IngestionRunsResponseSchema, runs.json);
    expect(runs.status).toBe(200);
    expect(runs.json.runs).toEqual([
      expect.objectContaining({
        kind: "scheduled",
        status: "completed",
        episodes: [],
      }),
    ]);
    expect(
      (await call(OWNER, "GET", `/channels/${CHANNEL_D}/ingestion-runs`))
        .status,
    ).toBe(404);
  });

  it("the owner skips a failed episode, then retries it back to pending, and a run in flight refuses the retry", async () => {
    await seedCatalog();

    const skip = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${VIDEO_C}/skip`,
    );
    expect(skip.status).toBe(200);
    expectShape(EpisodeResponseSchema, skip.json);
    const skipped = skip.json.episode as Json;
    expect(skipped.status).toBe("skipped");
    expect((skipped.processing as Json).skipReason).toBe("OWNER");

    const retry = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${VIDEO_C}/retry`,
    );
    expect(retry.status).toBe(200);
    expectShape(EpisodeResponseSchema, retry.json);
    const retried = retry.json.episode as Json;
    expect(retried.status).toBe("pending");
    expect((retried.processing as Json).attemptCount).toBe(0);

    await seedRun(CHANNEL_A, { status: "queued" });
    const blocked = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${VIDEO_C}/retry`,
    );
    expect(blocked.status).toBe(409);
  });

  it("a user's add creates a requested channel and follows them; an existing one is followed; a declined one is 409 with the note", async () => {
    const created = await call(ALICE, "POST", "/channels", {
      channelId: `https://www.youtube.com/channel/${CHANNEL_A}`,
    });
    expect(created.status).toBe(201);
    expectShape(ChannelResponseSchema, created.json);
    expect(created.json.channel).toMatchObject({
      channelId: CHANNEL_A,
      title: "Feed A",
      status: "requested",
      following: true,
      followerCount: 1,
    });
    expect(await userDO(ALICE).activeChannelIds()).toEqual([CHANNEL_A]);

    const existing = await call(BOB, "POST", "/channels", {
      channelId: CHANNEL_A,
    });
    expect(existing.status).toBe(200);
    expect(existing.json.channel).toMatchObject({
      following: true,
      followerCount: 2,
    });

    await registry().declineChannel(OWNER, CHANNEL_A, {
      explanation: "not now",
    });
    const declined = await call(BOB, "POST", "/channels", {
      channelId: CHANNEL_A,
    });
    expect(declined.status).toBe(409);
    expectShape(ChannelDeclinedResponseSchema, declined.json);
    expect(declined.json).toMatchObject({
      status: "declined",
      reviewNote: "not now",
    });

    const again = await call(BOB, "POST", `/channels/${CHANNEL_A}/request`);
    expect(again.status).toBe(200);
    expect(again.json.channel).toMatchObject({
      status: "requested",
      reviewNote: "not now",
      following: true,
    });

    expect(
      (await call(ALICE, "POST", "/channels", { channelId: "@handle" })).status,
    ).toBe(400);
    expect(
      (await call(ALICE, "POST", "/channels", { channelId: CHANNEL_E })).status,
    ).toBe(400);
  });

  it("the owner approves, declines, pauses, and resumes; users may not", async () => {
    await call(ALICE, "POST", "/channels", { channelId: CHANNEL_A });
    for (const action of ["approve", "decline", "pause", "resume"]) {
      const { status } = await call(
        ALICE,
        "POST",
        `/channels/${CHANNEL_A}/${action}`,
        {},
      );
      expect(status, action).toBe(403);
    }
    const approved = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/approve`,
      {
        title: "Renamed",
        explanation: "welcome",
      },
    );
    expect(approved.status).toBe(200);
    expect(approved.json.channel).toMatchObject({
      status: "approved",
      title: "Renamed",
      reviewNote: "welcome",
      paused: false,
    });
    // `pausedBy` is owner-only: readers get the `paused` boolean, the owner the reason (R14).
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_A}/pause`, {})).json
        .channel,
    ).toMatchObject({ paused: true, management: { pausedBy: "owner" } });
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_A}/resume`, {})).json
        .channel,
    ).toMatchObject({ paused: false, management: { pausedBy: null } });
    const declined = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/decline`,
      {
        explanation: "withdrawn",
      },
    );
    expect(declined.json.channel).toMatchObject({
      status: "declined",
      reviewNote: "withdrawn",
    });
    expect((declined.json.channel as Json).management).toMatchObject({
      lifecycleVersion: 2,
    });
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_A}/pause`, {})).status,
    ).toBe(409);
    const owned = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_B,
    });
    expect(owned.status).toBe(201);
    expect(owned.json.channel).toMatchObject({
      status: "approved",
      following: true,
    });
  });
});
