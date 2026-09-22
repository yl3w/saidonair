import type { Episode } from "@media-digest/shared";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { ChannelFilter, type FilterChannel } from "../components/ChannelFilter";
import { DateFilter } from "../components/DateFilter";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import { SummaryRow, SummaryRowSkeleton } from "../components/SummaryRow";
import {
  actionErrorCopy,
  dayInHistoryCopy,
  QUEUE_EMPTY_NOTE,
  QUEUE_EMPTY_TITLE,
  QUEUE_NO_FOLLOWS_NOTE,
} from "../lib/copy";
import {
  type DayKey,
  dayBounds,
  dayKeyOf,
  dayLabel,
  groupByDay,
  isDayKey,
  todayKey,
} from "../lib/day";
import { useDayCounts } from "../lib/day-counts";
import { rememberOrigin, useReturnAnchor } from "../lib/reading-origin";
import { readSettings } from "../lib/settings";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

const PAGE = 50;
/**
 * The index walks compact rows — four fields each — to learn which days hold something unread. This
 * bounds that walk at 5,000 unread summaries, past which the oldest days simply do not appear in the
 * stepper; the day a reader is on still reads correctly, because rows and index are separate queries.
 */
const INDEX_PAGES = 25;

export function Queue() {
  return (
    <Guard>
      <QueueScreen />
    </Guard>
  );
}

/**
 * What still needs the reader, and nothing else (docs/design.md principle 3): only summaries with no
 * receipt. A row can be marked done here without opening it — that is the one write this screen
 * makes — and it leaves the moment it is.
 *
 * **One day at a time** (experiment, 2026-09-22). `/queue` opens on the newest day still holding
 * something and `/queue/2026-09-20` is one day. The day is the frame because a day can be finished
 * and a river cannot: the screen a reader lands on has an end to it. There is deliberately no way
 * back to the whole list — an experiment with the old shape one click away only measures the click.
 *
 * Which days those are is its own small query — `useUnreadDays` — so the stepper knows the whole
 * shape of the backlog rather than only the part that happens to be loaded, which is what the old
 * day rail knew. Knowing the days also means a step is a range query for that day alone, never a
 * walk forward through everything in between.
 */
