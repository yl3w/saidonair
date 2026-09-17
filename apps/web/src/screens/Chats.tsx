import { api } from "../api";
import { Page } from "../components/Page";
import type { ChatRow } from "../lib/chat-rows";
import { chatRow } from "../lib/chat-rows";
import { CHATS_EMPTY_COPY, chatOriginCopy } from "../lib/copy";
import { dayKeyOf, dayLabel } from "../lib/day";
import { relativeTime } from "../lib/time";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Chats() {
  useDocumentTitle("Chats");
  return (
    <Guard>
      <ChatsScreen />
    </Guard>
  );
}

/**
 * Every conversation the reader has started (docs/specs/m4-3-chat-web.md §3.1), newest first and
 * grouped by the day it was last active.
 *
 * **Nothing here makes a chat.** A chat begins with Ask on a summary and nowhere else, so this
 * screen has no New chat, and the reader arrives with a question already asked (docs/PRD.md §9).
 * It also has no search and no delete, because no route provides either — three gaps
 * `docs/specs/design-phase.md` §4.9 records and M4 does not close.
 *
 * A chat's origin is its first message's scope rather than a field of its own: scope lives on
 * messages, so a chat whose chip was cleared before the first question honestly has none.
 */
function ChatsScreen() {
  const [load] = useLoad(async () => {
    const { chats } = await api.listChats();
    return Promise.all(chats.map(chatRow));
  }, []);

  return (
    <Page>
      {/* The bar above and the phone's tab bar below both say "Chats" and mark it current, and
          neither ever scrolls away, so a heading here would be a constant on the one screen it
          names — the rule docs/design.md §2.2 states as "the screens the frame does not name"
          (owner decision 2026-09-17). It stays in the document and leaves the screen: a page whose
          first heading is a day group has no name for anyone navigating by headings. */}
      <h1 class="sr-only">Chats</h1>

      {load.status === "loading" && (
        <div class="flex flex-col gap-4">
          <div class="skeleton h-5 w-80" />
          <div class="skeleton h-5 w-64" />
        </div>
      )}

      {load.status === "ready" && load.data.length === 0 && (
        <p class="max-w-prose font-serif text-body text-ink-2">
          {CHATS_EMPTY_COPY}
        </p>
      )}

      {load.status === "ready" && load.data.length > 0 && groups(load.data)}
    </Page>
  );
}

/** Rows under the day they were last active, in the order `GET /chats` already answers them. */
function groups(rows: readonly ChatRow[]) {
  const seen: string[] = [];
  const byDay = new Map<string, ChatRow[]>();
  for (const row of rows) {
    const key = dayKeyOf(row.chat.updatedAt);
    if (!byDay.has(key)) {
      byDay.set(key, []);
      seen.push(key);
    }
    byDay.get(key)?.push(row);
  }

  return seen.map((key) => (
    <section key={key} class="mb-7">
      <h2 class="mb-2 text-label uppercase text-ink-3">{dayLabel(key)}</h2>
      <div class="border-t border-rule">
        {(byDay.get(key) ?? []).map((row) => (
          <a
            key={row.chat.chatId}
            href={`/chats/${row.chat.chatId}`}
            class="block border-b border-rule py-[18px]"
          >
            <span class="block font-serif text-row-compact font-semibold leading-tight text-ink">
              {row.name}
            </span>
            <span class="mt-1.5 block text-meta text-ink-3">
              {chatOriginCopy(row.origin)} · {row.messages} messages ·{" "}
              {relativeTime(row.chat.updatedAt)}
            </span>
          </a>
        ))}
      </div>
    </section>
  ));
}
