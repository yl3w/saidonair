import { describe, expect, it } from "vitest";
import { ai, FAKE_THROW, FAKE_TRUNCATE } from "../src/lib/ai";
import {
  answer,
  type ChatDeps,
  NO_FOLLOWS_REPLY,
  NOTHING_FOUND_REPLY,
  SCOPE_INELIGIBLE_REPLY,
  SCOPED_CANDIDATES,
  trimToSentence,
  UNSCOPED_CANDIDATES,
  UNSCOPED_KEEP,
} from "../src/lib/chat";
import {
  type ChunkMetadata,
  QUERY_TOP_K_MAX,
  type QueryOptions,
  SHARED_NAMESPACE,
  type VectorStore,
  vectorStore,
} from "../src/lib/vectorize";
import { CHAT_PROMPT_VERSION } from "../src/prompts/chat";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  userDO,
} from "./helpers";

function chunkOf(
  episodeId: string,
  channelId: string,
  index: number,
  generationId = `gen-${episodeId}`,
): { id: string; values: number[]; metadata: ChunkMetadata } {
  return {
    id: `${episodeId}:${generationId}:${index}`,
    values: Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0)),
    metadata: {
      episodeId,
      channelId,
      generationId,
      channelTitle: "A Channel",
      title: `Episode ${episodeId}`,
      startSec: index * 60,
      endSec: index * 60 + 60,
      text: `transcript text ${index}`,
      publishedAt: 1_000,
    },
  };
}

/** Wraps the fakes so a test can assert a branch called neither of them. */
function spied(vectors: VectorStore) {
  const queries: QueryOptions[] = [];
  const aiCalls: string[] = [];
  const client = ai({ AI_FAKE: "{}" });
  return {
    queries,
    aiCalls,
    vectors: {
      ...vectors,
      async query(ns: typeof SHARED_NAMESPACE, v: number[], o: QueryOptions) {
        queries.push(o);
        return vectors.query(ns, v, o);
      },
    } as VectorStore,
    ai: {
      ...client,
      async embed(texts: readonly string[]) {
        aiCalls.push("embed");
        return client.embed(texts);
      },
      async answer(prompt: string) {
        aiCalls.push(prompt);
        return client.answer(prompt);
      },
    },
  };
}

async function deps(
  eligible: string[],
  seed: (store: VectorStore) => Promise<void> = async () => {},
): Promise<ChatDeps & { queries: QueryOptions[]; aiCalls: string[] }> {
  const store = vectorStore({ VECTORIZE_FAKE: "{}" });
  await seed(store);
  const spy = spied(store);
  return {
    user: userDO(ALICE),
    registry: registry(),
    ai: spy.ai,
    vectors: spy.vectors,
    eligible: new Set(eligible),
    queries: spy.queries,
    aiCalls: spy.aiCalls,
  };
}

