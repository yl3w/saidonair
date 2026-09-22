import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ai } from "../src/lib/ai";
import { answer } from "../src/lib/chat";
import {
  type ChunkMetadata,
  type QueryOptions,
  SHARED_NAMESPACE,
  vectorStore,
} from "../src/lib/vectorize";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  EPISODE_A,
  follow,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  signedIn,
  userDO,
} from "./helpers";

/**
 * PRD §8's first two criteria, which the M6 audit found untested (docs/PRD.md §9, 2026-09-17):
 * two readers share one episode set, and neither can reach the other's private state.
 *
 * **The first criterion names three things — one episode, one summary, one vector set — and this
 * file covered two of them until 2026-09-22.** The M6 sweep found the vector third asserted
 * nowhere (docs/specs/m6-hardening.md §6, G1) and the third case below closes it.
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

  /**
   * The vector third of §8's first line: "one shared **vector** set". Two readers ask the same
   * question of the same episode, and the assertion is not that both got an answer — it is that
   * there was one set of vectors and neither reader's identity reached it. A per-user namespace or
   * a user-keyed filter would give both of them answers too, and would break the promise silently.
   *
   * This is the criterion the milestone was defined around, and the reason it gets a test despite
   * being true by construction is the argument in PRD §10: true by construction is exactly what
   * stops being true after a refactor. Hard rule 3 lives in `lib/vectorize.ts`; this checks that
   * the pipeline above it never asks for anything else.
   */
  it("retrieves both readers' answers from one shared vector set, keyed to no one", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, { status: "available" });
    await seedSummary(EPISODE_A);
    await follow(ALICE, CHANNEL_A);
    await follow(BOB, CHANNEL_A);

    const generationId = `gen-${EPISODE_A}`;
    const store = vectorStore({ VECTORIZE_FAKE: "{}" });
    const chunk = (index: number) => ({
      id: `${EPISODE_A}:${generationId}:${index}`,
      values: Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0)),
      metadata: {
        episodeId: EPISODE_A,
        channelId: CHANNEL_A,
        generationId,
        channelTitle: "A",
        title: `Episode ${EPISODE_A}`,
        startSec: index * 60,
        endSec: index * 60 + 60,
        text: `transcript text ${index}`,
        publishedAt: 1_000,
      } satisfies ChunkMetadata,
    });
    await store.upsert(SHARED_NAMESPACE, [chunk(0), chunk(1)]);

    // Every namespace and filter the store is asked for, whoever is asking.
    const namespaces: string[] = [];
    const filters: (QueryOptions["filter"] | undefined)[] = [];
    const watched = {
      ...store,
      async query(ns: typeof SHARED_NAMESPACE, v: number[], o: QueryOptions) {
        namespaces.push(ns);
        filters.push(o.filter);
        return store.query(ns, v, o);
      },
    };

    const ask = async (email: string) => {
      const user = await userDO(email);
      const chat = await user.createChat();
      const { assistantMessage } = await answer(
        {
          user,
          registry: registry(),
          ai: ai({ AI_FAKE: "{}" }),
          vectors: watched,
          eligible: new Set([CHANNEL_A]),
        },
        { chatId: chat.chatId, message: "what did they say about it?" },
      );
      return assistantMessage;
    };

    const forAlice = await ask(ALICE);
    const forBob = await ask(BOB);

    // Both answered from the same episode, at the same offsets: one set of chunks, read twice.
    expect(forAlice.status).toBe("completed");
    expect(forBob.status).toBe("completed");
    expect(forAlice.sources.map((s) => s.startSec)).toEqual([0, 60]);
    expect(forBob.sources.map((s) => s.startSec)).toEqual(
      forAlice.sources.map((s) => s.startSec),
    );
    for (const source of [...forAlice.sources, ...forBob.sources]) {
      expect(source).toMatchObject({
        episodeId: EPISODE_A,
        channelId: CHANNEL_A,
      });
    }

    // One generation is what both read: the episode carries a single active id, and the vectors
    // are stored under it. A replacement would move both readers together or neither.
    const [state] = await registry().listEpisodeStates([EPISODE_A]);
    expect(state?.activeVectorGeneration).toBe(generationId);
    const stored = await store.getByIds(SHARED_NAMESPACE, [
      `${EPISODE_A}:${generationId}:0`,
    ]);
    expect(stored).toHaveLength(1);

    // And nothing about either reader reached the store. The namespace is the one constant, and
    // the filter names channels — never a user_id, never an address (hard rule 3).
    expect(namespaces).toEqual([SHARED_NAMESPACE, SHARED_NAMESPACE]);
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(JSON.stringify(filter)).not.toContain(ALICE);
      expect(JSON.stringify(filter)).not.toContain(BOB);
      expect(filter).toEqual({ channelId: { $in: [CHANNEL_A] } });
    }
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
