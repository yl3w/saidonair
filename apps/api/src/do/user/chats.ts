import type { ChatMessageStatus, ChatRole } from "@media-digest/shared";
import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import { requireChannelId, requireEpisodeId } from "../../lib/youtube/ids";
import type {
  Chat,
  ChatMessage,
  ChatMessageSource,
  ChatMessageSourceInput,
  Exchange,
} from "./types";

type ChatRow = {
  chat_id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  message_id: string;
  chat_id: string;
  sequence_number: number;
  role: string;
  content: string;
  status: string;
  failure_code: string | null;
  reply_to_message_id: string | null;
  channel_id: string | null;
  created_at: number;
  updated_at: number;
};

type SourceRow = {
  source_id: string;
  message_id: string;
  position: number;
  episode_id: string;
  channel_id: string;
  episode_title: string;
  channel_title: string;
  start_sec: number;
};

const CHAT_COLUMNS = "chat_id, title, created_at, updated_at";
const MESSAGE_COLUMNS = `message_id, chat_id, sequence_number, role, content, status, failure_code,
  reply_to_message_id, channel_id, created_at, updated_at`;
const SOURCE_COLUMNS = `source_id, message_id, position, episode_id, channel_id, episode_title,
  channel_title, start_sec`;

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 8000;
const MAX_FAILURE_CODE_LENGTH = 64;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

export function createChat(
  sql: SqlStorage,
  title: string | undefined,
  now: number,
): Chat {
  const trimmed = title?.trim() ?? "";
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `title must be at most ${MAX_TITLE_LENGTH} characters`,
    );
  }
  return toChat(
    sql
      .exec<ChatRow>(
        `INSERT INTO chats (chat_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
         RETURNING ${CHAT_COLUMNS}`,
        crypto.randomUUID(),
        trimmed.length > 0 ? trimmed : null,
        now,
        now,
      )
      .one(),
  );
}

/** Most recently active first. */
export function listChats(sql: SqlStorage): Chat[] {
  return sql
    .exec<ChatRow>(
      `SELECT ${CHAT_COLUMNS} FROM chats ORDER BY updated_at DESC, chat_id`,
    )
    .toArray()
    .map(toChat);
}

/** The last `limit` messages of a chat in conversation order, with citation snapshots. */
export function getMessages(
  sql: SqlStorage,
  chatId: string,
  limit: number = DEFAULT_MESSAGE_LIMIT,
): ChatMessage[] {
  const chat = requireChat(sql, chatId);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_LIMIT) {
    throw new DomainError(
      "INVALID_INPUT",
      `limit must be an integer between 1 and ${MAX_MESSAGE_LIMIT}`,
    );
  }
  const rows = sql
    .exec<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE chat_id = ?
       ORDER BY sequence_number DESC LIMIT ?`,
      chat.chatId,
      limit,
    )
    .toArray()
    .reverse();
  return attachSources(sql, rows);
}

/**
 * First phase of an exchange: store the question as completed and its reply as pending,
 * in consecutive sequence numbers. The caller runs retrieval/generation and then calls
 * `completeAssistantMessage` or `failAssistantMessage`. Run inside a transaction.
 */
export function appendExchange(
  sql: SqlStorage,
  chatId: string,
  content: string,
  now: number,
): Exchange {
  const chat = requireChat(sql, chatId);
  const text = requireContent(content);
  const next = sql
    .exec<{ next: number }>(
      `SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next FROM chat_messages
       WHERE chat_id = ?`,
      chat.chatId,
    )
    .one().next;
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();

  sql.exec(
    `INSERT INTO chat_messages
       (message_id, chat_id, sequence_number, role, content, status, failure_code,
        reply_to_message_id, channel_id, created_at, updated_at)
     VALUES (?, ?, ?, 'user', ?, 'completed', NULL, NULL, NULL, ?, ?)`,
    userMessageId,
    chat.chatId,
    next,
    text,
    now,
    now,
  );
  sql.exec(
    `INSERT INTO chat_messages
       (message_id, chat_id, sequence_number, role, content, status, failure_code,
        reply_to_message_id, channel_id, created_at, updated_at)
     VALUES (?, ?, ?, 'assistant', '', 'pending', NULL, ?, NULL, ?, ?)`,
    assistantMessageId,
    chat.chatId,
    next + 1,
    userMessageId,
    now,
    now,
  );
  touchChat(sql, chat.chatId, now);

  return {
    userMessage: requireMessage(sql, userMessageId),
    assistantMessage: requireMessage(sql, assistantMessageId),
  };
}

/**
 * Second phase, success: store the reply text and its citation snapshots in order.
 * All sources are validated before anything is written. Run inside a transaction.
 */
export function completeAssistantMessage(
  sql: SqlStorage,
  messageId: string,
  content: string,
  sources: readonly ChatMessageSourceInput[],
  now: number,
): ChatMessage {
  const message = requirePendingAssistant(sql, messageId);
  const text = requireContent(content);
  const validated = sources.map(validateSource);

  validated.forEach((source, position) => {
    sql.exec(
      `INSERT INTO chat_message_sources
         (source_id, message_id, position, episode_id, channel_id, episode_title, channel_title,
          start_sec, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      message.messageId,
      position,
      source.episodeId,
      source.channelId,
      source.episodeTitle,
      source.channelTitle,
      source.startSec,
      now,
    );
  });
  sql.exec(
    `UPDATE chat_messages SET status = 'completed', content = ?, updated_at = ?
     WHERE message_id = ?`,
    text,
    now,
    message.messageId,
  );
  touchChat(sql, message.chatId, now);
  return requireMessage(sql, message.messageId);
}

