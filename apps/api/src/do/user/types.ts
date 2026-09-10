import type { ChatMessageStatus, ChatRole } from "@media-digest/shared";

export type ChannelFollow = {
  channelId: string;
  followedAt: number;
  /** Set on unfollow and retained as a tombstone; null while the follow is active. */
  unfollowedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ListFollowsOptions = {
  /** Include unfollow tombstones. Defaults to active follows only. */
  includeUnfollowed?: boolean;
};

export type Chat = {
  chatId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessageSource = {
  sourceId: string;
  position: number;
  videoId: string;
  channelId: string;
  videoTitle: string;
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
