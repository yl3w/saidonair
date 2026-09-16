import {
  type ChatMessage,
  type ChatMessagesResponse,
  ChatMessagesResponseSchema,
  type ChatResponse,
  ChatResponseSchema,
  type ChatsResponse,
  ChatsResponseSchema,
  CreateChatBodySchema,
  LimitQuerySchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { ChatMessage as StoredMessage } from "../do/user/types";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

/**
 * The caller's own conversations (docs/PRD.md §4.5). Every chat resolves inside the caller's User
 * DO, so one caller can never read another's and no route checks a role. Asking a question is
 * `POST /chats/{chatId}/messages`, which arrives with the answering path in M4.2.
 *
 * Creation stays open here while the web offers it only from a summary: a chat begins at a summary
 * and nowhere else, and the web is the only gate (docs/specs/chat-origin-scope.md §4.1, PRD §9).
 */
export const chatRoutes = new Hono<AppEnv>()
  .post(
    "/",
    describeRoute({
      tags: ["chats"],
      summary: "Create a chat",
      description:
        "An empty conversation. The API accepts this from anywhere; the web offers it only from a summary, because a chat begins at one (docs/specs/chat-origin-scope.md).",
      responses: {
        201: jsonResponse(ChatResponseSchema, "The new chat."),
        ...errorResponses(),
      },
    }),
    validate("json", CreateChatBodySchema),
    async (c) =>
      c.json<ChatResponse>(
        { chat: await c.var.user.createChat(c.req.valid("json").title) },
        201,
      ),
  )

  .get(
    "/",
    describeRoute({
      tags: ["chats"],
      summary: "The caller's chats",
      description: "Most recently updated first.",
      responses: {
        200: jsonResponse(ChatsResponseSchema, "The caller's chats."),
        ...errorResponses(),
      },
    }),
    async (c) => c.json<ChatsResponse>({ chats: await c.var.user.listChats() }),
  )

  .get(
    "/:chatId/messages",
    describeRoute({
      tags: ["chats"],
      summary: "One chat's messages",
      description:
        "Ascending sequence, with the citation snapshots stored on each reply and the episode scope each question was sent under. `limit` keeps the most recent; it defaults to 50 and is capped at 200.",
      responses: {
        200: jsonResponse(
          ChatMessagesResponseSchema,
          "The chat and its messages.",
        ),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("query", LimitQuerySchema),
    async (c) => {
      const { chatId } = c.req.param();
      const chat = await c.var.user.getChat(chatId);
      const messages = await c.var.user.getMessages(
        chatId,
        c.req.valid("query").limit,
      );
      return c.json<ChatMessagesResponse>({
        chat,
        messages: messages.map(toMessage),
      });
    },
  );

/**
 * `channel_id` is stored but undocumented: it stays null for today's global chats and reserves a
 * future scoped view (docs/PRD.md §5.2), so it never reaches the wire.
 */
function toMessage(message: StoredMessage): ChatMessage {
  const { channelId: _channelId, ...wire } = message;
  return wire;
}
