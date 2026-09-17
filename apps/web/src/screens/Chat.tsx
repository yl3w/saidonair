import type { ChatMessage as Message } from "@media-digest/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { ChatMessage } from "../components/ChatMessage";
import { Page } from "../components/Page";
import { ScopeChip, ScopeLine } from "../components/ScopeChip";
import { takeAskScope } from "../lib/ask-scope";
import { chatRow, episodeTitle } from "../lib/chat-rows";
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
  const { route } = useLocation();
  const chatId = params.chatId ?? null;
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  // Scope is component state and nothing is in the URL (owner decision 2026-09-16). `Ask` hands the
  // episode over through `lib/ask-scope.ts` for a chat that does not exist yet; an existing chat
  // recovers it from its own last question, below.
  const [scope, setScope] = useState<string | null>(() => takeAskScope());
  const [scoped] = useLoad(
    async () =>
      scope === null ? null : (await api.getEpisodeById(scope)).episode,
    [scope],
  );
  const episode = scoped.status === "ready" ? scoped.data : null;
  const scopedTitle = episode?.title ?? null;

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
        // composer the reader has already left behind. Scope rides in state across this, so the
        // URL is the chat and nothing else.
        route(`/chats/${id}`, true);
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

  // The rail names chats the way `/chats` does — by their first question, because `chats.title` is
  // never set and reading it would render every chat as "Untitled chat".
  const [rail] = useLoad(
    async () => Promise.all((await api.listChats()).chats.map(chatRow)),
    [],
  );
  const messages = load.status === "ready" ? load.data.messages : [];
  const scopeTitles = useScopeTitles(messages);

  /**
   * **A reload picks the scope back up from the last question** (owner decision 2026-09-16). Each
   * question stores its own `aboutEpisodeId`, so the conversation is the record of what it is
   * currently searching and no URL parameter is needed to survive a refresh.
   *
   * Seeded once, deliberately. `reload()` after every send would otherwise undo a dismissal — the
   * reader clears the chip, asks a wide question, and the next load would put the chip back from
   * the question before it. Within a session the reader's last gesture wins; across a reload the
   * conversation does.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || load.status !== "ready" || chatId === null) return;
    seeded.current = true;
    const asked = [...load.data.messages]
      .reverse()
      .find((message) => message.role === "user");
    setScope(asked?.aboutEpisodeId ?? null);
  }, [load, chatId]);
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
        <nav aria-label="Your chats">
          <div class="border-t border-rule">
            {(rail.status === "ready" ? rail.data : []).map((row) => (
              <a
                key={row.chat.chatId}
                href={`/chats/${row.chat.chatId}`}
                class="block border-b border-rule py-3"
                aria-current={row.chat.chatId === chatId ? "page" : undefined}
              >
                <span
                  class={`block font-reading text-ui leading-tight ${
                    row.chat.chatId === chatId
                      ? "font-semibold text-ink"
                      : "text-ink-2"
                  }`}
                >
                  {row.name}
                </span>
                <span class="mt-1 block text-meta text-ink-3">
                  {relativeTime(row.chat.updatedAt)}
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
          episodeTitle={
            message.aboutEpisodeId === null
              ? null
              : (scopeTitles.get(message.aboutEpisodeId) ?? null)
          }
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

      {messages.length === 0 && load.status === "ready" && (
        <div class="mb-8">
          <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
            {scopedTitle === null
              ? "Ask across everything you follow"
              : `Ask about ${scopedTitle}`}
          </h1>
          {episode !== null && (
            <p class="mt-1.5 text-meta text-ink-3">{episode.channelTitle}</p>
          )}
        </div>
      )}

      <div
        class={messages.length === 0 ? "" : "mt-7 border-t border-rule pt-4"}
      >
        <ScopeChip
          episodeTitle={scopedTitle}
          onDismiss={() => setScope(null)}
        />
        <textarea
          class="textarea w-full resize-none rounded-box border-edge bg-panel font-reading text-body text-ink"
          rows={3}
          placeholder={ASK_PLACEHOLDER_COPY}
          value={draft}
          disabled={sending}
          onInput={(event) => setDraft(event.currentTarget.value)}
          // Enter sends, Shift+Enter breaks the line. Without it the only way to ask is the mouse.
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div class="mt-2.5 flex items-center justify-between gap-4">
          <ScopeLine scoped={scope !== null} />
          <button
            type="button"
            class="btn btn-sm min-h-11 shrink-0 border-edge bg-primary text-ui text-panel"
            disabled={sending || draft.trim().length === 0}
            onClick={() => void send()}
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </Page>
  );
}

/**
 * The titles of every episode this conversation's questions were scoped to, resolved once.
 *
 * Sources hang on the reply rather than the question, so a title usually comes from whichever reply
 * cited that episode — but **a refusal, a nothing-found and a failure all cite nothing**, which is
 * exactly where the reader most needs to know which episode it was about. Those are fetched by id
 * (`lib/chat-rows.ts`), the same fallback `/chats` already uses for its origin line.
 */
function useScopeTitles(messages: readonly Message[]): Map<string, string> {
  const scopes = [
    ...new Set(
      messages
        .map((message) => message.aboutEpisodeId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const key = scopes.join(",");
  const [titles] = useLoad(async () => {
    const resolved = await Promise.all(
      scopes.map(async (id) => [id, await episodeTitle(id, messages)] as const),
    );
    return new Map(
      resolved.filter((pair): pair is [string, string] => pair[1] !== null),
    );
  }, [key]);
  return titles.status === "ready" ? titles.data : new Map();
}
