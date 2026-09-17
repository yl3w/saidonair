import { Check, ListFilter, Search, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useMediaQuery, WIDE } from "../lib/use-media-query";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

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
 *
 * On a phone it is a bottom sheet rather than a popover (docs/design.md §3), which changes when the
 * choice lands: a popover applies each tap at once, and a sheet has a footer, so it applies on the
 * button that names what it will do — "Show these two".
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
  const [draft, setDraft] = useState<ReadonlySet<string>>(selected);
  const wide = useMediaQuery(WIDE);
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

  const trigger = (
    <button
      type="button"
      class="btn btn-quiet-secondary"
      aria-expanded={open}
      aria-haspopup="true"
      onClick={() => {
        setDraft(selected);
        setOpen(!open);
      }}
    >
      <Icon of={ListFilter} size={16} />
      {label}
    </button>
  );

  if (!wide) {
    return (
      <>
        {trigger}
        <Sheet
          open={open}
          title="Channels"
          confirm={showCopy(channels, draft)}
          onConfirm={() => {
            onChange(draft);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        >
          <List
            channels={shown}
            selected={draft}
            query={query}
            onQuery={setQuery}
            onToggle={(channelId) => setDraft(toggled(draft, channelId))}
            onClear={() => setDraft(new Set())}
          />
        </Sheet>
      </>
    );
  }

  return (
    <div class="relative" ref={container}>
      {trigger}

      {open && (
        <div class="absolute left-0 z-10 mt-1 w-72 rounded border border-edge bg-panel shadow-lg">
          <List
            channels={shown}
            selected={selected}
            query={query}
            onQuery={setQuery}
            onToggle={(channelId) => onChange(toggled(selected, channelId))}
            onClear={() => onChange(new Set())}
          />
        </div>
      )}
    </div>
  );
}

/** The searchable list itself, shown in a popover on a desktop and in a sheet on a phone. */
function List({
  channels,
  selected,
  query,
  onQuery,
  onToggle,
  onClear,
}: {
  channels: readonly FilterChannel[];
  selected: ReadonlySet<string>;
  query: string;
  onQuery: (query: string) => void;
  onToggle: (channelId: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <label class="input input-ghost w-full">
        <Icon of={Search} size={16} class="text-ink-3" />
        <input
          type="search"
          placeholder="Find a channel"
          aria-label="Find a channel"
          value={query}
          onInput={(event) => onQuery(event.currentTarget.value)}
        />
      </label>

      <ul class="menu max-h-72 w-full flex-nowrap overflow-y-auto border-t border-rule">
        {channels.map((channel) => {
          const on = selected.has(channel.channelId);
          return (
            <li key={channel.channelId}>
              <button
                type="button"
                class="flex"
                aria-pressed={on}
                onClick={() => onToggle(channel.channelId)}
              >
                <span class="flex size-4 shrink-0 items-center justify-center">
                  {on && <Icon of={Check} size={16} />}
                </span>
                <Avatar id={channel.channelId} name={channel.title} size={20} />
                <span class="min-w-0 flex-1 truncate">{channel.title}</span>
                <span class="text-meta text-ink-3">{channel.unreadCount}</span>
              </button>
            </li>
          );
        })}
        {channels.length === 0 && (
          <li class="px-3 py-3 font-reading text-excerpt text-ink-2">
            No channel by that name.
          </li>
        )}
      </ul>

      {selected.size > 0 && (
        <ul class="menu w-full border-t border-rule">
          <li>
            <button type="button" class="flex text-primary" onClick={onClear}>
              <Icon of={X} size={16} />
              Show every channel
            </button>
          </li>
        </ul>
      )}
    </>
  );
}

function toggled(
  selected: ReadonlySet<string>,
  channelId: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(channelId)) next.delete(channelId);
  else next.add(channelId);
  return next;
}

/** The sheet's primary button names what it will do (docs/design.md §3), never "OK". */
function showCopy(
  channels: readonly FilterChannel[],
  selected: ReadonlySet<string>,
): string {
  if (selected.size === 0) return "Show every channel";
  if (selected.size === 1) {
    const only = channels.find((channel) => selected.has(channel.channelId));
    return only === undefined ? "Show 1 channel" : `Show ${only.title}`;
  }
  return `Show these ${selected.size}`;
}
