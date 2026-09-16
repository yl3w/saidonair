import type { ChatMessageStatus, ChatRole } from "@media-digest/shared";

export type Chat = {
  chatId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessageSource = {
  sourceId: string;
  position: number;
  episodeId: string;
  channelId: string;
  episodeTitle: string;
  channelTitle: string;
  startSec: number;
};

export type ChatMessageSourceInput = Omit<
  ChatMessageSource,
  "sourceId" | "position"
>;

export type ChatMessage = {
  messageId: string;
  chatId: string;
  sequenceNumber: number;
  role: ChatRole;
  /** Empty while an assistant reply is pending. */
  content: string;
  status: ChatMessageStatus;
  failureCode: string | null;
  replyToMessageId: string | null;
  /** Always null for today's global chats; reserved for a future scoped view. */
  channelId: string | null;
  /** The episode this question was scoped to, or null for a global one (docs/PRD.md §4.5). */
  aboutEpisodeId: string | null;
  /** The chat prompt that produced this reply; null on a question and on a failed reply. */
  promptVersion: string | null;
  /** Whether this reply hit the model's output cap and was trimmed; null on a question. */
  truncated: boolean | null;
  sources: ChatMessageSource[];
  createdAt: number;
  updatedAt: number;
};

/** Result of `appendExchange`: the stored question and its pending reply. */
export type Exchange = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

export type UserPreferences = {
  systemRules: string;
  /** null until the user has saved preferences at least once. */
  updatedAt: number | null;
};
