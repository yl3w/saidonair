import { SELF } from "cloudflare:test";
import {
  CatalogResponseSchema,
  ChannelDeclinedResponseSchema,
  ChannelFeedResponseSchema,
  ChannelResponseSchema,
  ChannelsResponseSchema,
  EpisodeResponseSchema,
  EpisodeRetryResponseSchema,
  EpisodesResponseSchema,
  FollowersResponseSchema,
  IngestionRunsResponseSchema,
} from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { CHANNEL_G, CHANNEL_H, FEED_H_LONG_FORM } from "./fixtures/feeds";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  CHANNEL_E,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  expectShape,
  OWNER,
  registry,
  seedApprovedChannel,
  seedAttempt,
  seedEpisode,
  seedRun,
  seedSummary,
  userDO,
} from "./helpers";

type Json = Record<string, unknown>;

/** An extra 11-character episode id, for the skipped episode seeded mid-test. */
const EPISODE_SKIPPED = "sssssssssss";

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
// "Feed A"…"Feed D"; CHANNEL_E answers 404 like an unknown id; CHANNEL_G's channel feed verifies
// while its long-form feed 404s. Nothing here reaches YouTube.

/** A: approved with two available episodes and one failed; B: requested; C: declined (was approved). */
async function seedCatalog() {
  const stub = registry();
  await seedApprovedChannel(CHANNEL_A, "A");
  await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
  await seedApprovedChannel(CHANNEL_C, "C");
  await stub.declineChannel(OWNER, CHANNEL_C);
  // Approval pauses a channel nobody follows yet (Ruling R4); these fixtures want A running.
  await stub.resumeChannel(CHANNEL_A);
  await seedEpisode(EPISODE_A, CHANNEL_A, { publishedAt: 3_000 });
  await seedSummary(EPISODE_A, { relatedEpisodeIds: [EPISODE_B] });
  await seedEpisode(EPISODE_B, CHANNEL_A, { publishedAt: 2_000 });
  await seedSummary(EPISODE_B);
  await seedEpisode(EPISODE_C, CHANNEL_A, {
    publishedAt: 1_000,
    status: "failed",
  });
  return stub;
}

