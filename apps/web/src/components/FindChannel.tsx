import { Search } from "lucide-preact";
import { FIND_CHANNEL_COPY } from "../lib/copy";
import { Icon } from "./Icon";

/**
 * Narrowing a list of channels by name. One component because there are three of these now — the
 * catalog's, the queue's channel filter, and the landing page's — and they had been three copies of
 * the same six lines, each free to drift in its placeholder, its icon size or its accessible name.
 *
 * It holds no state: the caller owns the needle, because the caller is also doing the filtering and
 * a search box that remembered its own text while the list ignored it would be a lie
 * (docs/design.md §4).
 */
export function FindChannel({
  value,
  onChange,
  variant = "bordered",
  class: className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** `ghost` sits inside a popover or sheet that already draws the edge. */
  variant?: "bordered" | "ghost";
  class?: string;
}) {
  return (
    <label
      class={`input ${variant === "ghost" ? "input-ghost" : ""} ${className}`}
    >
      <Icon of={Search} size={16} class="text-ink-3" />
      <input
        type="search"
        placeholder={FIND_CHANNEL_COPY}
        aria-label={FIND_CHANNEL_COPY}
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}
