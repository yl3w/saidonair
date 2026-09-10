import { SELF } from "cloudflare:test";
import {
  CatalogResponseSchema,
  ChannelResponseSchema,
  ChannelsResponseSchema,
  EpisodesResponseSchema,
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
  setChannelState,
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

/** A: available with two processed episodes and one failed; B: pending; C: deleted (was available). */
async function seedCatalog() {
  const stub = registry();
  await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A" });
  await stub.createChannel(OWNER, { channelId: CHANNEL_B, title: "B" });
  await stub.createChannel(OWNER, { channelId: CHANNEL_C, title: "C" });
  await setChannelState(CHANNEL_A, { status: "available", availableAt: 10 });
  await setChannelState(CHANNEL_C, { status: "available", availableAt: 10 });
  await stub.deleteChannel(OWNER, CHANNEL_C);
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
      ["POST", "/channels", { channelId: CHANNEL_D }],
      ["DELETE", `/channels/${CHANNEL_A}`],
      ["POST", `/channels/${CHANNEL_C}/restore`],
      ["GET", `/channels/${CHANNEL_A}/ingestion-runs`],
    ];
    for (const [method, path, body] of ownerOnly) {
      const { status, json } = await call(ALICE, method, path, body);
      expect(status, `${method} ${path}`).toBe(403);
      expect(json.code).toBe("NOT_OWNER");
    }

    const catalog = await call(OWNER, "GET", "/catalog");
    expectShape(CatalogResponseSchema, catalog.json);
    expect(catalog.status).toBe(200);
    expect(catalog.json.catalog).toMatchObject({
      channels: { available: 1, pending: 1, deleted: 1, stuckPending: 1 },
      episodes: { processed: 2, tracked: 3 },
    });

    expect((await call(ALICE, "GET", "/channels?scope=bogus")).status).toBe(
      400,
    );
  });

  it("lists available channels for readers and every state with management for the owner", async () => {
    await seedCatalog();
    await userDO(ALICE).follow(CHANNEL_A);

    const alice = await call(ALICE, "GET", "/channels");
    expectShape(ChannelsResponseSchema, alice.json);
    expect(alice.status).toBe(200);
    expect(alice.json.channels).toEqual([
      expect.objectContaining({
        channelId: CHANNEL_A,
        title: "A",
        available: true,
        following: true,
        processedCount: 2,
      }),
    ]);
    expect((alice.json.channels as Json[])[0]).not.toHaveProperty("management");

    const owner = await call(OWNER, "GET", "/channels?scope=all");
    expectShape(ChannelsResponseSchema, owner.json);
    const rows = owner.json.channels as Json[];
    expect(rows.map((row) => row.channelId).sort()).toEqual(
      [CHANNEL_A, CHANNEL_B, CHANNEL_C].sort(),
    );
    const b = rows.find((row) => row.channelId === CHANNEL_B);
    expect(b).toMatchObject({
      status: "pending",
      available: false,
      following: false,
      management: { stuckPending: true, latestRun: null },
    });
    const cRow = rows.find((row) => row.channelId === CHANNEL_C);
    expect(cRow).toMatchObject({
      available: false,
      deletedAt: expect.any(Number),
    });
  });

  it("shows one channel to readers only while available, and to the owner in any state", async () => {
    await seedCatalog();

    expect((await call(ALICE, "GET", `/channels/${CHANNEL_B}`)).status).toBe(
      404,
    );
    expect((await call(ALICE, "GET", `/channels/${CHANNEL_C}`)).status).toBe(
      404,
    );
    expect((await call(ALICE, "GET", `/channels/${CHANNEL_D}`)).status).toBe(
      404,
    );
    expect((await call(ALICE, "GET", "/channels/not-an-id")).status).toBe(400);

    const a = await call(ALICE, "GET", `/channels/${CHANNEL_A}`);
    expect(a.status).toBe(200);
    expect(a.json.channel).toMatchObject({
      channelId: CHANNEL_A,
      following: false,
      processedCount: 2,
    });
    expect(a.json.channel).not.toHaveProperty("management");

    const b = await call(OWNER, "GET", `/channels/${CHANNEL_B}`);
    expectShape(ChannelResponseSchema, b.json);
    expect(b.status).toBe(200);
    expect(b.json.channel).toMatchObject({
      status: "pending",
      management: { stuckPending: true, initialImportCount: 5 },
    });
  });

  it("creates a channel only for a real feed, once", async () => {
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
      status: "pending",
      management: { initialImportCount: 3, stuckPending: true },
    });

    const duplicate = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_D,
    });
    expect(duplicate.status).toBe(409);

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
          channelId: CHANNEL_A,
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

    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes?limit=0`))
        .status,
    ).toBe(400);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes?limit=x`))
        .status,
    ).toBe(400);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_B}/episodes`)).status,
    ).toBe(404);
    expect(
      (await call(OWNER, "GET", `/channels/${CHANNEL_B}/episodes`)).status,
    ).toBe(200);
  });

  it("deletes and restores through the channel entity", async () => {
    await seedCatalog();

    const deleted = await call(OWNER, "DELETE", `/channels/${CHANNEL_A}`);
    expect(deleted.status).toBe(200);
    expect((deleted.json.channel as Json).available).toBe(false);
    expect((await call(ALICE, "GET", `/channels/${CHANNEL_A}`)).status).toBe(
      404,
    );

    const restored = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/restore`,
    );
    expect((restored.json.channel as Json).available).toBe(true);
    expect((await call(ALICE, "GET", `/channels/${CHANNEL_A}`)).status).toBe(
      200,
    );
    expect((await call(OWNER, "DELETE", `/channels/${CHANNEL_D}`)).status).toBe(
      404,
    );
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
});