describe("channel and catalog routes", () => {
  it("accepts every operation from any identity: the API enforces no authorization", async () => {
    await seedCatalog();
    // Skip first (EPISODE_C is failed), then retry the skipped episode; both by a plain user.
    const anyIdentity: [string, string, unknown?][] = [
      ["GET", "/catalog"],
      ["GET", "/channels?scope=all"],
      ["GET", `/channels/${CHANNEL_A}/runs`],
      ["GET", `/channels/${CHANNEL_A}/followers`],
      ["POST", `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/skip`],
      ["POST", `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/retry`],
    ];
    for (const [method, path, body] of anyIdentity) {
      const { status, json } = await call(ALICE, method, path, body);
      expect(status, `${method} ${path}`).toBe(200);
      expect(json).not.toHaveProperty("code");
    }

    const followers = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/followers`,
    );
    expect(followers.status).toBe(200);
    expectShape(FollowersResponseSchema, followers.json);
    expect(followers.json.followers).toEqual([]);

    const catalog = await call(ALICE, "GET", "/catalog");
    expectShape(CatalogResponseSchema, catalog.json);
    expect(catalog.status).toBe(200);
    // EPISODE_C went failed → skipped → pending through the calls above. A's episodes name a run, so
    // nothing approved is "never started".
    expect(catalog.json.catalog).toMatchObject({
      channels: { requested: 1, approved: 1, paused: 0, declined: 1 },
      episodes: { available: 2, pending: 1, failed: 0, skipped: 0 },
      attention: { failedEpisodes: 0, neverStarted: 0, requested: 1 },
      // vitest.config.ts pins the key empty and TRANSCRIPTS_FAKE answers the health: no test reaches DownSub.
      transcripts: { remainingCredits: 1000, status: "ok" },
    });

    expect((await call(ALICE, "GET", "/channels?scope=bogus")).status).toBe(
      400,
    );
  });

  it("lists requested and approved channels for any caller, every status with ?scope=all, management on every row", async () => {
    await seedCatalog();
    await registry().recordFollow(ALICE, CHANNEL_A);

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
      management: expect.objectContaining({ initialImportCount: 5 }),
    });

    // `?scope=all` is open to any caller (PRD §9).
    const all = await call(ALICE, "GET", "/channels?scope=all");
    expectShape(ChannelsResponseSchema, all.json);
    const rows = all.json.channels as Json[];
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

  it("shows one channel to every caller in any status, with management", async () => {
    await seedCatalog();

    const requested = await call(ALICE, "GET", `/channels/${CHANNEL_B}`);
    expect(requested.status).toBe(200);
    expect(requested.json.channel).toMatchObject({
      status: "requested",
      management: { neverStarted: false, initialImportCount: 5 },
    });
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
      management: expect.objectContaining({ pausedBy: null }),
    });

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

    // Verification reads `channel_id=`, not the feed discovery reads: a channel with no long-form
    // uploads yet is a real channel, and its title comes from that feed (spec §7.5).
    const noLongForm = await call(ALICE, "POST", "/channels", {
      channelId: CHANNEL_G,
    });
    expect(noLongForm.status).toBe(201);
    expect(noLongForm.json.channel).toMatchObject({
      channelId: CHANNEL_G,
      title: "Feed G",
    });

    const created = await call(OWNER, "POST", "/channels", {
      channelId: `https://www.youtube.com/channel/${CHANNEL_D}`,
      initialImportCount: 3,
    });
    expect(created.status).toBe(201);
    // The owner's add is no shortcut (owner decision 2026-09-12): every add is `requested`, and the
    // web follows the owner's add with an approve. `initialImportCount` is honoured from anyone.
    expect(created.json.channel).toMatchObject({
      channelId: CHANNEL_D,
      title: "Feed D",
      status: "requested",
      following: true,
      management: { initialImportCount: 3, neverStarted: false },
    });

    // A user's add is the same request, with the same representation.
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
      management: expect.objectContaining({ initialImportCount: 5 }),
    });

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

  it("reads a channel id's feeds without creating anything, and says what the catalog holds", async () => {
    await seedCatalog();

    // H publishes six, two of them long-form: the number that matters, because discovery reads the
    // long-form feed alone.
    const fresh = await call(
      ALICE,
      "GET",
      `/channels/feed?channelId=${CHANNEL_H}`,
    );
    expect(fresh.status).toBe(200);
    expectShape(ChannelFeedResponseSchema, fresh.json);
    expect(fresh.json).toEqual({
      feed: {
        channelId: CHANNEL_H,
        title: "Feed H",
        entryCount: 6,
        longFormCount: 2,
        newestLongFormAt: FEED_H_LONG_FORM[0]?.publishedAt,
      },
      channel: null,
    });
    // Nothing was created: the catalog is where it was.
    expect((await call(ALICE, "GET", `/channels/${CHANNEL_H}`)).status).toBe(
      404,
    );

    // A channel the catalog already holds comes back with it, so the last step knows what it is doing.
    const known = await call(
      ALICE,
      "GET",
      `/channels/feed?channelId=${CHANNEL_A}`,
    );
    expect(known.json.feed).toMatchObject({ title: "Feed A", entryCount: 0 });
    expect(known.json.channel).toMatchObject({
      channelId: CHANNEL_A,
      status: "approved",
    });

    // G's long-form feed 404s: it publishes, but nothing discovery would read.
    expect(
      (await call(ALICE, "GET", `/channels/feed?channelId=${CHANNEL_G}`)).json
        .feed,
    ).toMatchObject({ longFormCount: 0, newestLongFormAt: null });

    // A URL is accepted; a handle and an id with no feed are not.
    expect(
      (
        await call(
          ALICE,
          "GET",
          `/channels/feed?channelId=${encodeURIComponent(`https://www.youtube.com/channel/${CHANNEL_H}/videos`)}`,
        )
      ).json.feed,
    ).toMatchObject({ channelId: CHANNEL_H });
    expect(
      (await call(ALICE, "GET", "/channels/feed?channelId=@handle")).status,
    ).toBe(400);
    expect(
      (await call(ALICE, "GET", `/channels/feed?channelId=${CHANNEL_E}`))
        .status,
    ).toBe(400);
    expect((await call(ALICE, "GET", "/channels/feed")).status).toBe(400);
  });

  it("serves every caller the same episodes, reports read state, and records nothing", async () => {
    await seedCatalog();
    await registry().recordFollow(ALICE, CHANNEL_A);

    const bob = await call(BOB, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(bob.status).toBe(200);
    const bobEpisodes = bob.json.episodes as Json[];
    expect(bobEpisodes.map((e) => e.episodeId)).toEqual([
      EPISODE_A,
      EPISODE_B,
      EPISODE_C,
    ]);
    // Bob follows nothing: he still receives the summaries and `processing` (the API enforces no
    // authorization), related titles filtered to his empty eligible set, and no read state at all.
    for (const episode of bobEpisodes) {
      expect(episode.related).toEqual([]);
      expect(episode).not.toHaveProperty("read");
      expect(episode).toHaveProperty("processing");
    }
    expect(bobEpisodes[0]?.summary).toMatchObject({ format: "structured" });

    const first = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/episodes?limit=2`,
    );
    const firstEpisodes = first.json.episodes as Json[];
    expect(firstEpisodes).toHaveLength(2);
    expect(firstEpisodes[0]).toMatchObject({
      episodeId: EPISODE_A,
      summary: { format: "structured" },
      related: [{ episodeId: EPISODE_B, title: `Episode ${EPISODE_B}` }],
      read: false,
    });

    // Fetching is a pure read (docs/PRD.md §4.4): a second fetch says unread again, and the User DO
    // holds no receipt. Only POST …/read writes one.
    const second = await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    const secondEpisodes = second.json.episodes as Json[];
    expect(secondEpisodes.map((e) => e.read)).toEqual([
      false,
      false,
      undefined,
    ]);
    expect(await userDO(ALICE).readEpisodeIds([EPISODE_A, EPISODE_B])).toEqual(
      [],
    );

    await call(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );
    const afterRead = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/episodes`,
    );
    expect((afterRead.json.episodes as Json[]).map((e) => e.read)).toEqual([
      true,
      false,
      undefined,
    ]);

    // Bob's receipts are his own, and nobody's reading has touched them.
    await registry().recordFollow(BOB, CHANNEL_A);
    const bobAgain = await call(BOB, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect((bobAgain.json.episodes as Json[]).map((e) => e.read)).toEqual([
      false,
      false,
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

    // A skipped episode tells every caller why there is no summary, at the top level and in `processing`.
    await seedEpisode(EPISODE_SKIPPED, CHANNEL_A, {
      publishedAt: 500,
      status: "skipped",
      skipReason: "UNPLAYABLE",
    });
    const withSkipped = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/episodes`,
    );
    const skippedEpisode = (withSkipped.json.episodes as Json[]).at(-1);
    expect(skippedEpisode).toMatchObject({
      episodeId: EPISODE_SKIPPED,
      status: "skipped",
      skipReason: "UNPLAYABLE",
      summary: null,
      processing: expect.objectContaining({ skippedAt: expect.any(Number) }),
    });

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

  it("returns a declined channel's summaries to a follower without read state", async () => {
    const stub = await seedCatalog();
    await registry().recordFollow(ALICE, CHANNEL_A);
    await stub.declineChannel(OWNER, CHANNEL_A, { explanation: "withdrawn" });

    // The web hides these from readers (PRD §7); the API returns them, and a declined channel is
    // not eligible, so there is no read state to report and no receipt to write.
    const alice = await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(alice.status).toBe(200);
    const episodes = alice.json.episodes as Json[];
    expect(episodes[0]?.summary).toMatchObject({ format: "structured" });
    for (const episode of episodes) {
      expect(episode).not.toHaveProperty("read");
    }
    expect(
      (
        await call(
          ALICE,
          "POST",
          `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
        )
      ).status,
    ).toBe(404);
    expect(await userDO(ALICE).readEpisodeIds([EPISODE_A, EPISODE_B])).toEqual(
      [],
    );
  });

  it("answers one episode, and records or undoes its receipt for an eligible caller only", async () => {
    await seedCatalog();
    await registry().recordFollow(ALICE, CHANNEL_A);
    const path = `/channels/${CHANNEL_A}/episodes/${EPISODE_A}`;

    // The reading view's deep link: one episode with its summary, related titles in the caller's
    // scope, `processing`, and read state — and it records nothing.
    const cold = await call(ALICE, "GET", path);
    expect(cold.status).toBe(200);
    expectShape(EpisodeResponseSchema, cold.json);
    expect(cold.json.episode).toMatchObject({
      episodeId: EPISODE_A,
      summary: { format: "structured" },
      related: [{ episodeId: EPISODE_B, title: `Episode ${EPISODE_B}` }],
      read: false,
    });
    expect(await userDO(ALICE).readEpisodeIds([EPISODE_A])).toEqual([]);

    const marked = await call(ALICE, "POST", `${path}/read`);
    expect(marked.status).toBe(200);
    expectShape(EpisodeResponseSchema, marked.json);
    expect(marked.json.episode).toMatchObject({
      episodeId: EPISODE_A,
      read: true,
    });
    expect(await userDO(ALICE).readEpisodeIds([EPISODE_A])).toEqual([
      EPISODE_A,
    ]);
    // Idempotent, and it keeps the original time.
    expect((await call(ALICE, "POST", `${path}/read`)).status).toBe(200);
    expect(((await call(ALICE, "GET", path)).json.episode as Json).read).toBe(
      true,
    );

    const undone = await call(ALICE, "DELETE", `${path}/read`);
    expect(undone.status).toBe(200);
    expect(undone.json.episode).toMatchObject({ read: false });
    expect(await userDO(ALICE).readEpisodeIds([EPISODE_A])).toEqual([]);
    expect((await call(ALICE, "DELETE", `${path}/read`)).status).toBe(200);

    // Bob follows nothing: he reads the episode like everyone else, with no read state, and his
    // receipt calls write nothing.
    const bob = await call(BOB, "GET", path);
    expect(bob.status).toBe(200);
    expect(bob.json.episode).not.toHaveProperty("read");
    expect((await call(BOB, "POST", `${path}/read`)).status).toBe(404);
    expect((await call(BOB, "DELETE", `${path}/read`)).status).toBe(404);
    expect(await userDO(BOB).readEpisodeIds([EPISODE_A])).toEqual([]);

    // The reading view knows the episode, not its channel: `/episodes/:episodeId` answers the same
    // episode, and an id no channel holds is 404.
    const byId = await call(ALICE, "GET", `/episodes/${EPISODE_A}`);
    expect(byId.status).toBe(200);
    expectShape(EpisodeResponseSchema, byId.json);
    expect(byId.json.episode).toMatchObject({
      episodeId: EPISODE_A,
      channelId: CHANNEL_A,
      summary: { format: "structured" },
      related: [{ episodeId: EPISODE_B }],
      read: false,
    });
    expect((await call(ALICE, "GET", "/episodes/zzzzzzzzzzz")).status).toBe(
      404,
    );
    expect((await call(ALICE, "GET", "/episodes/bad")).status).toBe(400);
    // Bob follows nothing: same episode, no read state, and still nothing recorded.
    expect(
      (await call(BOB, "GET", `/episodes/${EPISODE_A}`)).json.episode,
    ).not.toHaveProperty("read");

    // A summary is the only thing a receipt can name; EPISODE_C is failed.
    expect(
      (
        await call(
          ALICE,
          "POST",
          `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/read`,
        )
      ).status,
    ).toBe(409);
    // Unknown video, unknown channel, and a video of another channel are all 404.
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes/zzzzzzzzzzz`))
        .status,
    ).toBe(404);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_D}/episodes/${EPISODE_A}`))
        .status,
    ).toBe(404);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_C}/episodes/${EPISODE_A}`))
        .status,
    ).toBe(404);
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_A}/episodes/bad`)).status,
    ).toBe(400);
  });

  it("exposes discovery runs as a channel sub-resource", async () => {
    await seedCatalog();
    const runId = await seedRun(CHANNEL_A, {
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 2,
      createdAt: 5,
      finishedAt: 5,
    });

    const runs = await call(ALICE, "GET", `/channels/${CHANNEL_A}/runs`);
    expectShape(IngestionRunsResponseSchema, runs.json);
    expect(runs.status).toBe(200);
    // Newest first: the explicit run, then the seed run A's episodes name.
    expect((runs.json.runs as Json[])[0]).toMatchObject({
      runId,
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 2,
    });
    expect(
      (await call(OWNER, "GET", `/channels/${CHANNEL_D}/runs`)).status,
    ).toBe(404);
  });

  it("skip closes a failed episode, retry reopens it, and a run in flight refuses the retry", async () => {
    await seedCatalog();

    const skip = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/skip`,
    );
    expect(skip.status).toBe(200);
    expectShape(EpisodeResponseSchema, skip.json);
    const skipped = skip.json.episode as Json;
    expect(skipped.status).toBe("skipped");
    expect(skipped.skipReason).toBe("OWNER");

    const retry = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/retry`,
    );
    expect(retry.status).toBe(200);
    expectShape(EpisodeRetryResponseSchema, retry.json);
    const retried = retry.json.episode as Json;
    expect(retried.status).toBe("pending");
    // The window re-opens and one attempt starts at once (M3.5).
    expect(retried.processing).toMatchObject({
      attemptCount: 1,
      intent: "publish",
      latestAttempt: { status: "running", trigger: "owner_retry" },
    });
    expect(retry.json.attempt).toMatchObject({
      status: "running",
      requestedByEmail: OWNER,
    });

    // Only a running attempt refuses Retry.
    await seedAttempt(EPISODE_C, { status: "running" });
    const blocked = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/retry`,
    );
    expect(blocked.status).toBe(409);
  });

  it("derives a pending episode's waitReason from its latest attempt, for every caller", async () => {
    await seedCatalog();
    const cases: [
      string,
      Parameters<typeof seedAttempt>[1] | null,
      string | null,
    ][] = [
      [
        "waitcaptio0",
        { status: "waiting", outcomeCode: "CAPTIONS" },
        "CAPTIONS",
      ],
      [
        "waitlimit00",
        { status: "waiting", outcomeCode: "PROVIDER_LIMIT" },
        "PROVIDER_LIMIT",
      ],
      [
        "waitblocked",
        { status: "blocked", outcomeCode: "PROVIDER_LIMIT" },
        "PROVIDER_LIMIT",
      ],
      [
        "waitauth000",
        { status: "blocked", outcomeCode: "PROVIDER_AUTH" },
        null,
      ],
      ["waitfailed0", { status: "failed", outcomeCode: "PROVIDER_HTTP" }, null],
      ["waitrunning", { status: "running" }, null],
      ["waitnoatmpt", null, null],
    ];
    let published = 100;
    for (const [episodeId, attempt] of cases) {
      await seedEpisode(episodeId, CHANNEL_A, {
        status: "pending",
        publishedAt: published++,
        window: { intent: "publish" },
      });
      if (attempt) await seedAttempt(episodeId, attempt);
    }

    // Bob follows nothing and still reads the reason and the attempt (no authorization).
    const bob = await call(BOB, "GET", `/channels/${CHANNEL_A}/episodes`);
    expect(bob.status).toBe(200);
    const byId = new Map(
      (bob.json.episodes as Json[]).map((e) => [e.episodeId as string, e]),
    );
    for (const [episodeId, attempt, expected] of cases) {
      const episode = byId.get(episodeId) as Json;
      expect(episode.waitReason, episodeId).toBe(expected);
      const processing = episode.processing as Json;
      if (attempt) {
        expect(processing.latestAttempt, episodeId).toMatchObject({
          status: attempt.status,
        });
      } else {
        expect(processing.latestAttempt, episodeId).toBeNull();
      }
      expect(processing.intent, episodeId).toBe("publish");
    }
    // A summarised episode never waits.
    expect((byId.get(EPISODE_A) as Json).waitReason).toBeNull();
  });

  it("honours title and initialImportCount from any caller", async () => {
    const created = await call(ALICE, "POST", "/channels", {
      channelId: `https://www.youtube.com/channel/${CHANNEL_D}`,
      title: "Given by a user",
      initialImportCount: 2,
    });
    expect(created.status).toBe(201);
    expect(created.json.channel).toMatchObject({
      title: "Given by a user",
      status: "requested",
      management: { initialImportCount: 2 },
    });
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
    expect(await registry().activeChannelIds(ALICE)).toEqual([CHANNEL_A]);

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

  it("approve, decline, pause, and resume are accepted from any identity and record who acted", async () => {
    await call(ALICE, "POST", "/channels", { channelId: CHANNEL_A });
    const approved = await call(
      ALICE,
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
      management: { reviewedByEmail: ALICE },
    });
    // The `paused` boolean and its reason travel together for every caller.
    expect(
      (await call(BOB, "POST", `/channels/${CHANNEL_A}/pause`, {})).json
        .channel,
    ).toMatchObject({ paused: true, management: { pausedBy: "owner" } });
    expect(
      (await call(BOB, "POST", `/channels/${CHANNEL_A}/resume`, {})).json
        .channel,
    ).toMatchObject({ paused: false, management: { pausedBy: null } });
    const declined = await call(BOB, "POST", `/channels/${CHANNEL_A}/decline`, {
      explanation: "withdrawn",
    });
    expect(declined.json.channel).toMatchObject({
      status: "declined",
      reviewNote: "withdrawn",
      paused: false,
      management: { reviewedByEmail: BOB },
    });
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_A}/pause`, {})).status,
    ).toBe(409);
    // The owner's add creates a requested channel like anyone else's; approval is the separate call.
    const owned = await call(OWNER, "POST", "/channels", {
      channelId: CHANNEL_B,
    });
    expect(owned.status).toBe(201);
    expect(owned.json.channel).toMatchObject({
      status: "requested",
      approvedAt: null,
      following: true,
    });
    const ownerApproved = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_B}/approve`,
      {},
    );
    expect(ownerApproved.json.channel).toMatchObject({
      status: "approved",
      management: { reviewedByEmail: OWNER },
    });
  });
});
