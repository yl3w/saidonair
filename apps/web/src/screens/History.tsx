import type { Episode } from "@media-digest/shared";
import { Calendar as CalendarIcon } from "lucide-preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { Calendar, type DayCount } from "../components/Calendar";
import { Icon } from "../components/Icon";
import { Page } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { SummaryRow, SummaryRowSkeleton } from "../components/SummaryRow";
import {
  actionErrorCopy,
  HISTORY_DAY_EMPTY_NOTE,
  HISTORY_EMPTY_NOTE,
  HISTORY_NOT_A_DAY_NOTE,
  HISTORY_SCOPE_NOTE,
} from "../lib/copy";
import {
  type DayKey,
  dayBounds,
  dayKeyOf,
  dayLabel,
  fullDate,
  groupByDay,
  isDayKey,
  todayKey,
  weekWindow,
} from "../lib/day";
import { readSettings } from "../lib/settings";
import { Guard } from "../session";

const PAGE = 50;
/** The calendar's window is one read; this bounds it when a catalog is deep (plan §Risks). */
const COUNT_PAGES = 5;

export function History() {
  return (
    <Guard>
      <HistoryScreen />
    </Guard>
  );
}

/**
 * The library: everything the reader is eligible for, by the day it became readable, and the one
 * place a receipt can be undone — undo lives where the consequence is visible (docs/design.md §4).
 * `/history` is every day; `/history/2026-09-12` is one, and the day is an address, with its year.
 */
