import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  EPISODE_A,
  follow,
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  signedIn,
} from "./helpers";

/**
 * PRD §8's first two criteria, which the M6 audit found untested (docs/PRD.md §9, 2026-09-17):
 * two readers share one episode set, and neither can reach the other's private state.
 *
 * Both were true by construction before this chunk — episodes carry no user dimension, and the
 * User DO is addressed per identity — and **true by construction is exactly what stops being true
 * after a refactor**. They are also the criteria authentication was for: until A7 the second was
 * true only because nobody sent somebody else's address.
 */
async function as(email: string, method: string, path: string, body?: unknown) {
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers: {
      ...(await signedIn(email)),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as never };
}

describe("two readers, one catalog", () => {
  it("shares one episode and summary between followers, with receipts of their own", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, { status: "available" });
    await seedSummary(EPISODE_A);
    await follow(ALICE, CHANNEL_A);
    await follow(BOB, CHANNEL_A);

    // One episode row and one summary, whoever is asking.
    const forAlice = await as(ALICE, "GET", `/channels/${CHANNEL_A}/episodes`);
    const forBob = await as(BOB, "GET", `/channels/${CHANNEL_A}/episodes`);
    const strip = (payload: { episodes: { read?: boolean }[] }) =>
      payload.episodes.map(({ read: _read, ...rest }) => rest);
    expect(strip(forAlice.json)).toEqual(strip(forBob.json));

    // The receipt is the one thing that differs.
    const read = await as(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );
    expect(read.status).toBe(200);
    const aliceAfter = await as(
      ALICE,
      "GET",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}`,
    );
    const bobAfter = await as(
      BOB,
      "GET",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}`,
    );
    expect(
      (aliceAfter.json as { episode: { read: boolean } }).episode.read,
    ).toBe(true);
    expect((bobAfter.json as { episode: { read: boolean } }).episode.read).toBe(
      false,
    );
  });

  it("keeps one reader's chats, messages, preferences and receipts from another", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, { status: "available" });
    await seedSummary(EPISODE_A);
    await follow(ALICE, CHANNEL_A);
    await follow(BOB, CHANNEL_A);

    const chat = await as(ALICE, "POST", "/chats", {});
    const chatId = (chat.json as { chat: { chatId: string } }).chat.chatId;
    await as(ALICE, "PUT", "/preferences", { systemRules: "alice's rule" });
    await as(
      ALICE,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/read`,
    );

    // Bob knows the id and asks anyway: the chat is simply not there.
    expect((await as(BOB, "GET", `/chats/${chatId}/messages`)).status).toBe(
      404,
    );
    expect((await as(BOB, "GET", "/chats")).json).toMatchObject({ chats: [] });

    // Preferences and receipts are his own, not hers.
    expect((await as(BOB, "GET", "/preferences")).json).not.toMatchObject({
      preferences: { systemRules: "alice's rule" },
    });
    const episode = await as(
      BOB,
      "GET",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}`,
    );
    expect((episode.json as { episode: { read: boolean } }).episode.read).toBe(
      false,
    );
  });
});
