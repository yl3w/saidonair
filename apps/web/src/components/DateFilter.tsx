import { Calendar as CalendarIcon } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type DayKey, dayLabel, shortDayLabel } from "../lib/day";
import { useMediaQuery, WIDE } from "../lib/use-media-query";
import { Calendar, type DayCount } from "./Calendar";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/**
 * Which day the list is narrowed to. The calendar used to stand open in the right rail, where it
 * cost 288 px of every desktop view to answer a question a reader asks rarely; it is now behind
 * this, beside the heading, which is where `docs/design.md` §3 named the date picker in the first
 * place — a popover on a desktop, a bottom sheet on a phone (owner decision 2026-09-22).
 *
 * The two forms differ in when the choice lands, as they do for the channel picker: a popover goes
 * the moment a day is pressed, and a sheet has a footer, so it holds the day as a draft and the
 * footer names where it will go — "Go to 12 September".
 */
export function DateFilter({
  selected,
  anchor,
  counts,
  showCounts,
  onAnchorChange,
  onPick,
  onClear,
}: {
  /** The day History is showing, or null for every day. */
  selected: DayKey | null;
  anchor: DayKey;
  counts: ReadonlyMap<DayKey, DayCount>;
  showCounts: boolean;
  onAnchorChange: (anchor: DayKey) => void;
  onPick: (day: DayKey) => void;
  /** Omitted where there is no every-day to go back to, as on the Queue, which is always a day. */
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayKey | null>(selected);
  const wide = useMediaQuery(WIDE);
  const container = useRef<HTMLDivElement>(null);

  // A click anywhere else, or Escape, closes it — a popover that only closes by its own button is a
  // trap on a touch screen (docs/design.md §3).
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
      <Icon of={CalendarIcon} size={16} />
      {selected === null ? "All days" : shortDayLabel(selected)}
    </button>
  );

  // One shape at a time (docs/design.md §3): the sheet and the popover are the same control, and
  // rendering both would leave two calendars in the document with one set of day ids between them.
  if (!wide) {
    return (
      <>
        {trigger}
        <Sheet
          open={open}
          title="Browse by date"
          confirm={draft === null ? "Pick a day" : `Go to ${dayLabel(draft)}`}
          onConfirm={
            draft === null
              ? undefined
              : () => {
                  setOpen(false);
                  onPick(draft);
                }
          }
          onClose={() => setOpen(false)}
        >
          <Calendar
            anchor={anchor}
            selected={draft}
            counts={counts}
            showCounts={showCounts}
            onAnchorChange={onAnchorChange}
            onPick={setDraft}
          />
          <EveryDay
            onClear={onClear}
            shown={selected !== null}
            onClose={() => setOpen(false)}
          />
        </Sheet>
      </>
    );
  }

  return (
    <div class="relative" ref={container}>
      {trigger}

      {open && (
        <div class="absolute left-0 z-10 mt-1 w-rail-wide rounded border border-edge bg-panel p-3 shadow-lg">
          <Calendar
            anchor={anchor}
            selected={selected}
            counts={counts}
            showCounts={showCounts}
            onAnchorChange={onAnchorChange}
            onPick={(day) => {
              setOpen(false);
              onPick(day);
            }}
          />
          <EveryDay
            onClear={onClear}
            shown={selected !== null}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/** The way back out. A filter with no way to clear it is a quiet screen someone cannot explain. */
function EveryDay({
  shown,
  onClear,
  onClose,
}: {
  shown: boolean;
  onClear?: () => void;
  onClose: () => void;
}) {
  if (!shown || onClear === undefined) return null;
  return (
    <div class="mt-2 border-t border-rule pt-2">
      <button
        type="button"
        class="btn btn-quiet"
        onClick={() => {
          onClose();
          onClear();
        }}
      >
        Every day
      </button>
    </div>
  );
}