function QueueScreen() {
  const { params } = useRoute();
  const { route } = useLocation();
  const [channelIds, setChannelIds] = useState<ReadonlySet<string>>(new Set());
  const showCounts = readSettings().showCounts;
  const key = [...channelIds].join(",");

  const segment = params.day;
  const asked = segment !== undefined && isDayKey(segment) ? segment : null;

  const [follows] = useLoad(() => api.listFollows(), []);
  const index = useUnreadDays(key);
  // `/queue` with no day names the newest day still waiting, and then **holds it**. Clearing the
  // last row of a day would otherwise slide the reader onto the next day at the instant they
  // finished this one, which is the one moment this screen has to offer.
  const [landed, setLanded] = useState<DayKey | null>(null);
  useEffect(() => setLanded(null), [key]);
  useEffect(() => {
    if (asked !== null || landed !== null) return;
    const newest = index.days[0];
    if (index.status === "ready" && newest !== undefined) setLanded(newest.key);
  }, [asked, landed, index.status, index.days]);
  const current = asked ?? landed;
  const queue = useQueueRows(key, current, (episode) =>
    index.clear(dayKeyOf(episode.summaryAvailableAt ?? 0)),
  );

  // The calendar's five-week window. It follows the day being read, so opening the picker always
  // shows the month the reader is standing in rather than the one they last looked at.
  const [anchor, setAnchor] = useState<DayKey>(current ?? todayKey());
  useEffect(() => {
    if (current !== null) setAnchor(current);
  }, [current]);

  // The same counts History's calendar draws, narrowed by the same channel filter as the rows. Not
  // the unread index: that one knows only the days with something left, so a day read to the end
  // had no cell at all and the picker said nothing arrived when seven summaries had.
  const counts = useDayCounts(anchor, key);

  useReturnAnchor(queue.status === "ready");

  useDocumentTitle(current === null ? "Queue" : dayLabel(current));

  const channels: FilterChannel[] =
    follows.status === "ready"
      ? follows.data.follows
          .filter((follow) => follow.channel.status === "approved")
          .map((follow) => ({
            channelId: follow.channelId,
            title: follow.channel.title,
            unreadCount: follow.unreadCount,
          }))
      : [];
  const days = groupByDay(queue.rows, (row) => row.summaryAvailableAt ?? 0);
  const older = olderThan(index.days, current);
  const onThisDay = useDayTotal(showCounts ? current : null);
  const nothingFollowed =
    follows.status === "ready" && follows.data.follows.length === 0;
  // Through everything only when the range is exhausted too: a loaded page can empty while the
  // range still holds unread summaries, and claiming otherwise is the failure this screen cannot
  // afford.
  const through =
    queue.status === "ready" &&
    queue.rows.length === 0 &&
    !queue.more &&
    !queue.loadingMore;
  // Older first, because a queue is walked backwards; anything left when there is nothing older is
  // a day above the one just finished, which only happens when a reader picks out of order.
  const next = older ?? index.days[0] ?? null;
  // A finished day and a finished queue are different endings and the index is what tells them
  // apart. Its own status matters: days is empty while it is still walking, and that is not "none".
  const clearedDay = through && current !== null && next !== null;
  const clearedAll =
    through && index.status === "ready" && index.days.length === 0;

  return (
    <Page>
      {/* The bar and the phone's tab bar both say "Queue" and mark it current, so the screen's own
          name was given up to them (owner decision 2026-09-15, docs/PRD.md §9) and lives in the tab.
          What the heading carries now is the day, which neither bar names — the same reason History
          keeps a visible heading on a day. */}
      <header class="flex flex-wrap items-center gap-3">
        {current === null || through ? (
          <h1 class="sr-only">Queue</h1>
        ) : (
          <h1 class="mr-auto font-reading text-screen-title font-semibold tracking-tight text-ink">
            {dayLabel(current)}
          </h1>
        )}
        {index.days.length > 0 && (
          <DateFilter
            selected={current}
            anchor={anchor}
            counts={counts}
            showCounts={showCounts}
            onAnchorChange={setAnchor}
            onPick={(picked) => route(`/queue/${picked}`)}
          />
        )}
        {channels.length > 1 && (
          <ChannelFilter
            channels={channels}
            selected={channelIds}
            onChange={setChannelIds}
          />
        )}
      </header>

      {/* Under the date, the day's whole record — read summaries included — which is the one thing
          this screen deliberately does not show. A day-shaped question answered with a day-shaped
          link; the archive at large is at the foot of the list, where the reader has finished. */}
      {current !== null && !through && (
        <p class="mt-1 text-meta text-ink-3">
          <a class="link link-hover link-primary" href={`/history/${current}`}>
            {dayInHistoryCopy(onThisDay, queue.rows.length)}
          </a>
        </p>
      )}

      {queue.status === "ready" && queue.error !== null && (
        <p class="mt-3 text-ui text-consequence">{queue.error}</p>
      )}

      {queue.status === "loading" && (
        <div class="mt-6">
          {[0, 1, 2].map((n) => (
            <SummaryRowSkeleton key={n} />
          ))}
        </div>
      )}

      {queue.status === "error" && (
        <p class="mt-6 text-ui text-consequence">
          Couldn't load your queue: {queue.error}.{" "}
          <Retry onClick={queue.reload} />
        </p>
      )}

      {/* A day cleared is not a queue cleared, and saying so is the whole point of a day being the
          frame: the reader gets an ending, and then chooses whether to take another one. */}
      {clearedDay && next !== null && current !== null && (
        <section class="mt-10">
          <h2 class="font-reading text-section font-semibold text-ink">
            You are through {dayLabel(current)}
          </h2>
          <p class="mt-2 font-reading text-body text-ink-2">
            {dayLabel(next.key)} is next, {waitingCopy(next.count)}.
          </p>
          <p class="mt-4">
            <a
              class="inline-flex min-h-11 items-center text-ui link link-hover link-primary"
              href={`/queue/${next.key}`}
            >
              Read {dayLabel(next.key)}
            </a>
          </p>
        </section>
      )}

      {clearedAll && (
        <section class="mt-10">
          <h2 class="font-reading text-section font-semibold text-ink">
            {nothingFollowed ? "Nothing followed yet" : QUEUE_EMPTY_TITLE}
          </h2>
          <p class="mt-2 font-reading text-body text-ink-2">
            {nothingFollowed ? QUEUE_NO_FOLLOWS_NOTE : QUEUE_EMPTY_NOTE}
          </p>
          <p class="mt-4">
            <a
              class="inline-flex min-h-11 items-center text-ui link link-hover link-primary"
              href={nothingFollowed ? "/sources" : "/history"}
            >
              {nothingFollowed ? "Find a channel" : "Browse History"}
            </a>
          </p>
        </section>
      )}

      {days.map((day) => (
        <section key={day.key} class="mt-8" id={`day-${day.key}`}>
          {/* No heading: the screen's own says the day. The id stays — it is where a reader lands
              when they come back from a summary they marked read, and the row itself has gone
              (lib/reading-origin.ts). */}
          <div class="mt-3 border-t border-rule">
            {day.rows.map((episode) => (
              <SummaryRow
                key={episode.episodeId}
                episode={episode}
                list="mixed"
                busy={queue.busy.has(episode.episodeId)}
                state={false}
                onOpen={() =>
                  rememberOrigin({
                    kind: "queue",
                    episodeId: episode.episodeId,
                    dayKey: day.key,
                  })
                }
                onDone={queue.markDone}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Only a way to load more. A day that ends says nothing: the heading above names it, the
          link under that offers its whole record, and a day's list reaching its end is not news
          (owner decision 2026-09-22). The line that used to sit here counted the screen rather than
          the backlog, which day-scoping had already made untrue. */}
      {queue.status === "ready" && queue.more && (
        <footer class="mt-8">
          <button
            type="button"
            class="btn btn-quiet"
            disabled={queue.loadingMore}
            onClick={queue.loadMore}
          >
            {queue.loadingMore ? "Loading…" : "Show more"}
          </button>
        </footer>
      )}
    </Page>
  );
}

type QueueRows = {
  status: "loading" | "ready" | "error";
  rows: Episode[];
  more: boolean;
  loadingMore: boolean;
  busy: ReadonlySet<string>;
  error: string | null;
  reload: () => void;
  loadMore: () => void;
  markDone: (episode: Episode) => void;
};

/**
 * The unread rows, paged to the end of the range. Pages accumulate; a row marked done leaves the
 * list without a refetch, because the queue is the one screen where a row leaving is the point and
 * a reload would move everything under the cursor.
 *
 * Receipts live in the User DO, so the route filters `unread` after it selects, which means **a page
 * can come back empty and still carry a cursor** — ten passes over rows the reader has already dealt
 * with. So an empty page is never the end; only a null cursor is, and the effect below keeps asking
 * until one of the two is true.
 *
 * @param key the channel filter, joined — one string, so a new array each render is not a new query.
 * @param day the day this page is scoped to, or null for every unread summary at once.
 * @param onCleared told which episode left, once the receipt is written, so the day index can keep
 *   count without waiting for another walk.
 */
function useQueueRows(
  key: string,
  day: DayKey | null,
  onCleared: (episode: Episode) => void,
): QueueRows {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [rows, setRows] = useState<Episode[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setRows([]);
    setCursor(null);
    setError(null);
    api
      .getDigest({
        unread: true,
        channelIds: key === "" ? [] : key.split(","),
        limit: PAGE,
        ...(day === null ? {} : dayBounds(day)),
      })
      .then(
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
  }, [key, day, attempt]);

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.getDigest({
        unread: true,
        channelIds: key === "" ? [] : key.split(","),
        limit: PAGE,
        cursor,
        ...(day === null ? {} : dayBounds(day)),
      });
      setRows((current) => [...current, ...page.episodes]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, key, day]);

  // Nothing loaded but more to come: either the first page was all receipts, or the reader has just
  // finished every row on screen. Keep going rather than show an empty queue over a full range.
  useEffect(() => {
    if (status !== "ready" || loadingMore) return;
    if (rows.length > 0 || cursor === null || error !== null) return;
    void loadMore();
  }, [status, rows.length, cursor, loadingMore, error, loadMore]);

  const markDone = useCallback(
    async (episode: Episode) => {
      setBusy((current) => new Set(current).add(episode.episodeId));
      setError(null);
      try {
        await api.markRead(episode.channelId, episode.episodeId);
        setRows((current) =>
          current.filter((row) => row.episodeId !== episode.episodeId),
        );
        onCleared(episode);
      } catch (caught) {
        setError(actionErrorCopy(caught));
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(episode.episodeId);
          return next;
        });
      }
    },
    [onCleared],
  );

  return {
    status,
    rows,
    more: cursor !== null,
    loadingMore,
    busy,
    error,
    reload: () => setAttempt((n) => n + 1),
    loadMore: () => void loadMore(),
    markDone: (episode) => void markDone(episode),
  };
}

/** One day of the backlog: its key and how many summaries on it are still unread. */
type UnreadDay = { key: DayKey; count: number };

/**
 * The nearest day below this one, found by date rather than by position, so it still answers for a
 * day the reader has just finished and which has therefore left the index. Newest first, so the
 * first key below `current` is the nearest one below it.
 */
function olderThan(
  days: readonly UnreadDay[],
  current: DayKey | null,
): UnreadDay | null {
  if (current === null) return null;
  return days.find((day) => day.key < current) ?? null;
}

/**
 * How many summaries that one day holds in total — the read ones this screen hides included — so the
 * link under the date can say whether History has more of the day than the queue is showing. Null
 * while it is unknown, when counts are switched off, or when the read fails: a number nobody can
 * vouch for is worse than none, and the link works without it.
 *
 * One day of compact rows is a handful of four-field objects, so this is a small read and a fresh
 * one per day. It is not the backlog index: that one asks for `unread`, and this asks for all.
 */
function useDayTotal(day: DayKey | null): number | null {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    setTotal(null);
    if (day === null) return;
    let cancelled = false;
    (async () => {
      const { fromMs, toMs } = dayBounds(day);
      let count = 0;
      let cursor: string | undefined;
      for (let page = 0; page < INDEX_PAGES; page++) {
        const answer = await api.getDigestRows({
          fromMs,
          toMs,
          limit: 200,
          cursor,
        });
        count += answer.rows.length;
        if (answer.nextCursor === null) break;
        cursor = answer.nextCursor;
      }
      if (!cancelled) setTotal(count);
    })().catch(() => {
      if (!cancelled) setTotal(null);
    });
    return () => {
      cancelled = true;
    };
  }, [day]);

  return total;
}

