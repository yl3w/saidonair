import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  follow,
  seedApprovedChannel,
  seedAttempt,
  seedEpisode,
  seedSummary,
  signedIn,
} from "./helpers";

/**
 * The five reads a signed-out caller may make (docs/specs/route-visibility.md §6, criteria 1–6).
 *
 * **Every case here sends no `Authorization` header**, which is the whole point: the ordering in
 * `index.ts` is the mechanism, and a suite that always sends a token would prove nothing about it
 * (spec §4.2). The signed-in half is asserted beside each anonymous one, because "richer when
 * signed in" is a claim about the difference rather than about either shape alone.
 */

type Json = Record<string, unknown>;

/** No `Authorization` header at all. */
async function anonymous(
  path: string,
  method = "GET",
): Promise<{ status: number; json: Json }> {
  const response = await SELF.fetch(`http://api${path}`, { method });
  return { status: response.status, json: (await response.json()) as Json };
}

/** A caller with a session — ALICE, who is not the owner: `management` is not an owner's field. */
async function asAlice(path: string): Promise<{ status: number; json: Json }> {
  const response = await SELF.fetch(`http://api${path}`, {
    headers: await signedIn(ALICE),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

const PUBLIC_READS = [
  "/channels",
  `/channels/${CHANNEL_A}`,
  `/channels/${CHANNEL_A}/episodes`,
  `/channels/${CHANNEL_A}/episodes/${EPISODE_A}`,
  `/episodes/${EPISODE_A}`,
];

/**
 * A: approved, followed by ALICE, with two available summaries that name each other as related and
 * one pending episode waiting on captions. B: approved, unfollowed, so ALICE is not eligible for it.
 */
beforeEach(async () => {
  await seedApprovedChannel(CHANNEL_A, "A");
  await seedApprovedChannel(CHANNEL_B, "B");
  await follow(ALICE, CHANNEL_A);
  await seedEpisode(EPISODE_A, CHANNEL_A, { publishedAt: 3_000 });
  await seedSummary(EPISODE_A, { relatedEpisodeIds: [EPISODE_B] });
  await seedEpisode(EPISODE_B, CHANNEL_A, { publishedAt: 2_000 });
  await seedSummary(EPISODE_B);
  await seedEpisode(EPISODE_C, CHANNEL_A, {
    publishedAt: 1_000,
    status: "pending",
    window: { intent: "publish" },
  });
  await seedAttempt(EPISODE_C, { status: "waiting", outcomeCode: "CAPTIONS" });
});

describe("the five public reads", () => {
  it("answers 200 to a caller with no Authorization header at all", async () => {
    for (const path of PUBLIC_READS) {
      const response = await anonymous(path);
      expect(response.status, path).toBe(200);
      expect(response.json, path).not.toHaveProperty("code");
    }
  });

  it("omits management from the channel list and the channel detail", async () => {
    const list = await anonymous("/channels");
    const channels = list.json.channels as Json[];
    expect(channels.length).toBeGreaterThan(0);
    for (const channel of channels) {
      expect(channel, `${channel.channelId}`).not.toHaveProperty("management");
      // What stays: the channel's own facts, and a follower count that is about the channel
      // rather than about any reader.
      expect(channel).toMatchObject({
        title: expect.any(String),
        status: "approved",
        paused: expect.any(Boolean),
        episodes: expect.any(Object),
      });
    }

    const one = await anonymous(`/channels/${CHANNEL_A}`);
    expect(one.json.channel).not.toHaveProperty("management");
  });

  it("omits processing from every episode shape, and keeps what a reader is owed", async () => {
    const list = await anonymous(`/channels/${CHANNEL_A}/episodes`);
    const episodes = list.json.episodes as Json[];
    expect(episodes).toHaveLength(3);
    for (const episode of episodes) {
      expect(episode, `${episode.episodeId}`).not.toHaveProperty("processing");
      expect(episode, `${episode.episodeId}`).toHaveProperty("status");
      expect(episode, `${episode.episodeId}`).toHaveProperty("skipReason");
      expect(episode, `${episode.episodeId}`).toHaveProperty("waitReason");
      expect(episode, `${episode.episodeId}`).toHaveProperty("summary");
    }

    // `waitReason` is the one piece of processing designed to be shown, so it survives the
    // omission of the block it is derived from (PRD §4.2 rule 11, spec §4.3).
    const pending = episodes.find((e) => e.episodeId === EPISODE_C);
    expect(pending).toMatchObject({
      status: "pending",
      waitReason: "CAPTIONS",
    });

    // And the same for both single-episode reads, which resolve an episode by different routes.
    for (const path of [
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}`,
      `/episodes/${EPISODE_A}`,
    ]) {
      const one = await anonymous(path);
      const episode = one.json.episode as Json;
      expect(episode, path).not.toHaveProperty("processing");
      expect(episode, path).toHaveProperty("summary");
      expect((episode.summary as Json | null) !== null, path).toBe(true);
    }
  });

  it("answers following false, read absent and related empty, with followerCount intact", async () => {
    const list = await anonymous("/channels");
    for (const channel of list.json.channels as Json[]) {
      expect(channel.following, `${channel.channelId}`).toBe(false);
    }
    // ALICE follows A, so its count is a fact an anonymous caller still receives.
    const one = (await anonymous(`/channels/${CHANNEL_A}`)).json
      .channel as Json;
    expect(one).toMatchObject({ following: false, followerCount: 1 });

    const episode = (await anonymous(`/episodes/${EPISODE_A}`)).json
      .episode as Json;
    expect(episode).not.toHaveProperty("read");
    // EPISODE_A names EPISODE_B as related, and the titles are filtered to the caller's eligible
    // channels: an anonymous caller has none, so there is nothing to resolve them against.
    expect(episode.related).toEqual([]);
  });

  it("gives all four back to any session, not only the owner's", async () => {
    const channel = (await asAlice(`/channels/${CHANNEL_A}`)).json
      .channel as Json;
    expect(channel).toHaveProperty("management");
    expect(channel).toMatchObject({ following: true, followerCount: 1 });

    const episode = (await asAlice(`/episodes/${EPISODE_A}`)).json
      .episode as Json;
    expect(episode).toHaveProperty("processing");
    // ALICE is eligible for A — an active follower of an approved channel — so she has a receipt
    // to report and the related title resolves.
    expect(episode.read).toBe(false);
    expect(episode.related).toHaveLength(1);
  });

  it("treats a stale or malformed token as anonymous rather than refusing it", async () => {
    // A reader whose session quietly expired should meet a public page, not a 401 (spec §4.1); the
    // malformed one is criterion 13, which `optionalIdentity` handles by resolving to no identity
    // rather than by catching.
    for (const authorization of ["Bearer never-minted", "nonsense"]) {
      for (const path of PUBLIC_READS) {
        const response = await SELF.fetch(`http://api${path}`, {
          headers: { Authorization: authorization },
        });
        expect(response.status, `${authorization} ${path}`).toBe(200);
      }
    }

    // And the anonymous view, not a signed-in one with an empty caller.
    const response = await SELF.fetch(`http://api/channels/${CHANNEL_A}`, {
      headers: { Authorization: "Bearer never-minted" },
    });
    const channel = ((await response.json()) as Json).channel as Json;
    expect(channel).not.toHaveProperty("management");
    expect(channel.following).toBe(false);
  });
});