function HistoryScreen() {
  const { params } = useRoute();
  const { route } = useLocation();
  const day = params.day;
  const validDay = day !== undefined && isDayKey(day) ? day : null;
  const showCounts = readSettings().showCounts;

  const [anchor, setAnchor] = useState<DayKey>(validDay ?? todayKey());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDay, setSheetDay] = useState<DayKey | null>(null);

  useEffect(() => {
    if (validDay !== null) setAnchor(validDay);
  }, [validDay]);

  const rows = useHistoryRows(validDay);
  const counts = useDayCounts(anchor);

  const calendar = (
    <Calendar
      anchor={anchor}
      selected={validDay}
      counts={counts}
      showCounts={showCounts}
      onAnchorChange={setAnchor}
      onPick={(picked) => route(`/history/${picked}`)}
    />
  );

  if (day !== undefined && validDay === null) {
    return (
      <Page rail={calendar} railMeasure="rail-wide">
        <h1 class="font-serif text-screen-title font-semibold tracking-tight text-ink">
          History
        </h1>
        <p class="mt-3 font-serif text-body text-ink-2">
          {HISTORY_NOT_A_DAY_NOTE}
        </p>
        <p class="mt-4">
          <a class="text-ui text-primary" href="/history">
            Every day
          </a>
        </p>
      </Page>
    );
  }

  const days = groupByDay(rows.rows, (row) => row.summaryAvailableAt ?? 0);

  return (
    <Page rail={calendar} railMeasure="rail-wide">
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="mr-auto font-serif text-screen-title font-semibold tracking-tight text-ink">
          {validDay === null ? "History" : dayLabel(validDay)}
        </h1>
        <button
          type="button"
          class="flex min-h-11 items-center gap-2 rounded border border-edge bg-panel px-3 text-ui text-ink lg:hidden"
          onClick={() => {
            setSheetDay(validDay);
            setSheetOpen(true);
          }}
        >
          <Icon of={CalendarIcon} size={16} />
          Browse by date
        </button>
      </header>

      {validDay !== null && (
        <p class="mt-1 text-meta text-ink-3">
          {fullDate(validDay)} ·{" "}
          <a class="text-primary" href="/history">
            every day
          </a>
        </p>
      )}

      {rows.error !== null && (
        <p class="mt-3 text-ui text-consequence">{rows.error}</p>
      )}

      {rows.status === "loading" && (
        <div class="mt-6">
          {[0, 1, 2].map((n) => (
            <SummaryRowSkeleton key={n} />
          ))}
        </div>
      )}

      {rows.status === "ready" && rows.rows.length === 0 && (
        <p class="mt-8 font-serif text-body text-ink-2">
          {validDay === null ? HISTORY_EMPTY_NOTE : HISTORY_DAY_EMPTY_NOTE}
        </p>
      )}

      {days.map((group) => (
        <section key={group.key} class="mt-8">
          {validDay === null && (
            <h2 class="font-serif text-section font-semibold text-ink">
              <a href={`/history/${group.key}`}>{dayLabel(group.key)}</a>
            </h2>
          )}
          <div class="mt-2 border-t border-rule">
            {group.rows.map((episode) => (
              <SummaryRow
                key={episode.episodeId}
                episode={episode}
                busy={rows.busy.has(episode.episodeId)}
                onDone={episode.read === false ? rows.markRead : undefined}
                onUndo={episode.read === true ? rows.clearRead : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      {rows.status === "ready" && rows.more && (
        <button
          type="button"
          class="btn btn-sm mt-6 min-h-11 border-edge bg-panel text-ui text-primary"
          disabled={rows.loadingMore}
          onClick={rows.loadMore}
        >
          {rows.loadingMore ? "Loading…" : "Show more"}
        </button>
      )}

      {rows.status === "ready" && rows.rows.length > 0 && (
        <p class="mt-8 font-serif text-excerpt text-ink-3">
          {HISTORY_SCOPE_NOTE}
        </p>
      )}

      <Sheet
        open={sheetOpen}
        title="Browse by date"
        confirm={
          sheetDay === null ? "Pick a day" : `Go to ${dayLabel(sheetDay)}`
        }
        onConfirm={
          sheetDay === null
            ? undefined
            : () => {
                setSheetOpen(false);
                route(`/history/${sheetDay}`);
              }
        }
        onClose={() => setSheetOpen(false)}
      >
        <Calendar
          anchor={anchor}
          selected={sheetDay}
          counts={counts}
          showCounts={showCounts}
          onAnchorChange={setAnchor}
          onPick={setSheetDay}
        />
      </Sheet>
    </Page>
  );
}

type HistoryRows = {
  status: "loading" | "ready" | "error";
  rows: Episode[];
  more: boolean;
  loadingMore: boolean;
  busy: ReadonlySet<string>;
  error: string | null;
  loadMore: () => void;
  markRead: (episode: Episode) => void;
  clearRead: (episode: Episode) => void;
};

/**
 * The rows of one day, or of every day. Pages accumulate rather than replace, because History is a
 * library and a reader walking back through it should not lose what they have already scrolled past.
 * A receipt written or undone here changes that row in place: the row stays, only its state moves.
 */
function useHistoryRows(day: DayKey | null): HistoryRows {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [rows, setRows] = useState<Episode[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setRows([]);
    setCursor(null);
    setError(null);
    api.getDigest({ ...rangeOf(day), limit: PAGE }).then(
      (page) => {
        if (cancelled) return;
        setRows(page.episodes);
        setCursor(page.nextCursor);
        setStatus("ready");
      },
      (caught: unknown) => {
        if (cancelled) return;
        setError(actionErrorCopy(caught));
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [day]);

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.getDigest({
        ...rangeOf(day),
        limit: PAGE,
        cursor,
      });
      setRows((current) => [...current, ...page.episodes]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, day]);

  const write = useCallback(async (episode: Episode, read: boolean) => {
    setBusy((current) => new Set(current).add(episode.episodeId));
    setError(null);
    try {
      const call = read ? api.markRead : api.clearRead;
      await call(episode.channelId, episode.episodeId);
      setRows((current) =>
        current.map((row) =>
          row.episodeId === episode.episodeId ? { ...row, read } : row,
        ),
      );
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(episode.episodeId);
        return next;
      });
    }
  }, []);

  return {
    status,
    rows,
    more: cursor !== null,
    loadingMore,
    busy,
    error,
    loadMore,
    markRead: (episode) => void write(episode, true),
    clearRead: (episode) => void write(episode, false),
  };
}

/**
 * How many summaries each day of the calendar's window holds, and how many are unread. One compact
 * request per page — four fields a row — walked to the end of the window or to `COUNT_PAGES`,
 * whichever comes first; a deeper catalog than that wants a per-day aggregate, not more paging.
 */
function useDayCounts(anchor: DayKey): ReadonlyMap<DayKey, DayCount> {
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
  }, [fromMs, toMs]);

  return counts;
}

function rangeOf(day: DayKey | null): { fromMs?: number; toMs?: number } {
  return day === null ? {} : dayBounds(day);
}