/** Second phase, failure: the question stays; the reply records why it has no content. */
export function failAssistantMessage(
  sql: SqlStorage,
  messageId: string,
  failureCode: string,
  now: number,
): ChatMessage {
  const message = requirePendingAssistant(sql, messageId);
  const code = failureCode.trim();
  if (code.length === 0 || code.length > MAX_FAILURE_CODE_LENGTH) {
    throw new DomainError("INVALID_INPUT", "failureCode is required");
  }
  sql.exec(
    `UPDATE chat_messages SET status = 'failed', failure_code = ?, updated_at = ?
     WHERE message_id = ?`,
    code,
    now,
    message.messageId,
  );
  touchChat(sql, message.chatId, now);
  return requireMessage(sql, message.messageId);
}

/** A chat id from another user is simply absent in this object, hence NOT_FOUND. */
function requireChat(sql: SqlStorage, chatId: string): Chat {
  const row = sql
    .exec<ChatRow>(
      `SELECT ${CHAT_COLUMNS} FROM chats WHERE chat_id = ?`,
      chatId,
    )
    .toArray()[0];
  if (!row) throw new DomainError("NOT_FOUND", "chat not found");
  return toChat(row);
}

function requireMessage(sql: SqlStorage, messageId: string): ChatMessage {
  const row = sql
    .exec<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE message_id = ?`,
      messageId,
    )
    .toArray()[0];
  if (!row) throw new DomainError("NOT_FOUND", "message not found");
  const [message] = attachSources(sql, [row]);
  if (!message) throw new Error("attachSources dropped a message");
  return message;
}

function requirePendingAssistant(
  sql: SqlStorage,
  messageId: string,
): ChatMessage {
  const message = requireMessage(sql, messageId);
  if (message.role !== "assistant" || message.status !== "pending") {
    throw new DomainError(
      "INVALID_STATE",
      `message is a ${message.status} ${message.role} message, not a pending reply`,
    );
  }
  return message;
}

function attachSources(sql: SqlStorage, rows: MessageRow[]): ChatMessage[] {
  const sourcesByMessage = new Map<string, ChatMessageSource[]>();
  for (const batch of chunk(rows.map((row) => row.message_id))) {
    for (const source of sql.exec<SourceRow>(
      `SELECT ${SOURCE_COLUMNS} FROM chat_message_sources
       WHERE message_id IN (${placeholders(batch.length)})
       ORDER BY message_id, position`,
      ...batch,
    )) {
      const list = sourcesByMessage.get(source.message_id) ?? [];
      list.push(toSource(source));
      sourcesByMessage.set(source.message_id, list);
    }
  }
  return rows.map((row) =>
    toMessage(row, sourcesByMessage.get(row.message_id) ?? []),
  );
}

function touchChat(sql: SqlStorage, chatId: string, now: number): void {
  sql.exec("UPDATE chats SET updated_at = ? WHERE chat_id = ?", now, chatId);
}

function requireContent(raw: string): string {
  const text = raw.trim();
  if (text.length === 0) {
    throw new DomainError("INVALID_INPUT", "content is required");
  }
  if (text.length > MAX_CONTENT_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `content must be at most ${MAX_CONTENT_LENGTH} characters`,
    );
  }
  return text;
}

function validateSource(input: ChatMessageSourceInput): ChatMessageSourceInput {
  const episodeTitle = input.episodeTitle.trim();
  const channelTitle = input.channelTitle.trim();
  if (episodeTitle.length === 0 || channelTitle.length === 0) {
    throw new DomainError("INVALID_INPUT", "source titles are required");
  }
  if (!Number.isFinite(input.startSec) || input.startSec < 0) {
    throw new DomainError("INVALID_INPUT", "source startSec must be >= 0");
  }
  return {
    episodeId: requireEpisodeId(input.episodeId),
    channelId: requireChannelId(input.channelId),
    episodeTitle,
    channelTitle,
    startSec: input.startSec,
  };
}

function toChat(row: ChatRow): Chat {
  return {
    chatId: row.chat_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow, sources: ChatMessageSource[]): ChatMessage {
  return {
    messageId: row.message_id,
    chatId: row.chat_id,
    sequenceNumber: row.sequence_number,
    role: toRole(row.role),
    content: row.content,
    status: toStatus(row.status),
    failureCode: row.failure_code,
    replyToMessageId: row.reply_to_message_id,
    channelId: row.channel_id,
    sources,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSource(row: SourceRow): ChatMessageSource {
  return {
    sourceId: row.source_id,
    position: row.position,
    episodeId: row.episode_id,
    channelId: row.channel_id,
    episodeTitle: row.episode_title,
    channelTitle: row.channel_title,
    startSec: row.start_sec,
  };
}

function toRole(value: string): ChatRole {
  if (value === "user" || value === "assistant") return value;
  throw new Error(`unexpected chat_messages.role: ${value}`);
}

function toStatus(value: string): ChatMessageStatus {
  if (value === "pending" || value === "completed" || value === "failed") {
    return value;
  }
  throw new Error(`unexpected chat_messages.status: ${value}`);
}
