import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import type { DayCount } from "../components/Calendar";
import { type DayKey, dayKeyOf, weekWindow } from "./day";

/** The calendar's window is one read; this bounds it when a catalog is deep (plan §Risks). */
const COUNT_PAGES = 5;

/**
 * How many summaries each day of the calendar's window holds, and how many are unread. One compact
 * request per page — four fields a row — walked to the end of the window or to `COUNT_PAGES`,
 * whichever comes first; a deeper catalog than that wants a per-day aggregate, not more paging.
 *
 * Shared by both calendars since 2026-09-22. The Queue drew its cells from its own unread index
 * before that, which meant a day whose summaries were all read simply had no cell — so the same
 * control, in the same place, said a day was empty on one screen and held seven on the other. Both
 * now count the same thing; what differs is only which of the two numbers a cell shows, and the
 * Calendar has always made that choice on its own.
 *
 * @param channels the caller's channel filter, joined — one string, so a new array each render is
 *   not a new query. Empty means every eligible channel, which is History's case.
 */
export function useDayCounts(
  anchor: DayKey,
  channels = "",
): ReadonlyMap<DayKey, DayCount> {
  const [counts, setCounts] = useState<ReadonlyMap<DayKey, DayCount>>(
    new Map(),
  );
  const { fromMs, toMs } = weekWindow(anchor);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tally = new Map<DayKey, DayCount>();
      let cursor: string | undefined;
      for (let page = 0; page < COUNT_PAGES; page++) {
        const answer = await api.getDigestRows({
          fromMs,
          toMs,
          channelIds: channels === "" ? [] : channels.split(","),
          limit: 200,
          cursor,
        });
        for (const row of answer.rows) {
          const key = dayKeyOf(row.summaryAvailableAt);
          const day = tally.get(key) ?? { total: 0, unread: 0 };
          day.total += 1;
          if (!row.read) day.unread += 1;
          tally.set(key, day);
        }
        if (answer.nextCursor === null) break;
        cursor = answer.nextCursor;
      }
      if (!cancelled) setCounts(tally);
    })().catch(() => {
      // A calendar nobody can vouch for is worse than a calendar with no counts on it.
      if (!cancelled) setCounts(new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [fromMs, toMs, channels]);

  return counts;
}
