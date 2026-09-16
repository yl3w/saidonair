import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  appendExchange,
  CHAT_ANSWER_BUDGET_MS,
  createChat,
} from "../src/do/user/chats";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  EPISODE_A,
  EPISODE_B,
  expectDomainError,
  userDO,
} from "./helpers";

const SOURCE_A = {
  episodeId: EPISODE_A,
  channelId: CHANNEL_A,
  episodeTitle: "Video A",
  channelTitle: "Channel A",
  startSec: 12.5,
};
const SOURCE_B = {
  ...SOURCE_A,
  episodeId: EPISODE_B,
  episodeTitle: "Video B",
  startSec: 0,
};

describe("user chats", () => {
  it("creates chats with an optional title", async () => {
    const stub = userDO(ALICE);
    const untitled = await stub.createChat();
    const titled = await stub.createChat("  Planning  ");

    expect(untitled.title).toBeNull();
    expect(titled.title).toBe("Planning");
    expect(await stub.getMessages(untitled.chatId)).toEqual([]);
  });

  // Criteria 3-6: the episode scope hint belongs to the question, never to the reply
  // (docs/PRD.md §4.5; docs/specs/chat-origin-scope.md §4.2).
  it("stores an episode scope hint on the question and never on the reply", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const scoped = await stub.appendExchange(
      chat.chatId,
      "what did they say?",
      EPISODE_A,
    );

    expect(scoped.userMessage.aboutEpisodeId).toBe(EPISODE_A);
    expect(scoped.assistantMessage.aboutEpisodeId).toBeNull();

    const messages = await stub.getMessages(chat.chatId);
    expect(messages.map((message) => message.aboutEpisodeId)).toEqual([
      EPISODE_A,
      null,
    ]);
  });

  it("leaves both messages unscoped when no hint is given", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const global = await stub.appendExchange(chat.chatId, "anything at all");

    expect(global.userMessage.aboutEpisodeId).toBeNull();
    expect(global.assistantMessage.aboutEpisodeId).toBeNull();
  });

  // Criterion 5: a malformed hint is rejected before anything is written, so a bad
  // aboutEpisodeId cannot leave a half-written exchange behind.
  it("rejects a malformed episode hint and writes nothing", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();

    await expectDomainError(
      stub.appendExchange(chat.chatId, "scoped to junk", "not-an-episode"),
      "INVALID_INPUT",
    );

    expect(await stub.getMessages(chat.chatId)).toEqual([]);
  });

  // Criterion 7: a chat from another user is simply absent in this object.
  it("returns one chat by id, and NOT_FOUND for anyone else's", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat("Alice's chat");

    expect(await stub.getChat(chat.chatId)).toEqual(chat);
    await expectDomainError(userDO(BOB).getChat(chat.chatId), "NOT_FOUND");
  });

  it("orders chats by most recent activity", async () => {
    const stub = userDO(ALICE);
    const ids = await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      const older = createChat(sql, "older", 1_000);
      const newer = createChat(sql, "newer", 2_000);
      appendExchange(sql, older.chatId, "wakes the older chat", 3_000);
      return { older: older.chatId, newer: newer.chatId };
    });

    expect((await stub.listChats()).map((c) => c.chatId)).toEqual([
      ids.older,
      ids.newer,
    ]);
  });

  it("appendExchange stores a completed question and a pending reply in sequence", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();

    const first = await stub.appendExchange(
      chat.chatId,
      "  What changed this week?  ",
    );
    expect(first.userMessage).toMatchObject({
      chatId: chat.chatId,
      sequenceNumber: 0,
      role: "user",
      status: "completed",
      content: "What changed this week?",
      replyToMessageId: null,
      channelId: null,
      sources: [],
    });
    expect(first.assistantMessage).toMatchObject({
      sequenceNumber: 1,
      role: "assistant",
      status: "pending",
      content: "",
      replyToMessageId: first.userMessage.messageId,
      sources: [],
    });

    const second = await stub.appendExchange(chat.chatId, "Anything else?");
    expect(second.userMessage.sequenceNumber).toBe(2);
    expect(second.assistantMessage.sequenceNumber).toBe(3);
    expect(await stub.getMessages(chat.chatId)).toHaveLength(4);
  });

  it("completes a pending reply with ordered citation snapshots, exactly once", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const { assistantMessage, userMessage } = await stub.appendExchange(
      chat.chatId,
      "q",
    );

    const completed = await stub.completeAssistantMessage(
      assistantMessage.messageId,
      "Two videos covered it.",
      [SOURCE_A, SOURCE_B],
      "2026-09-16",
      false,
    );
    expect(completed).toMatchObject({
      status: "completed",
      content: "Two videos covered it.",
    });
    expect(
      completed.sources.map((s) => [s.position, s.episodeId, s.startSec]),
    ).toEqual([
      [0, EPISODE_A, 12.5],
      [1, EPISODE_B, 0],
    ]);

    const history = await stub.getMessages(chat.chatId);
    expect(history.map((m) => m.sources.length)).toEqual([0, 2]);

    await expectDomainError(
      stub.completeAssistantMessage(
        assistantMessage.messageId,
        "again",
        [],
        "2026-09-16",
        false,
      ),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.completeAssistantMessage(
        userMessage.messageId,
        "not a reply",
        [],
        "2026-09-16",
        false,
      ),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.failAssistantMessage("missing", "X"),
      "NOT_FOUND",
    );
  });

  it("fails a pending reply with a reason and leaves the question intact", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const { assistantMessage } = await stub.appendExchange(chat.chatId, "q");

    const failed = await stub.failAssistantMessage(
      assistantMessage.messageId,
      "AI_ERROR",
    );
    expect(failed).toMatchObject({
      status: "failed",
      failureCode: "AI_ERROR",
      content: "",
    });
    expect((await stub.getMessages(chat.chatId)).map((m) => m.status)).toEqual([
      "completed",
      "failed",
    ]);
    await expectDomainError(
      stub.completeAssistantMessage(
        assistantMessage.messageId,
        "late",
        [],
        "2026-09-16",
        false,
      ),
      "INVALID_STATE",
    );
  });

  it("rejects an invalid source without persisting anything", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const { assistantMessage } = await stub.appendExchange(chat.chatId, "q");

    await expectDomainError(
      stub.completeAssistantMessage(
        assistantMessage.messageId,
        "answer",
        [SOURCE_A, { ...SOURCE_B, startSec: -1 }],
        "2026-09-16",
        false,
      ),
      "INVALID_INPUT",
    );

    const [, reply] = await stub.getMessages(chat.chatId);
    expect(reply).toMatchObject({
      status: "pending",
      content: "",
      sources: [],
    });
  });

  it("returns the last `limit` messages in conversation order", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    for (const question of ["one", "two", "three"]) {
      await stub.appendExchange(chat.chatId, question);
    }

    const tail = await stub.getMessages(chat.chatId, 4);
    expect(tail.map((m) => m.sequenceNumber)).toEqual([2, 3, 4, 5]);
    expect(tail[0]?.content).toBe("two");

    await expectDomainError(stub.getMessages(chat.chatId, 0), "INVALID_INPUT");
    await expectDomainError(
      stub.getMessages(chat.chatId, 500),
      "INVALID_INPUT",
    );
  });

  it("validates content and hides other users' chats", async () => {
    const alice = userDO(ALICE);
    const chat = await alice.createChat();

    await expectDomainError(
      alice.appendExchange(chat.chatId, "   "),
      "INVALID_INPUT",
    );
    await expectDomainError(alice.appendExchange("missing", "q"), "NOT_FOUND");
    await expectDomainError(alice.createChat("x".repeat(201)), "INVALID_INPUT");

    await expectDomainError(userDO(BOB).getMessages(chat.chatId), "NOT_FOUND");
    await expectDomainError(
      userDO(BOB).appendExchange(chat.chatId, "q"),
      "NOT_FOUND",
    );
    expect(await userDO(BOB).listChats()).toEqual([]);
  });
});

describe("a reply that outlived its request", () => {
  it("reads as failed once past the budget, and stays pending before it", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const fresh = await stub.appendExchange(chat.chatId, "just asked");

    // Nothing polls, so a reply is only noticed on the next read.
    expect((await stub.getMessages(chat.chatId)).map((m) => m.status)).toEqual([
      "completed",
      "pending",
    ]);

    const stale = await stub.appendExchange(chat.chatId, "asked long ago");
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec(
        "UPDATE chat_messages SET created_at = ? WHERE message_id = ?",
        Date.now() - CHAT_ANSWER_BUDGET_MS - 1,
        stale.assistantMessage.messageId,
      );
    });

    const messages = await stub.getMessages(chat.chatId);
    const byId = new Map(messages.map((m) => [m.messageId, m]));
    expect(byId.get(stale.assistantMessage.messageId)).toMatchObject({
      status: "failed",
      failureCode: "ANSWER_TIMEOUT",
    });
    // The question it answered is untouched, and the younger reply is still waiting.
    expect(byId.get(stale.userMessage.messageId)?.status).toBe("completed");
    expect(byId.get(fresh.assistantMessage.messageId)?.status).toBe("pending");
  });
});
