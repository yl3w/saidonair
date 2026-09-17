import { describe, expect, it } from "vitest";
import {
  ai,
  FAKE_IRRELEVANT,
  FAKE_RERANK_THROW,
  FAKE_THROW,
  FAKE_TRUNCATE,
} from "../src/lib/ai";
import {
  answer,
  type ChatDeps,
  NO_FOLLOWS_REPLY,
  NOTHING_FOUND_REPLY,
  SCOPE_INELIGIBLE_REPLY,
  SCOPE_NOTHING_FOUND_REPLY,
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
  text = `transcript text ${index}`,
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
      text,
      publishedAt: 1_000,
    },
  };
}

/** Wraps the fakes so a test can assert a branch called neither of them. */
function spied(
  vectors: VectorStore,
  rerank?: (query: string, passages: readonly string[]) => Promise<number[]>,
) {
  const queries: QueryOptions[] = [];
  const aiCalls: string[] = [];
  /** The passages each rerank call saw, so a test can prove it was handed every candidate. */
  const reranked: readonly string[][] = [];
  const client = ai({ AI_FAKE: "{}" });
  return {
    queries,
    aiCalls,
    reranked,
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
      async rerank(query: string, passages: readonly string[]) {
        (reranked as string[][]).push([...passages]);
        return (rerank ?? client.rerank)(query, passages);
      },
    },
  };
}

async function deps(
  eligible: string[],
  seed: (store: VectorStore) => Promise<void> = async () => {},
  rerank?: (query: string, passages: readonly string[]) => Promise<number[]>,
): Promise<
  ChatDeps & {
    queries: QueryOptions[];
    aiCalls: string[];
    reranked: readonly string[][];
  }
> {
  const store = vectorStore({ VECTORIZE_FAKE: "{}" });
  await seed(store);
  const spy = spied(store, rerank);
  return {
    user: userDO(ALICE),
    registry: registry(),
    ai: spy.ai,
    vectors: spy.vectors,
    eligible: new Set(eligible),
    queries: spy.queries,
    aiCalls: spy.aiCalls,
    reranked: spy.reranked,
  };
}

/** Captures the structured log lines a branch writes, and always restores `console.log`. */
async function captureLog<T>(
  run: () => Promise<T>,
): Promise<{ result: T; lines: Record<string, unknown>[] }> {
  const lines: Record<string, unknown>[] = [];
  const log = console.log;
  console.log = (entry: unknown) => {
    if (typeof entry === "object" && entry !== null) {
      lines.push(entry as Record<string, unknown>);
    }
  };
  try {
    return { result: await run(), lines };
  } finally {
    console.log = log;
  }
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

describe("a stored hint outlives the follow it was asked under", () => {
  it("is unchanged after the reader unfollows and follows again", async () => {
    const reg = registry();
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    await reg.recordFollow(ALICE, CHANNEL_A);

    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [chunkOf(EPISODE_A, CHANNEL_A, 0)]);
    });
    const chat = await d.user.createChat();
    const { userMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "what did they say?",
      aboutEpisodeId: EPISODE_A,
    });
    expect(userMessage.aboutEpisodeId).toBe(EPISODE_A);

    // Eligibility is recomputed per message, so the next question would be refused — but the
    // question already asked keeps the scope it was sent under. History is never scrubbed
    // (docs/PRD.md §4.5).
    await reg.recordUnfollow(ALICE, CHANNEL_A);
    const afterUnfollow = await d.user.getMessages(chat.chatId);
    expect(afterUnfollow[0]?.aboutEpisodeId).toBe(EPISODE_A);
    expect(afterUnfollow[0]?.sources).toEqual(userMessage.sources);

    await reg.recordFollow(ALICE, CHANNEL_A);
    const afterRefollow = await d.user.getMessages(chat.chatId);
    expect(afterRefollow[0]?.aboutEpisodeId).toBe(EPISODE_A);
    // And the reply's citation snapshots are the ones taken when it was written, not re-derived.
    expect(afterRefollow[1]?.sources).toEqual(afterUnfollow[1]?.sources);
  });
});

