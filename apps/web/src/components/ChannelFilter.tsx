import { Check, ListFilter, Search, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

export type FilterChannel = {
  channelId: string;
  title: string;
  unreadCount: number;
};

/**
 * Which channels the list is narrowed to. A chip per channel is elegant at six follows and four
 * lines of chrome at thirty (docs/design.md §5), so this is one control that opens a searchable
 * list, sorted by what is unread. Never sticky across sessions: a quiet screen must never be a
 * filter someone forgot they set (docs/design.md §4), so the caller holds the selection in state
 * and nothing writes it anywhere.
 */
export function ChannelFilter({
  channels,
  selected,
  onChange,
}: {
  channels: readonly FilterChannel[];
  selected: ReadonlySet<string>;
  onChange: (selected: ReadonlySet<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);

  // A click anywhere else, or Escape, closes it — a popover that only closes by its own button is a
  // trap on a touch screen.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const ordered = [...channels].sort(
    (a, b) => b.unreadCount - a.unreadCount || a.title.localeCompare(b.title),
  );
  const needle = query.trim().toLowerCase();
  const shown =
    needle.length === 0
      ? ordered
      : ordered.filter((channel) =>
          channel.title.toLowerCase().includes(needle),
        );

  const label =
    selected.size === 0
      ? "All channels"
      : selected.size === 1
        ? (channels.find((channel) => selected.has(channel.channelId))?.title ??
          "1 channel")
        : `${selected.size} channels`;

  function toggle(channelId: string) {
    const next = new Set(selected);
    if (next.has(channelId)) next.delete(channelId);
    else next.add(channelId);
    onChange(next);
  }

  return (
    <div class="relative" ref={container}>
      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded border border-edge bg-panel px-3 text-ui text-ink"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon of={ListFilter} size={16} />
        {label}
      </button>

      {open && (
        <div class="absolute left-0 z-10 mt-1 w-72 rounded border border-edge bg-panel shadow-lg">
          <div class="flex items-center gap-2 border-b border-rule px-3">
            <Icon of={Search} size={16} class="text-ink-3" />
            <input
              type="search"
              class="min-h-11 w-full bg-transparent text-ui text-ink outline-none"
              placeholder="Find a channel"
              aria-label="Find a channel"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>

          <ul class="max-h-72 overflow-y-auto">
            {shown.map((channel) => {
              const on = selected.has(channel.channelId);
              return (
                <li key={channel.channelId}>
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-ui text-ink"
                    aria-pressed={on}
                    onClick={() => toggle(channel.channelId)}
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      {on && <Icon of={Check} size={16} />}
                    </span>
                    <Avatar
                      id={channel.channelId}
                      name={channel.title}
                      size={20}
                    />
                    <span class="min-w-0 flex-1 truncate">{channel.title}</span>
                    <span class="text-meta text-ink-3">
                      {channel.unreadCount}
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li class="px-3 py-3 font-serif text-excerpt text-ink-2">
                No channel by that name.
              </li>
            )}
          </ul>

          {selected.size > 0 && (
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2 border-t border-rule px-3 text-left text-ui text-primary"
              onClick={() => onChange(new Set())}
            >
              <Icon of={X} size={16} />
              Show every channel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
