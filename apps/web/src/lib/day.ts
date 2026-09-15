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