describe("relevance (docs/specs/chat-relevance-rerank.md)", () => {
  /** Ten episodes, one chunk each: more candidates than any keep count. Ids are 11 characters,
      as every episode id in this product is (`lib/youtube/ids.ts`). */
  const TEN = Array.from({ length: 10 }, (_, i) => `relevance-${i}`);

  async function tenEpisodes() {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    for (const id of TEN) await seedEpisode(id, CHANNEL_A);
  }

  it("reranks every validated candidate, not the first few", async () => {
    await tenEpisodes();
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(
        SHARED_NAMESPACE,
        TEN.map((id) => chunkOf(id, CHANNEL_A, 0)),
      );
    });
    const chat = await d.user.createChat();

    await answer(d, { chatId: chat.chatId, message: "across everything" });

    // Ten validated, six kept: the reranker must see all ten or the chunk that matters most can
    // never climb into the answer, which is the defect this exists for.
    expect(d.reranked).toHaveLength(1);
    expect(d.reranked[0]).toHaveLength(10);
  });

  it("stores sources in rerank order, not the order the vector query returned", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    // Exactly inverts the candidate order, so an implementation that kept vector order passes
    // nothing here by accident.
    const d = await deps(
      [CHANNEL_A],
      async (store) => {
        await store.upsert(SHARED_NAMESPACE, [
          chunkOf(EPISODE_A, CHANNEL_A, 0),
          chunkOf(EPISODE_A, CHANNEL_A, 1),
          chunkOf(EPISODE_A, CHANNEL_A, 2),
        ]);
      },
      async (_query, passages) => passages.map((_, i) => (i + 1) / 10),
    );
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "what did they say?",
    });

    expect(assistantMessage.sources.map((s) => s.startSec)).toEqual([
      120, 60, 0,
    ]);
  });

  it("drops a chunk below the floor from the sources and from the prompt", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0),
        chunkOf(
          EPISODE_A,
          CHANNEL_A,
          1,
          undefined,
          `off topic ${FAKE_IRRELEVANT}`,
        ),
        chunkOf(EPISODE_A, CHANNEL_A, 2),
      ]);
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "what did they say?",
    });

    expect(assistantMessage.status).toBe("completed");
    expect(assistantMessage.sources.map((s) => s.startSec)).toEqual([0, 120]);
    expect(d.aiCalls.at(-1) ?? "").not.toContain("off topic");
  });

  it("answers the unscoped sentence when nothing clears the floor, without asking the model", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0, undefined, `a ${FAKE_IRRELEVANT}`),
        chunkOf(EPISODE_A, CHANNEL_A, 1, undefined, `b ${FAKE_IRRELEVANT}`),
      ]);
    });
    const chat = await d.user.createChat();

    const { result, lines } = await captureLog(() =>
      answer(d, { chatId: chat.chatId, message: "about something else" }),
    );

    expect(result.assistantMessage.content).toBe(NOTHING_FOUND_REPLY);
    expect(result.assistantMessage.sources).toEqual([]);
    // Vectorize was called and the answering model was not — the one observable difference
    // between this outcome and an empty catalog.
    expect(d.queries).toHaveLength(1);
    expect(d.aiCalls).toEqual(["embed"]);
    // A third reason for one sentence, kept distinguishable in logs from the other two.
    expect(lines.map((l) => l.event)).toContain("chat.below_floor");
  });

  it("answers the scoped sentence for a scoped question, naming the episode and not the follows", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0, undefined, `a ${FAKE_IRRELEVANT}`),
      ]);
    });
    const chat = await d.user.createChat();

    const { assistantMessage } = await answer(d, {
      chatId: chat.chatId,
      message: "something this episode never covers",
      aboutEpisodeId: EPISODE_A,
    });

    expect(assistantMessage.content).toBe(SCOPE_NOTHING_FOUND_REPLY);
    // The assertion that would pass either way if the two shared a sentence.
    expect(assistantMessage.content).not.toBe(NOTHING_FOUND_REPLY);
    expect(assistantMessage.sources).toEqual([]);
  });

  it("answers from vector order when the reranker fails, and never fails the reply", async () => {
    await tenEpisodes();
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(
        SHARED_NAMESPACE,
        TEN.map((id) => chunkOf(id, CHANNEL_A, 0)),
      );
    });
    const chat = await d.user.createChat();

    const { result, lines } = await captureLog(() =>
      answer(d, {
        chatId: chat.chatId,
        // Its own marker: FAKE_THROW here would fail the answering call too, and the fallback
        // under test would never run.
        message: `across everything ${FAKE_RERANK_THROW}`,
      }),
    );

    expect(result.assistantMessage.status).toBe("completed");
    expect(result.assistantMessage.failureCode).toBeNull();
    // Exactly the behaviour that predates the reranker: vector order, cut at the keep count.
    expect(result.assistantMessage.sources).toHaveLength(UNSCOPED_KEEP);
    expect(result.assistantMessage.sources.map((s) => s.episodeId)).toEqual(
      TEN.slice(0, UNSCOPED_KEEP),
    );
    const failed = lines.find((l) => l.event === "chat.rerank_failed");
    expect(failed).toMatchObject({ validated: 10 });
  });

  it("logs the scores it ranked by, and no text", async () => {
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    const d = await deps([CHANNEL_A], async (store) => {
      await store.upsert(SHARED_NAMESPACE, [
        chunkOf(EPISODE_A, CHANNEL_A, 0),
        chunkOf(EPISODE_A, CHANNEL_A, 1),
      ]);
    });
    const chat = await d.user.createChat();

    const { lines } = await captureLog(() =>
      answer(d, { chatId: chat.chatId, message: "a question" }),
    );

    const entry = lines.find((l) => l.event === "chat.reranked");
    expect(entry).toMatchObject({
      scoped: false,
      validated: 2,
      aboveFloor: 2,
      kept: 2,
      topScore: 1,
    });
    // No question and no transcript ever reaches a log (docs/PRD.md §1).
    const text = JSON.stringify(entry);
    expect(text).not.toContain("a question");
    expect(text).not.toContain("transcript text");
  });
});
