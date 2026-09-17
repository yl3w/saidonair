import type { ChatMessage as Message } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { ChatMessage } from "../components/ChatMessage";
import { Page } from "../components/Page";
import { ScopeChip, ScopeLine } from "../components/ScopeChip";
import { ASK_PLACEHOLDER_COPY } from "../lib/copy";
import { relativeTime } from "../lib/time";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Chat() {
  return (
    <Guard>
      <ChatScreen />
    </Guard>
  );
}

/**
 * One conversation (docs/specs/m4-3-chat-web.md §3.3), and the composer before a chat exists.
 *
 * **The rail is the product's right rail, not a left sidebar.** The artboards drew it on the left,
 * which is the conventional chat shape and the wrong one here: `docs/design.md` §2.3 puts a rail on
 * the right at 232 px, `Page` already implements that and its `lg` breakpoint, and a second layout
 * model for one screen is a worse cost than an unconventional side. Below `lg` the rail is absent
 * entirely and the screen is the transcript, reached back through `/chats`.
 */
function ChatScreen() {
  const { params } = useRoute();
  const { url, route } = useLocation();
  const chatId = params.chatId ?? null;
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  // The chip lives in the URL, so a reload keeps it and a scoped chat is linkable. Reading it from
  // the location rather than from state is what makes that true (docs/specs/m4-3-chat-web.md §2).
  const scope = new URLSearchParams(url.split("?")[1] ?? "").get("about");
  const [scopeTitle] = useLoad(
    async () =>
      scope === null ? null : (await api.getEpisodeById(scope)).episode.title,
    [scope],
  );
  const scopedTitle = scopeTitle.status === "ready" ? scopeTitle.data : null;

  /** The first question mints the chat; every later one appends to it. */
  async function send() {
    const message = draft.trim();
    if (message.length === 0 || sending) return;
    setSending(true);
    try {
      const id = chatId ?? (await api.createChat()).chat.chatId;
      await api.sendMessage(id, {
        message,
        ...(scope === null ? {} : { aboutEpisodeId: scope }),
      });
      setDraft("");
      if (chatId === null) {
        // Replace, not push: Back belongs to the summary Ask was pressed on, never to an empty
        // composer the reader has already left behind.
        route(
          `/chats/${id}${scope === null ? "" : `?about=${encodeURIComponent(scope)}`}`,
          true,
        );
      } else {
        reload();
      }
    } finally {
      setSending(false);
    }
  }

  const [load, reload] = useLoad(
    async () => {
      if (chatId === null) return { messages: [] as Message[] };
      const { messages } = await api.getChatMessages(chatId);
      return { messages };
    },
    [chatId],
    { retainDataOnReload: true },
  );

  const [rail] = useLoad(async () => (await api.listChats()).chats, []);
  const messages = load.status === "ready" ? load.data.messages : [];
  const first = messages.find((message) => message.role === "user");
  useDocumentTitle(first?.content ?? "Chat");

  /** `Try again` resends the same question, with the same scope, as a new attempt (§4.9). */
  async function retry(question: Message) {
    if (chatId === null || sending) return;
    setSending(true);
    try {
      await api.sendMessage(chatId, {
        message: question.content,
        ...(question.aboutEpisodeId === null
          ? {}
          : { aboutEpisodeId: question.aboutEpisodeId }),
      });
      reload();
    } finally {
      setSending(false);
    }
  }

  return (
    <Page
      measure="reading"
      rail={
        <nav>
          <h2 class="mb-2 text-label uppercase tracking-label text-tertiary">
            Chats
          </h2>
          <div class="border-t border-rule">
            {(rail.status === "ready" ? rail.data : []).map((chat) => (
              <a
                key={chat.chatId}
                href={`/chats/${chat.chatId}`}
                class="block border-b border-rule py-3"
                aria-current={chat.chatId === chatId ? "page" : undefined}
              >
                <span
                  class={`block font-serif text-ui leading-tight ${
                    chat.chatId === chatId
                      ? "font-semibold text-ink"
                      : "text-secondary"
                  }`}
                >
                  {chat.title ?? "Untitled chat"}
                </span>
                <span class="mt-1 block text-meta text-tertiary">
                  {relativeTime(chat.updatedAt)}
                </span>
              </a>
            ))}
          </div>
        </nav>
      }
    >
      {load.status === "loading" && (
        <div class="flex flex-col gap-3">
          <div class="skeleton h-4 w-3/4" />
          <div class="skeleton h-4 w-full" />
        </div>
      )}

      {messages.map((message, index) => (
        <ChatMessage
          key={message.messageId}
          message={message}
          episodeTitle={titleFor(message, messages)}
          onRetry={
            message.status === "failed"
              ? () => {
                  const question = messages[index - 1];
                  if (question?.role === "user") void retry(question);
                }
              : undefined
          }
          retrying={sending}
        />
      ))}

      <div class="mt-7 border-t border-rule pt-4">
        <ScopeChip
          episodeTitle={scopedTitle}
          onDismiss={() =>
            route(chatId === null ? "/chats/new" : `/chats/${chatId}`, true)
          }
        />
        <div class="flex items-end gap-2.5">
          <textarea
            class="textarea min-h-11 w-full flex-1 rounded-card border-edge bg-panel font-serif text-body text-ink"
            rows={2}
            placeholder={ASK_PLACEHOLDER_COPY}
            value={draft}
            disabled={sending}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button
            type="button"
            class="btn btn-sm min-h-11 border-edge bg-primary text-ui text-panel"
            disabled={sending || draft.trim().length === 0}
            onClick={() => void send()}
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
        <ScopeLine scoped={scope !== null} />
      </div>
    </Page>
  );
}

/**
 * The title of the episode a question was scoped to. Sources hang on the reply rather than the
 * question, so it comes from whichever reply in this chat cited that episode; a refusal cites
 * nothing, and the mark then names no title rather than inventing one.
 */
function titleFor(
  message: Message,
  messages: readonly Message[],
): string | null {
  if (message.aboutEpisodeId === null) return null;
  return (
    messages
      .flatMap((other) => other.sources)
      .find((source) => source.episodeId === message.aboutEpisodeId)
      ?.episodeTitle ?? null
  );
}
