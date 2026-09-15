import type { Episode } from "@media-digest/shared";
import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { ChannelFilter, type FilterChannel } from "../components/ChannelFilter";
import { DensitySwitch } from "../components/DensitySwitch";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import {
  type Density,
  SummaryRow,
  SummaryRowSkeleton,
} from "../components/SummaryRow";
import {
  actionErrorCopy,
  endOfQueueCopy,
  QUEUE_EMPTY_NOTE,
  QUEUE_EMPTY_TITLE,
  QUEUE_NO_FOLLOWS_NOTE,
} from "../lib/copy";
import { type DayKey, dayLabel, groupByDay, shortDayLabel } from "../lib/day";
import { rememberOrigin, useReturnAnchor } from "../lib/reading-origin";
import { readSettings } from "../lib/settings";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

const PAGE = 50;

export function Queue() {
  return (
    <Guard>
      <QueueScreen />
    </Guard>
  );
}

/**
 * What still needs the reader, and nothing else (docs/design.md principle 3): only summaries with no
 * receipt, grouped by the day they became readable, newest day first. A row can be marked done here
 * without opening it — that is the one write this screen makes — and it leaves the moment it is.
 *
 * **The queue holds everything waiting, however much that is.** It pages to the end of the range
 * rather than handing a reader past fifty rows to History, which is the library and mixes what has
 * been dealt with into what has not (owner decision 2026-09-15, docs/PRD.md §9).
 */
function QueueScreen() {
  const [density, setDensity] = useState<Density>("full");
  const [channelIds, setChannelIds] = useState<ReadonlySet<string>>(new Set());
  const showCounts = readSettings().showCounts;

  const [follows] = useLoad(() => api.listFollows(), []);
  const queue = useQueueRows([...channelIds].join(","));

  useReturnAnchor(queue.status === "ready");

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
  const inHistory =
    follows.status === "ready" && showCounts
      ? follows.data.follows
          .filter((follow) => follow.channel.status === "approved")
          .reduce(
            (total, follow) => total + follow.channel.episodes.available,
            0,
          )
      : null;

  const days = groupByDay(queue.rows, (row) => row.summaryAvailableAt ?? 0);
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

  return (
    <Page rail={<DayRail days={days.map((day) => day.key)} />}>
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="mr-auto font-reading text-screen-title font-semibold tracking-tight text-ink">
          Queue
        </h1>
        {channels.length > 1 && (
          <ChannelFilter
            channels={channels}
            selected={channelIds}
            onChange={setChannelIds}
          />
        )}
        <DensitySwitch value={density} onChange={setDensity} />
      </header>

      {queue.status === "ready" && queue.error !== null && (
        <p class="mt-3 text-ui text-consequence">{queue.error}</p>
      )}

      {queue.status === "loading" && (
        <div class="mt-6">
          {[0, 1, 2].map((n) => (
            <SummaryRowSkeleton key={n} density={density} />
          ))}
        </div>
      )}

      {queue.status === "error" && (
        <p class="mt-6 text-ui text-consequence">
          Couldn't load your queue: {queue.error}.{" "}
          <Retry onClick={queue.reload} />
        </p>
      )}

      {through && (
        <section class="mt-10">
          <h2 class="font-reading text-section font-semibold text-ink">
            {nothingFollowed ? "Nothing followed yet" : QUEUE_EMPTY_TITLE}
          </h2>
          <p class="mt-2 font-reading text-body text-ink-2">
            {nothingFollowed ? QUEUE_NO_FOLLOWS_NOTE : QUEUE_EMPTY_NOTE}
          </p>
          <p class="mt-4">
            <a
              class="inline-flex min-h-11 items-center text-ui text-primary"
              href={nothingFollowed ? "/sources" : "/history"}
            >
              {nothingFollowed ? "Find a channel" : "Browse History"}
            </a>
          </p>
        </section>
      )}

      {days.map((day) => (
        <section key={day.key} class="mt-8" id={`day-${day.key}`}>
          <h2 class="font-reading text-section font-semibold text-ink">
            <a
              class="inline-flex min-h-11 items-center"
              href={`/history/${day.key}`}
            >
              {dayLabel(day.key)}
            </a>
          </h2>
          <div class="mt-2 border-t border-rule">
            {day.rows.map((episode) => (
              <SummaryRow
                key={episode.episodeId}
                episode={episode}
                density={density}
                busy={queue.busy.has(episode.episodeId)}
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

      {queue.status === "ready" && (queue.more || queue.rows.length > 0) && (
        <footer class="mt-8">
          {queue.more ? (
            <button
              type="button"
              class="btn btn-sm min-h-11 border-edge bg-panel text-ui text-primary"
              disabled={queue.loadingMore}
              onClick={queue.loadMore}
            >
              {queue.loadingMore ? "Loading…" : "Show more"}
            </button>
          ) : (
            <p class="font-reading text-body text-ink-2">
              {endOfQueueCopy(inHistory)}{" "}
              <a class="text-primary" href="/history">
                History
              </a>
            </p>
          )}
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
 */
function useQueueRows(key: string): QueueRows {
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
  }, [key, attempt]);

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
      });
      setRows((current) => [...current, ...page.episodes]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, key]);

  // Nothing loaded but more to come: either the first page was all receipts, or the reader has just
  // finished every row on screen. Keep going rather than show an empty queue over a full range.
  useEffect(() => {
    if (status !== "ready" || loadingMore) return;
    if (rows.length > 0 || cursor === null || error !== null) return;
    void loadMore();
  }, [status, rows.length, cursor, loadingMore, error, loadMore]);

  const markDone = useCallback(async (episode: Episode) => {
    setBusy((current) => new Set(current).add(episode.episodeId));
    setError(null);
    try {
      await api.markRead(episode.channelId, episode.episodeId);
      setRows((current) =>
        current.filter((row) => row.episodeId !== episode.episodeId),
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
    reload: () => setAttempt((n) => n + 1),
    loadMore: () => void loadMore(),
    markDone: (episode) => void markDone(episode),
  };
}

/** The days still holding something, as anchors. Navigation about the list, never content. */
function DayRail({ days }: { days: readonly DayKey[] }) {
  if (days.length === 0) return null;
  return (
    <nav aria-label="Days still waiting" class="sticky top-20">
      <h2 class="text-label uppercase text-ink-3">Still waiting</h2>
      <ul class="mt-2">
        {days.map((day) => (
          <li key={day}>
            <a
              class="flex min-h-11 items-center text-ui text-ink-2"
              href={`#day-${day}`}
            >
              {shortDayLabel(day)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
