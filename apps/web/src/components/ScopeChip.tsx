import { X } from "lucide-preact";
import { SCOPE_OFF_COPY, SCOPE_ON_COPY } from "../lib/copy";
import { Icon } from "./Icon";

/**
 * The scope a question will be sent under (docs/specs/m4-3-chat-web.md §3.4). **Sticky until
 * dismissed** and carried in the URL as `?about=`, so it survives a reload and the chat stays
 * linkable; a second `Ask` replaces it rather than stacking, because scope is one episode or none.
 *
 * The line beneath the composer is not decoration. **It is the only thing telling a reader that
 * widening exists** — the `✕` reads as "remove this", not "search everything I follow" — and the
 * owner chose it over a labelled control on 2026-09-16, as the lighter of the two.
 */
export function ScopeChip({
  episodeTitle,
  onDismiss,
}: {
  episodeTitle: string | null;
  onDismiss: () => void;
}) {
  if (episodeTitle === null) return null;
  return (
    <div class="mb-2.5 flex w-fit max-w-full items-center gap-2 rounded-selector border border-edge bg-panel py-1 pl-2.5 pr-1">
      <span class="shrink-0 text-label uppercase text-ink-3">About</span>
      <span class="min-w-0 truncate font-serif text-ui text-ink">
        {episodeTitle}
      </span>
      <button
        type="button"
        class="flex size-11 items-center justify-center text-ink-3 md:size-6"
        aria-label={`Stop asking about ${episodeTitle}`}
        onClick={onDismiss}
      >
        <Icon of={X} size={16} />
      </button>
    </div>
  );
}

/** Which of the two is in force, said in words beneath the composer. */
export function ScopeLine({ scoped }: { scoped: boolean }) {
  return (
    <span class="text-meta text-ink-3">
      {scoped ? SCOPE_ON_COPY : SCOPE_OFF_COPY}
    </span>
  );
}
