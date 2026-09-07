import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { appendExchange, createChat } from "../src/do/user/chats";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  expectDomainError,
  userDO,
  VIDEO_A,
  VIDEO_B,
} from "./helpers";

const SOURCE_A = {
  videoId: VIDEO_A,
  channelId: CHANNEL_A,
  videoTitle: "Video A",
  channelTitle: "Channel A",
  startSec: 12.5,
};
const SOURCE_B = {
  ...SOURCE_A,
  videoId: VIDEO_B,
  videoTitle: "Video B",
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
    );
    expect(completed).toMatchObject({
      status: "completed",
      content: "Two videos covered it.",
    });
    expect(
      completed.sources.map((s) => [s.position, s.videoId, s.startSec]),
    ).toEqual([
      [0, VIDEO_A, 12.5],
      [1, VIDEO_B, 0],
    ]);

    const history = await stub.getMessages(chat.chatId);
    expect(history.map((m) => m.sources.length)).toEqual([0, 2]);

    await expectDomainError(
      stub.completeAssistantMessage(assistantMessage.messageId, "again", []),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.completeAssistantMessage(userMessage.messageId, "not a reply", []),
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
      stub.completeAssistantMessage(assistantMessage.messageId, "late", []),
      "INVALID_STATE",
    );
  });

  it("rejects an invalid source without persisting anything", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    const { assistantMessage } = await stub.appendExchange(chat.chatId, "q");

    await expectDomainError(
      stub.completeAssistantMessage(assistantMessage.messageId, "answer", [
        SOURCE_A,
        { ...SOURCE_B, startSec: -1 },
      ]),
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
