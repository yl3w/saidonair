import { SELF } from "cloudflare:test";
import {
  ChatExchangeResponseSchema,
  ChatMessagesResponseSchema,
  ChatResponseSchema,
  ChatsResponseSchema,
} from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import { ALICE, BOB, EPISODE_A, expectShape, userDO } from "./helpers";

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

describe("chat routes", () => {
  it("creates a chat, lists it, and rejects an over-long title", async () => {
    const created = await call(ALICE, "POST", "/chats", { title: "  Rates  " });
    expect(created.status).toBe(201);
    expectShape(ChatResponseSchema, created.json);
    expect(created.json.chat).toMatchObject({ title: "Rates" });

    const listed = await call(ALICE, "GET", "/chats");
    expect(listed.status).toBe(200);
    expectShape(ChatsResponseSchema, listed.json);
    expect((listed.json.chats as Json[]).map((chat) => chat.chatId)).toContain(
      (created.json.chat as Json).chatId,
    );

    expect(
      (await call(ALICE, "POST", "/chats", { title: "x".repeat(201) })).status,
    ).toBe(400);
  });

  it("lists most recently updated first", async () => {
    const older = (await call(BOB, "POST", "/chats", { title: "older" })).json
      .chat as Json;
    const newer = (await call(BOB, "POST", "/chats", { title: "newer" })).json
      .chat as Json;

    // An exchange touches the chat, so the older one returns to the top.
    await userDO(BOB).appendExchange(older.chatId as string, "wakes it");

    const chats = (await call(BOB, "GET", "/chats")).json.chats as Json[];
    expect(chats.slice(0, 2).map((chat) => chat.chatId)).toEqual([
      older.chatId,
      newer.chatId,
    ]);
  });

  it("returns a chat's messages in order, with sources and the scope each was sent under", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat("Scoped");
    await stub.appendExchange(chat.chatId, "what did they say?", EPISODE_A);

    const response = await call(ALICE, "GET", `/chats/${chat.chatId}/messages`);
    expect(response.status).toBe(200);
    expectShape(ChatMessagesResponseSchema, response.json);
    expect((response.json.chat as Json).chatId).toBe(chat.chatId);

    const messages = response.json.messages as Json[];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages.map((message) => message.aboutEpisodeId)).toEqual([
      EPISODE_A,
      null,
    ]);
    expect(messages[0]).not.toHaveProperty("channelId");
    expect(messages[1]).toMatchObject({ status: "pending", sources: [] });
  });

  it("honours limit and rejects one past the cap", async () => {
    const stub = userDO(ALICE);
    const chat = await stub.createChat();
    await stub.appendExchange(chat.chatId, "first");
    await stub.appendExchange(chat.chatId, "second");

    const limited = await call(
      ALICE,
      "GET",
      `/chats/${chat.chatId}/messages?limit=1`,
    );
    expect((limited.json.messages as Json[]).length).toBe(1);

    expect(
      (await call(ALICE, "GET", `/chats/${chat.chatId}/messages`)).json
        .messages,
    ).toHaveLength(4);
    expect(
      (await call(ALICE, "GET", `/chats/${chat.chatId}/messages?limit=201`))
        .status,
    ).toBe(400);
  });

  it("keeps one caller's chats out of another's, hence 404 and never 403", async () => {
    const alices = await userDO(ALICE).createChat("Alice's");

    expect(
      (await call(BOB, "GET", `/chats/${alices.chatId}/messages`)).status,
    ).toBe(404);
    expect(
      ((await call(BOB, "GET", "/chats")).json.chats as Json[]).map(
        (chat) => chat.chatId,
      ),
    ).not.toContain(alices.chatId);
    expect((await call(ALICE, "GET", "/chats/nope/messages")).status).toBe(404);
  });
});

describe("asking a question", () => {
  it("answers 201 with the question and a finished reply", async () => {
    const chat = (await call(ALICE, "POST", "/chats")).json.chat as Json;

    const sent = await call(ALICE, "POST", `/chats/${chat.chatId}/messages`, {
      message: "what is covered?",
    });

    expect(sent.status).toBe(201);
    expectShape(ChatExchangeResponseSchema, sent.json);
    expect(sent.json.userMessage).toMatchObject({
      role: "user",
      content: "what is covered?",
      status: "completed",
      promptVersion: null,
    });
    // No follows, so the fixed reply of PRD §4.5 — complete in this one response, nothing to poll.
    const reply = sent.json.assistantMessage as Json;
    expect(reply.role).toBe("assistant");
    expect(reply.status).toBe("completed");
    expect(reply.content).toBe(
      "Chat requires following at least one approved channel.",
    );
    expect(reply.sources).toEqual([]);
  });

  it("rejects a blank question and an episode the catalog does not hold", async () => {
    const chat = (await call(ALICE, "POST", "/chats")).json.chat as Json;
    const path = `/chats/${chat.chatId}/messages`;

    expect((await call(ALICE, "POST", path, { message: "   " })).status).toBe(
      400,
    );
    expect((await call(ALICE, "POST", path, {})).status).toBe(400);
    expect(
      (
        await call(ALICE, "POST", path, {
          message: "scoped to nothing",
          aboutEpisodeId: "ccccccccccc",
        })
      ).status,
    ).toBe(400);

    // The refused question stored nothing: no orphan awaiting a reply.
    expect((await call(ALICE, "GET", `${path}`)).json.messages).toEqual([]);
  });

  it("is 404 for a chat that is not the caller's", async () => {
    const alices = (await call(ALICE, "POST", "/chats")).json.chat as Json;

    expect(
      (
        await call(BOB, "POST", `/chats/${alices.chatId}/messages`, {
          message: "let me in",
        })
      ).status,
    ).toBe(404);
  });
});
