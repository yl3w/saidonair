import type { Episode } from "@media-digest/shared";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { DateFilter } from "../components/DateFilter";
import { Page } from "../components/Page";
import { SummaryRow, SummaryRowSkeleton } from "../components/SummaryRow";
import {
  actionErrorCopy,
  HISTORY_ALL_SCOPE_NOTE,
  HISTORY_DAY_EMPTY_NOTE,
  HISTORY_DAY_SCOPE_NOTE,
  HISTORY_EMPTY_NOTE,
  HISTORY_NOT_A_DAY_NOTE,
  HISTORY_SCOPE_NOTE,
} from "../lib/copy";
import {
  type DayKey,
  dayBounds,
  dayLabel,
  groupByDay,
  isDayKey,
  todayKey,
} from "../lib/day";
import { useDayCounts } from "../lib/day-counts";
import { rememberOrigin, useReturnAnchor } from "../lib/reading-origin";
import { readSettings } from "../lib/settings";
import { useDocumentTitle } from "../lib/title";
import { Guard } from "../session";

const PAGE = 50;

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

  useEffect(() => {
    if (validDay !== null) setAnchor(validDay);
  }, [validDay]);

  const rows = useHistoryRows(validDay);
  const counts = useDayCounts(anchor);

  // Coming back from a summary: the row is still here, now saying "Read" instead of "Unread".
  useReturnAnchor(rows.status === "ready");

  // History is in neither bar, so it keeps its heading on screen; the tab says the same thing,
  // and on a day it is the day — a bookmark of one day of history should say which day.
  useDocumentTitle(validDay === null ? "History" : dayLabel(validDay));

  if (day !== undefined && validDay === null) {
    return (
      <Page>
        <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
          History
        </h1>
        <p class="mt-3 font-reading text-body text-ink-2">
          {HISTORY_NOT_A_DAY_NOTE}
        </p>
        <p class="mt-4">
          <a
            class="inline-flex min-h-11 items-center text-ui link link-hover link-primary"
            href="/history"
          >
            Every day
          </a>
        </p>
      </Page>
    );
  }

  const days = groupByDay(rows.rows, (row) => row.summaryAvailableAt ?? 0);
  // Every view of this screen is headed by a date and the picker, which is what makes it and the
  // Queue one shape. On every day that date is the first one in the list, hoisted out of its own
  // group so the row reads the same as a single day's — and still a link to that day, as the
  // headings below it are. The screen's name goes where the other named-by-the-bar screens keep
  // theirs; there is no date only while the list is empty or still arriving.
  const leadDay = validDay ?? days[0]?.key ?? null;

  return (
    <Page>
      <header class="flex flex-wrap items-center gap-3">
        {leadDay === null ? (
          <h1 class="sr-only">History</h1>
        ) : (
          <h1 class="mr-auto font-reading text-screen-title font-semibold tracking-tight text-ink">
            {validDay === null ? (
              <a
                class="inline-flex min-h-11 items-center"
                href={`/history/${leadDay}`}
              >
                {dayLabel(leadDay)}
              </a>
            ) : (
              dayLabel(validDay)
            )}
          </h1>
        )}
        <DateFilter
          selected={validDay}
          anchor={anchor}
          counts={counts}
          showCounts={showCounts}
          onAnchorChange={setAnchor}
          onPick={(picked) => route(`/history/${picked}`)}
          onClear={() => route("/history")}
        />
      </header>

      {/* Where the Queue puts its way through to this screen. Both are a date over rows now, so
          each says in one line what it holds that the other does not. */}
      <p class="mt-1 text-meta text-ink-3">
        {validDay === null ? HISTORY_ALL_SCOPE_NOTE : HISTORY_DAY_SCOPE_NOTE}
      </p>

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
        <p class="mt-8 font-reading text-body text-ink-2">
          {validDay === null ? HISTORY_EMPTY_NOTE : HISTORY_DAY_EMPTY_NOTE}
        </p>
      )}

      {days.map((group) => (
        <section key={group.key} class="mt-8" id={`day-${group.key}`}>
          {validDay === null && group.key !== leadDay && (
            <h2 class="font-reading text-section font-semibold text-ink">
              <a
                class="inline-flex min-h-11 items-center"
                href={`/history/${group.key}`}
              >
                {dayLabel(group.key)}
              </a>
            </h2>
          )}
          <div class="mt-2 border-t border-rule">
            {group.rows.map((episode) => (
              <SummaryRow
                key={episode.episodeId}
                episode={episode}
                list="mixed"
                busy={rows.busy.has(episode.episodeId)}
                onOpen={() =>
                  rememberOrigin({
                    kind: "history",
                    episodeId: episode.episodeId,
                    dayKey: group.key,
                  })
                }
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
          class="btn btn-quiet mt-6"
          disabled={rows.loadingMore}
          onClick={rows.loadMore}
        >
          {rows.loadingMore ? "Loading…" : "Show more"}
        </button>
      )}

      {rows.status === "ready" && rows.rows.length > 0 && (
        <p class="mt-8 font-reading text-excerpt text-ink-3">
          {HISTORY_SCOPE_NOTE}
        </p>
      )}
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

function rangeOf(day: DayKey | null): { fromMs?: number; toMs?: number } {
  return day === null ? {} : dayBounds(day);
}
