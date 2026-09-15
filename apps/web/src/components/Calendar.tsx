import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type DayKey,
  dayNumber,
  fullDate,
  shiftAnchor,
  todayKey,
  weekdayLabels,
  weekWindow,
  windowLabel,
} from "../lib/day";
import { Icon } from "./Icon";

/** What one day holds, for the reader whose calendar this is. */
export type DayCount = { total: number; unread: number };

/**
 * Five weeks of dated cells (docs/design.md §5, §7). **A cell is a date first**: the day number is
 * what it shows, and the count is the second thing on it — counts without a day of the month are
 * unnavigable. A day that still holds something says so in weight and a rule under it before it says
 * so in tint, because state is never colour alone.
 *
 * It is a grid, so the arrow keys move through it a day and a week at a time, and every cell carries
 * its full date and counts as its accessible name — "12 September 2026, 3 summaries, 3 unread", not
 * "12".
 */
export function Calendar({
  anchor,
  selected,
  counts,
  showCounts = true,
  onAnchorChange,
  onPick,
}: {
  anchor: DayKey;
  selected: DayKey | null;
  counts: ReadonlyMap<DayKey, DayCount>;
  showCounts?: boolean;
  onAnchorChange: (anchor: DayKey) => void;
  onPick: (day: DayKey) => void;
}) {
  const { days } = weekWindow(anchor);
  const today = todayKey();
  const [focused, setFocused] = useState<DayKey>(selected ?? anchor);
  const cells = useRef(new Map<DayKey, HTMLButtonElement>());
  const moved = useRef(false);

  // Only ever move focus in response to a key the reader pressed; stealing it on render would drag
  // the page around every time the counts arrive.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    cells.current.get(focused)?.focus();
  }, [focused]);

  function move(from: DayKey, byDays: number) {
    const index = days.indexOf(from);
    const next = days[index + byDays];
    moved.current = true;
    if (next !== undefined) {
      setFocused(next);
      return;
    }
    // Off the edge: step the window and land on the same weekday in the new one.
    const shifted = shiftAnchor(anchor, byDays > 0 ? 1 : -1);
    onAnchorChange(shifted);
    const landing =
      weekWindow(shifted).days[
        byDays > 0 ? index + byDays - days.length : days.length + index + byDays
      ];
    if (landing !== undefined) setFocused(landing);
  }

  function onKeyDown(event: KeyboardEvent, day: DayKey) {
    const by = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];
    if (by !== undefined) {
      event.preventDefault();
      move(day, by);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const index = days.indexOf(day);
      const weekStart = index - (index % 7);
      moved.current = true;
      setFocused(days[event.key === "Home" ? weekStart : weekStart + 6] ?? day);
    }
  }

  const weekdays = weekdayLabels();

  return (
    <div>
      <div class="flex items-center gap-1">
        <h2 class="mr-auto text-label uppercase text-ink-3">
          {windowLabel(days)}
        </h2>
        <button
          type="button"
          class="flex size-11 items-center justify-center text-ink-2"
          onClick={() => onAnchorChange(shiftAnchor(anchor, -1))}
        >
          <Icon of={ChevronLeft} size={20} label="Five weeks earlier" />
        </button>
        <button
          type="button"
          class="flex size-11 items-center justify-center text-ink-2"
          onClick={() => onAnchorChange(shiftAnchor(anchor, 1))}
        >
          <Icon of={ChevronRight} size={20} label="Five weeks later" />
        </button>
      </div>

      <table class="mt-1 w-full table-fixed border-separate border-spacing-0.5">
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th
                key={weekday.long}
                scope="col"
                class="pb-1 text-label font-normal uppercase text-ink-3"
              >
                <abbr title={weekday.long} class="no-underline">
                  {weekday.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunk(days, 7).map((week) => (
            <tr key={week[0]}>
              {week.map((day) => (
                <Cell
                  key={day}
                  day={day}
                  count={counts.get(day)}
                  showCounts={showCounts}
                  isToday={day === today}
                  isSelected={day === selected}
                  tabbable={day === focused}
                  register={(element) => {
                    if (element === null) cells.current.delete(day);
                    else cells.current.set(day, element);
                  }}
                  onFocus={() => setFocused(day)}
                  onKeyDown={(event) => onKeyDown(event, day)}
                  onPick={() => onPick(day)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  day,
  count,
  showCounts,
  isToday,
  isSelected,
  tabbable,
  register,
  onFocus,
  onKeyDown,
  onPick,
}: {
  day: DayKey;
  count: DayCount | undefined;
  showCounts: boolean;
  isToday: boolean;
  isSelected: boolean;
  tabbable: boolean;
  register: (element: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onPick: () => void;
}) {
  const total = count?.total ?? 0;
  const unread = count?.unread ?? 0;
  const holds = total > 0;

  return (
    <td class="p-0">
      <button
        type="button"
        ref={register}
        tabIndex={tabbable ? 0 : -1}
        aria-current={isSelected ? "date" : undefined}
        aria-label={cellName(day, total, unread)}
        disabled={!holds}
        class={`flex h-11 w-full flex-col items-center justify-center rounded text-meta ${
          isSelected
            ? "bg-ink text-panel"
            : holds
              ? "bg-base-200 font-semibold text-ink underline decoration-ink decoration-1 underline-offset-2"
              : "text-ink-3"
        } ${isToday && !isSelected ? "ring-1 ring-edge" : ""}`}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onClick={onPick}
      >
        <span>{dayNumber(day)}</span>
        {holds && showCounts && (
          <span class="text-[0.625rem] leading-none" aria-hidden="true">
            {unread > 0 ? unread : total}
          </span>
        )}
      </button>
    </td>
  );
}

/** "12 September 2026, 3 summaries, 3 unread" — never "12" (docs/design.md §7). */
function cellName(day: DayKey, total: number, unread: number): string {
  if (total === 0) return `${fullDate(day)}, nothing`;
  const summaries = `${total} ${total === 1 ? "summary" : "summaries"}`;
  return `${fullDate(day)}, ${summaries}, ${unread} unread`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
