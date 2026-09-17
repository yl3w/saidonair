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
    <div class="mb-2.5 inline-flex items-center gap-2 rounded-control border border-edge bg-panel py-1 pl-2.5 pr-1">
      <span class="text-label uppercase tracking-label text-tertiary">
        About
      </span>
      <span class="font-serif text-ui text-ink">{episodeTitle}</span>
      <button
        type="button"
        class="flex size-11 items-center justify-center text-tertiary md:size-6"
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
    <span class="text-meta text-tertiary">
      {scoped ? SCOPE_ON_COPY : SCOPE_OFF_COPY}
    </span>
  );
}
