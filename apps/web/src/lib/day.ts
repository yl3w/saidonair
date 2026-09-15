// The reader's own days. The API takes instants and never a timezone (docs/PRD.md §4.4), so every
// day boundary in this product is worked out here, in the browser, from the machine's own clock.
// A day's address carries its year — `/history/2026-09-12` — because a bare month and day stops
// being an address the moment a year turns.

/** `YYYY-MM-DD` in the reader's local time. The address of a day, and the key we group by. */
export type DayKey = string;

const DAY_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function dayKeyOf(at: number): DayKey {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now: number = Date.now()): DayKey {
  return dayKeyOf(now);
}

export function isDayKey(value: string): boolean {
  return DAY_KEY_SHAPE.test(value) && !Number.isNaN(dayBounds(value).fromMs);
}

/**
 * The half-open range one local day covers, as the digest wants it: `from` inclusive, `to`
 * exclusive, so two consecutive days never both claim a summary. Built from the local midnight of
 * the day after, not from `from + 24h`, which is an hour out on the two days a year the clocks move.
 */
export function dayBounds(key: DayKey): { fromMs: number; toMs: number } {
  const [year, month, day] = key.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return {
    fromMs: new Date(year, month - 1, day).getTime(),
    toMs: new Date(year, month - 1, day + 1).getTime(),
  };
}

/**
 * How a day names itself in a heading. Today and yesterday by name, because that is how a reader
 * thinks of them; anything else by its date, with the year only when it is not this one.
 */
export function dayLabel(key: DayKey, now: number = Date.now()): string {
  if (key === todayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKeyOf(yesterday.getTime())) return "Yesterday";
  const { fromMs } = dayBounds(key);
  const date = new Date(fromMs);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/** The short form the day rail uses, where the heading already carries the long one. */
export function shortDayLabel(key: DayKey, now: number = Date.now()): string {
  if (key === todayKey(now)) return "Today";
  const { fromMs } = dayBounds(key);
  return new Date(fromMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Rows into the days they belong to, keeping the order they arrived in — the digest already answers
 * newest availability first, so the days come out newest first and each day's rows with them.
 */
export function groupByDay<T>(
  rows: readonly T[],
  at: (row: T) => number,
): { key: DayKey; rows: T[] }[] {
  const days: { key: DayKey; rows: T[] }[] = [];
  for (const row of rows) {
    const key = dayKeyOf(at(row));
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, rows: [row] });
  }
  return days;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The calendar is five weeks and stays five weeks (docs/design.md §5): a control whose size grows
 * with the data is not a control, and a month view is four, five or six rows depending on the month.
 */
export const WEEKS_SHOWN = 5;
/** Weeks start on Monday, so the weekend sits together at the end where a reader looks for it. */
const WEEK_STARTS_ON = 1;

/**
 * The five weeks ending with the week that holds `anchor`, and the instants they span. History runs
 * backwards, so the anchor's week is the last row rather than the middle one.
 */
export function weekWindow(
  anchor: DayKey,
  weeks: number = WEEKS_SHOWN,
): { days: DayKey[]; fromMs: number; toMs: number } {
  const anchorDate = new Date(dayBounds(anchor).fromMs);
  const backToMonday = (anchorDate.getDay() - WEEK_STARTS_ON + 7) % 7;
  const start = new Date(anchorDate);
  start.setDate(start.getDate() - backToMonday - (weeks - 1) * 7);

  const days: DayKey[] = [];
  for (let index = 0; index < weeks * 7; index++) {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    days.push(dayKeyOf(day.getTime()));
  }
  const first = days[0] as DayKey;
  const last = days[days.length - 1] as DayKey;
  return {
    days,
    fromMs: dayBounds(first).fromMs,
    toMs: dayBounds(last).toMs,
  };
}

/** The same anchor moved whole windows, which is what the stepper does. */
export function shiftAnchor(anchor: DayKey, windows: number): DayKey {
  const date = new Date(dayBounds(anchor).fromMs);
  date.setDate(date.getDate() + windows * WEEKS_SHOWN * 7);
  return dayKeyOf(date.getTime());
}

/** What a window of days is called: one month, or the two it straddles. */
export function windowLabel(days: readonly DayKey[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return "";
  const from = new Date(dayBounds(first).fromMs);
  const to = new Date(dayBounds(last).fromMs);
  const month = (date: Date, withYear: boolean) =>
    date.toLocaleDateString(undefined, {
      month: "long",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear()
  ) {
    return month(to, true);
  }
  return `${month(from, from.getFullYear() !== to.getFullYear())} – ${month(to, true)}`;
}

/** The weekday headings of one week, in the reader's own language, starting Monday. */
export function weekdayLabels(): { short: string; long: string }[] {
  return Array.from({ length: 7 }, (_, index) => {
    // 2026-01-05 was a Monday; any Monday would do.
    const day = new Date(2026, 0, 5 + ((index + WEEK_STARTS_ON - 1 + 7) % 7));
    return {
      short: day.toLocaleDateString(undefined, { weekday: "narrow" }),
      long: day.toLocaleDateString(undefined, { weekday: "long" }),
    };
  });
}

/** The full name a calendar cell owes assistive technology (docs/design.md §7). */
export function fullDate(key: DayKey): string {
  return new Date(dayBounds(key).fromMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** The day number a cell shows. A cell is a date first; the count is the second thing on it. */
export function dayNumber(key: DayKey): number {
  return new Date(dayBounds(key).fromMs).getDate();
}
