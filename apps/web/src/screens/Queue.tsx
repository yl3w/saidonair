import type { Episode } from "@media-digest/shared";
import { useCallback, useState } from "preact/hooks";
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
 */
function QueueScreen() {
  const [density, setDensity] = useState<Density>("full");
  const [channelIds, setChannelIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const showCounts = readSettings().showCounts;

  const [follows] = useLoad(() => api.listFollows(), []);
  const filter = [...channelIds];
  const [page, reload] = useLoad(
    () => api.getDigest({ unread: true, channelIds: filter, limit: PAGE }),
    [filter.join(",")],
    { retainDataOnReload: true },
  );
  // Rows already marked done stay out of the list without a refetch: the queue is the one screen
  // where a row leaving is the point, and a full reload would move everything under the cursor.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const markDone = useCallback(async (episode: Episode) => {
    setBusy((current) => new Set(current).add(episode.episodeId));
    setError(null);
    try {
      await api.markRead(episode.channelId, episode.episodeId);
      setDismissed((current) => new Set(current).add(episode.episodeId));
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

  const rows =
    page.status === "ready"
      ? page.data.episodes.filter((row) => !dismissed.has(row.episodeId))
      : [];
  const days = groupByDay(rows, (row) => row.summaryAvailableAt ?? 0);
  const nothingFollowed =
    follows.status === "ready" && follows.data.follows.length === 0;

  return (
    <Page rail={<DayRail days={days.map((day) => day.key)} />}>
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="mr-auto font-serif text-screen-title font-semibold tracking-tight text-ink">
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

      {error !== null && <p class="mt-3 text-ui text-consequence">{error}</p>}

      {page.status === "loading" && (
        <div class="mt-6">
          {[0, 1, 2].map((n) => (
            <SummaryRowSkeleton key={n} density={density} />
          ))}
        </div>
      )}

      {page.status === "error" && (
        <p class="mt-6 text-ui text-consequence">
          Couldn't load your queue: {actionErrorCopy(page.error)}.{" "}
          <Retry onClick={reload} />
        </p>
      )}

      {page.status === "ready" && rows.length === 0 && (
        <section class="mt-10">
          <h2 class="font-serif text-section font-semibold text-ink">
            {nothingFollowed ? "Nothing followed yet" : QUEUE_EMPTY_TITLE}
          </h2>
          <p class="mt-2 font-serif text-body text-ink-2">
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

      {page.status === "ready" &&
        days.map((day) => (
          <section key={day.key} class="mt-8" id={`day-${day.key}`}>
            <h2 class="font-serif text-section font-semibold text-ink">
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
                  busy={busy.has(episode.episodeId)}
                  onDone={markDone}
                />
              ))}
            </div>
          </section>
        ))}

      {page.status === "ready" && rows.length > 0 && (
        <footer class="mt-8">
          {page.data.nextCursor === null ? (
            <p class="font-serif text-body text-ink-2">
              {endOfQueueCopy(inHistory)}{" "}
              <a class="text-primary" href="/history">
                History
              </a>
            </p>
          ) : (
            <a
              class="inline-flex min-h-11 items-center text-ui text-primary"
              href="/history"
            >
              More is waiting — browse it by day in History
            </a>
          )}
        </footer>
      )}
    </Page>
  );
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