/**
 * Every day holding something unread, newest first, with how many on each.
 *
 * Read from the digest's compact form — four fields a row, no summary, no titles — and walked to the
 * end of the range rather than to a page limit: "is there another day?" is a question a short answer
 * gets wrong, and a stepper that says a reader is finished when they are not is worse than no
 * stepper. The walk is bounded only by `INDEX_PAGES`, which is a backstop and not a page size.
 *
 * Receipts live in the User DO and the route filters them out after selecting, so a page can come
 * back empty while the range still holds unread rows. Only a null cursor ends this.
 */
function useUnreadDays(key: string): {
  status: "loading" | "ready" | "error";
  days: UnreadDay[];
  clear: (day: DayKey) => void;
} {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [days, setDays] = useState<UnreadDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDays([]);
    (async () => {
      const tally = new Map<DayKey, number>();
      let cursor: string | undefined;
      for (let page = 0; page < INDEX_PAGES; page++) {
        const answer = await api.getDigestRows({
          unread: true,
          channelIds: key === "" ? [] : key.split(","),
          limit: 200,
          cursor,
        });
        for (const row of answer.rows) {
          const day = dayKeyOf(row.summaryAvailableAt ?? 0);
          tally.set(day, (tally.get(day) ?? 0) + 1);
        }
        if (answer.nextCursor === null) break;
        cursor = answer.nextCursor;
      }
      if (cancelled) return;
      setDays(
        [...tally]
          .map(([day, count]) => ({ key: day, count }))
          .sort((a, b) => b.key.localeCompare(a.key)),
      );
      setStatus("ready");
    })().catch(() => {
      // The rows are a separate query and answer on their own. A stepper that cannot be built is a
      // missing stepper, never a failed screen.
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // One summary dealt with. The index is a snapshot, and this is what keeps it honest between
  // walks; a day at zero leaves, which is what moves the stepper on.
  const clear = useCallback((day: DayKey) => {
    setDays((current) =>
      current
        .map((row) =>
          row.key === day ? { ...row, count: row.count - 1 } : row,
        )
        .filter((row) => row.count > 0),
    );
  }, []);

  return { status, days, clear };
}

/** "three waiting", for the line that names the next day. */
function waitingCopy(count: number): string {
  return count === 1 ? "one waiting" : `${count} waiting`;
}