describe("the routes that are not public", () => {
  /**
   * Criterion 11, enumerated from the router rather than from a list somebody keeps: the five
   * public reads are the only additions, and nothing lost its guard in the split. `requireIdentity`
   * runs before validation, so a placeholder parameter and an absent body still answer 401.
   */
  it("still answers 401 to a caller with no session — every one of them", async () => {
    const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
    const OPEN = new Set([
      "GET /health",
      "GET /openapi.json",
      "GET /docs",
      "GET /session/start",
      "GET /session/handoff",
      "POST /session/exchange",
      "GET /channels",
      "GET /channels/:id",
      "GET /channels/:id/episodes",
      "GET /channels/:id/episodes/:episodeId",
      "GET /episodes/:episodeId",
    ]);

    const guarded = [
      ...new Set(
        app.routes
          .filter((route) => METHODS.has(route.method))
          .map((route) => `${route.method} ${route.path}`)
          // better-auth owns /auth/* and answers for itself.
          .filter((route) => !route.includes("/auth/"))
          .filter((route) => !OPEN.has(route)),
      ),
    ];
    // A guard that stopped covering something would shrink this; so would a bad filter.
    expect(guarded.length).toBeGreaterThanOrEqual(20);

    for (const route of guarded) {
      const [method = "GET", path = "/"] = route.split(" ");
      const url = path
        .replaceAll(":episodeId", EPISODE_A)
        .replaceAll(":channelId", CHANNEL_A)
        .replaceAll(":chatId", "chat-id")
        .replaceAll(":id", CHANNEL_A);
      const response = await SELF.fetch(`http://api${url}`, { method });
      expect(response.status, route).toBe(401);
      expect(await response.json(), route).toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
  });

  /**
   * Criterion 12, and the regression the split could have caused. `GET /channels/feed` is not
   * public — it calls YouTube per request — but it shares a path shape with the public
   * `GET /channels/{id}`, and `ChannelParamsSchema` accepts any non-empty string, so a `/{id}`
   * registered ahead of it would answer `404 channel not found` instead of the feed.
   */
  it("still reads the feeds, rather than being swallowed by the public /channels/:id", async () => {
    const anon = await anonymous(`/channels/feed?channelId=${CHANNEL_A}`);
    expect(anon.status).toBe(401);

    const response = await SELF.fetch(
      `http://api/channels/feed?channelId=${CHANNEL_A}`,
      { headers: await signedIn(ALICE) },
    );
    expect(response.status).toBe(200);
    // The feed, not a channel: a swallowed request would answer a `channel` envelope or a 404.
    expect(await response.json()).toMatchObject({
      feed: { channelId: CHANNEL_A, title: expect.any(String) },
    });
  });
});