describe("answering a chat question", () => {
  it("refuses an episode the catalog does not hold, storing nothing", async () => {
    const d = await deps([CHANNEL_A]);
    const chat = await d.user.createChat();

    await expectDomainError(
      answer(d, {
        chatId: chat.chatId,
        message: "what about it?",
        aboutEpisodeId: EPISODE_C,
      }),
      "INVALID_INPUT",
    );

    expect(await d.user.getMessages(chat.chatId)).toEqual([]);
    expect(d.aiCalls).toEqual([]);
    expect(d.queries).toEqual([]);
  });

  it("answers the fixed reply with no follows, touching neither AI nor Vectorize", async () => {
    const d = await deps([]);
    const chat = await d.user.createChat();

    const { userMessage, assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "anything?",
    });

    expect(assistantMessage.content).toBe(NO_FOLLOWS_REPLY);
    expect(assistantMessage.status).toBe("completed");
    expect(assistantMessage.sources).toEqual([]);
    expect(userMessage.content).toBe("anything?");
    expect(d.aiCalls).toEqual([]);
    expect(d.queries).toEqual([]);
  });

  it("says an ineligible scope out loud rather than widening to everything", async () => {
    await seedApprovedChannel(CHANNEL_B, OWNER);
    await seedEpisode(EPISODE_B, CHANNEL_B);
    // The caller follows CHANNEL_A, but scoped a question to an episode of CHANNEL_B.
    const d = await deps([CHANNEL_A]);
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "what did they say?",
      aboutEpisodeId: EPISODE_B,
    });

    expect(assistantMessage.content).toBe(SCOPE_INELIGIBLE_REPLY);
    expect(assistantMessage.sources).toEqual([]);
    expect(d.aiCalls).toEqual([]);
    expect(d.queries).toEqual([]);
  });

  it("answers the empty reply when nothing validates, having asked Vectorize but not the model", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    // Stored under a generation the episode does not consider active.
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0, "gen-stale"),
      ]);
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "covered anywhere?",
    });

    expect(assistantMessage.content).toBe(NOTHING_FOUND_REPLY);
    expect(assistantMessage.sources).toEqual([]);
    expect(d.queries).toHaveLength(1);
    expect(d.aiCalls).toEqual(["embed"]);
  });

  it("answers from what survives, one source per chunk in score order", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0),
        chunkOf(EPISODE_A, CHANNEL_A, 1),
        chunkOf(EPISODE_A, CHANNEL_A, 2),
      ]);
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "what did they say about it?",
    });

    expect(assistantMessage.status).toBe("completed");
    expect(assistantMessage.promptVersion).toBe(CHAT_PROMPT_VERSION);
    expect(assistantMessage.truncated).toBe(false);
    // Three chunks of one episode are three citations: scoped, the only thing a source can carry
    // is *when*, and grouping them into one card is the reader's view, not the record.
    expect(assistantMessage.sources).toHaveLength(3);
    expect(assistantMessage.sources.map((s) => s.startSec)).toEqual([
      0, 60, 120,
    ]);
    for (const source of assistantMessage.sources) {
      expect(source).toMatchObject({
        episodeId: EPISODE_A,
        channelId: CHANNEL_A,
      });
    }
    // The prompt carries the transcript and never asks for a citation.
    const prompt = d.aiCalls.at(-1) ?? "";
    expect(prompt).toContain("transcript text 0");
    expect(prompt).not.toMatch(/cite|citation|\[1\]/i);
  });

  it("sizes the query by scope and never sends one unfiltered", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [chunkOf(EPISODE_A, CHANNEL_A, 0)]);
    });
    const chat = await d.user.createChat();

    await answer(d, { chatId: chat.chatId, message: "unscoped" });
    await answer(d, {
      chatId: chat.chatId,
      message: "scoped",
      aboutEpisodeId: EPISODE_A,
    });

    expect(d.queries[0]).toMatchObject({
      topK: UNSCOPED_CANDIDATES,
      filter: { channelId: { $in: [CHANNEL_A] } },
    });
    expect(d.queries[1]).toMatchObject({
      topK: SCOPED_CANDIDATES,
      filter: { episodeId: { $eq: EPISODE_A } },
    });
    for (const query of d.queries) {
      expect(query.filter).toBeDefined();
      expect(query.topK).toBeLessThanOrEqual(QUERY_TOP_K_MAX);
    }
  });

  it("skips a stale generation and promotes a deeper candidate in its place", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    await seedEpisode(EPISODE_B, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0, "gen-stale"),
        chunkOf(EPISODE_B, CHANNEL_A, 0),
      ]);
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "which one survives?",
    });

    expect(assistantMessage.sources.map((s) => s.episodeId)).toEqual([
      EPISODE_B,
    ]);
  });

  it("keeps at most the unscoped depth, counting chunks and not episodes", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    const ids = [EPISODE_A, EPISODE_B, EPISODE_C];
    for (const id of ids) await seedEpisode(id, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(
        SHARED_NAMESPACE,
        ids.flatMap((id) => [
          chunkOf(id, CHANNEL_A, 0),
          chunkOf(id, CHANNEL_A, 1),
        ]),
      );
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "everything",
    });

    // Six chunks across three episodes: the cap counts chunks, and every one is its own source.
    expect(assistantMessage.sources).toHaveLength(UNSCOPED_KEEP);
    expect(new Set(assistantMessage.sources.map((s) => s.episodeId)).size).toBe(
      ids.length,
    );
  });

  it("stores a truncated answer completed and trimmed, never failed", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [chunkOf(EPISODE_A, CHANNEL_A, 0)]);
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: `tell me everything ${FAKE_TRUNCATE}`,
    });

    expect(assistantMessage.status).toBe("completed");
    expect(assistantMessage.truncated).toBe(true);
    expect(assistantMessage.failureCode).toBeNull();
    expect(assistantMessage.content).toMatch(/[.!?]$/);
    expect(assistantMessage.sources).toHaveLength(1);
  });

  it("fails the reply with its own code when the embedding or the query does", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);

    // The embedding throws before any query is sent.
    const embed = await deps([CHANNEL_A]);
    embed.ai = ai({ AI_FAKE: '{"embedThrows":true}' });
    const chatA = await embed.user.createChat();
    const failedEmbed = await answer(embed, {
      chatId: chatA.chatId,
      message: "a question",
    });
    expect(failedEmbed.assistantMessage).toMatchObject({
      status: "failed",
      failureCode: "EMBEDDING_FAILED",
    });
    expect(failedEmbed.userMessage.status).toBe("completed");
    expect(embed.queries).toEqual([]);

    // The query throws after a successful embedding.
    const query = await deps([CHANNEL_A]);
    query.vectors = vectorStore({
      VECTORIZE_FAKE: JSON.stringify({ throwOn: ["query"] }),
    });
    const chatB = await query.user.createChat();
    const failedQuery = await answer(query, {
      chatId: chatB.chatId,
      message: "a question",
    });
    expect(failedQuery.assistantMessage).toMatchObject({
      status: "failed",
      failureCode: "RETRIEVAL_FAILED",
    });
    expect(failedQuery.userMessage.status).toBe("completed");
  });

  it("fails the reply when the model does, leaving the question completed", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [chunkOf(EPISODE_A, CHANNEL_A, 0)]);
    });
    const chat = await d.user.createChat();

    const { userMessage, assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: `a question ${FAKE_THROW}`,
    });

    expect(assistantMessage.status).toBe("failed");
    expect(assistantMessage.failureCode).toBe("MODEL_FAILED");
    expect(assistantMessage.promptVersion).toBeNull();
    expect(userMessage.status).toBe("completed");
  });
});

describe("trimming a cut-off answer", () => {
  it("cuts at the last complete sentence", () => {
    expect(trimToSentence("One. Two. And then the")).toBe("One. Two.");
    expect(trimToSentence("A question? Yes! But the")).toBe("A question? Yes!");
  });

  it("returns text with no sentence boundary unchanged, rather than blanking it", () => {
    expect(trimToSentence("a single unfinished clause that never")).toBe(
      "a single unfinished clause that never",
    );
    expect(trimToSentence("")).toBe("");
  });
});
