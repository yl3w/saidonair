import type { Chat, ChatMessage } from "@media-digest/shared";
import { api } from "../api";

/**
 * A chat as a list shows it (docs/specs/design-phase.md §4.9). **A chat is named by its first
 * question** — `chats.title` is never set, because no route sets it, and reading it would render
 * every chat made through the web as "Untitled chat". The name is the question itself.
 *
 * Origin is the first question's scope. Sources hang on the reply rather than the question, so the
 * episode's title comes from whichever reply cited it, and only when none did — which is what a
 * refusal looks like — is the episode fetched by id.
 */
export type ChatRow = {
  chat: Chat;
  name: string;
  origin: string | null;
  messages: number;
};

export async function chatRow(chat: Chat): Promise<ChatRow> {
  const { messages } = await api.getChatMessages(chat.chatId);
  const asked = messages.find((message) => message.role === "user");
  return {
    chat,
    name: chat.title ?? asked?.content ?? "A new chat",
    origin: await originOf(asked ?? null, messages),
    messages: messages.length,
  };
}

async function originOf(
  asked: ChatMessage | null,
  messages: readonly ChatMessage[],
): Promise<string | null> {
  const scope = asked?.aboutEpisodeId ?? null;
  if (scope === null) return null;
  return episodeTitle(scope, messages);
}

/**
 * The title of a scoped episode: from a reply that cited it, else fetched. One request, and only in
 * the case where no reply cited anything — a refusal, a nothing-found, or a failure — which is
 * exactly where the reader most needs to know which episode it was about.
 */
export async function episodeTitle(
  episodeId: string,
  messages: readonly ChatMessage[],
): Promise<string | null> {
  const cited = messages
    .flatMap((message) => message.sources)
    .find((source) => source.episodeId === episodeId);
  if (cited !== undefined) return cited.episodeTitle;
  try {
    return (await api.getEpisodeById(episodeId)).episode.title;
  } catch {
    // An episode the catalog no longer holds names nothing rather than failing the screen.
    return null;
  }
}
