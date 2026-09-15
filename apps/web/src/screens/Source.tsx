import type { Channel, Episode } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import {
  type ChannelAct,
  ChannelStatusActions,
} from "../components/ChannelStatusActions";
import { Page } from "../components/Page";
import { SummaryRow, SummaryRowSkeleton } from "../components/SummaryRow";
import {
  actionErrorCopy,
  channelStateCopy,
  episodePhrase,
  reviewCopy,
} from "../lib/copy";
import { relativeTime } from "../lib/time";
import { useLoad } from "../lib/use-load";
import { Guard, useReadySession } from "../session";

/** Two hundred is the API's ceiling; a longer history pages by year from what came back. */
const EPISODE_LIMIT = 200;

export function Source() {
  return (
    <Guard>
      <SourceScreen />
    </Guard>
  );
}

/**
 * One channel: what it is, what the reader's relationship to it is, and what it has published
 * (docs/specs/design-phase.md §4.6). Episodes are newest *published* first here — this is the
 * channel's own history, not the reader's queue, so publication is the order that matters, and the
 * ones without a summary say why in a phrase rather than being hidden.
 *
 * The owner's controls sit beside the channel they govern rather than at a separate destination
 * (docs/design.md principle 2); Curate is for the dense work, not the five-second decisions.
 */
function SourceScreen() {
  const { params } = useRoute();
  const { role } = useReadySession();
  const channelId = params.id ?? "";
  const [year, setYear] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channel, reloadChannel] = useLoad(
    () => api.getChannel(channelId),
    [channelId],
  );
  const [episodes, reloadEpisodes] = useLoad(
    () => api.listEpisodes(channelId, EPISODE_LIMIT),
    [channelId],
  );

  const act: ChannelAct = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      reloadChannel();
      reloadEpisodes();
      setBusy(false);
    }
  };

  async function follow(following: boolean) {
    await act(() =>
      following ? api.unfollow(channelId) : api.follow(channelId),
    );
  }

  if (channel.status === "error") {
    return (
      <Page>
        <p class="text-ui text-consequence">
          Couldn't load this channel: {actionErrorCopy(channel.error)}.{" "}
          <a
            class="inline-flex min-h-11 items-center text-primary"
            href="/sources"
          >
            Back to Sources
          </a>
        </p>
      </Page>
    );
  }

  const record = channel.status === "ready" ? channel.data.channel : null;
  const rows = episodes.status === "ready" ? episodes.data.episodes : [];
  const years = [
    ...new Set(rows.map((row) => new Date(row.publishedAt).getFullYear())),
  ].sort((a, b) => b - a);
  const currentYear = year ?? years[0] ?? null;
  const shown =
    currentYear === null
      ? rows
      : rows.filter(
          (row) => new Date(row.publishedAt).getFullYear() === currentYear,
        );

  return (
    <Page>
      {record === null ? (
        <div class="skeleton h-16 w-full" />
      ) : (
        <Header
          channel={record}
          isOwner={role === "owner"}
          busy={busy}
          act={act}
          onFollow={() => follow(record.following)}
        />
      )}

      {error !== null && <p class="mt-3 text-ui text-consequence">{error}</p>}

      <section class="mt-8">
        <div class="flex flex-wrap items-baseline gap-3">
          <h2 class="mr-auto font-serif text-section font-semibold text-ink">
            Episodes
          </h2>
          {years.length > 1 && (
            <nav class="flex flex-wrap gap-2" aria-label="By year">
              {years.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-current={option === currentYear ? "true" : undefined}
                  class={`min-h-11 px-2 text-ui ${
                    option === currentYear
                      ? "font-semibold text-ink underline decoration-1 underline-offset-4"
                      : "text-ink-2"
                  }`}
                  onClick={() => setYear(option)}
                >
                  {option}
                </button>
              ))}
            </nav>
          )}
        </div>

        {episodes.status === "loading" && (
          <div class="mt-3">
            {[0, 1].map((n) => (
              <SummaryRowSkeleton key={n} />
            ))}
          </div>
        )}

        {episodes.status === "ready" && rows.length === 0 && (
          <p class="mt-3 font-serif text-body text-ink-2">
            Nothing has been published here yet, or nothing has been discovered
            yet.
          </p>
        )}

        <div class="mt-3 border-t border-rule">
          {shown.map((episode) =>
            episode.summary === null ? (
              <WaitingRow key={episode.episodeId} episode={episode} />
            ) : (
              <SummaryRow key={episode.episodeId} episode={episode} />
            ),
          )}
        </div>

        {episodes.status === "ready" && rows.length === EPISODE_LIMIT && (
          <p class="mt-4 text-meta text-ink-3">
            The newest {EPISODE_LIMIT} are shown.
          </p>
        )}
      </section>
    </Page>
  );
}

function Header({
  channel,
  isOwner,
  busy,
  act,
  onFollow,
}: {
  channel: Channel;
  isOwner: boolean;
  busy: boolean;
  act: ChannelAct;
  onFollow: () => void;
}) {
  const review = reviewCopy(channel);
  return (
    <header>
      <div class="flex flex-wrap items-center gap-3">
        <Avatar id={channel.channelId} name={channel.title} size={46} />
        <div class="min-w-0 flex-1">
          <h1 class="font-serif text-screen-title font-semibold tracking-tight text-ink">
            {channel.title}
          </h1>
          <p class="mt-0.5 flex flex-wrap gap-x-2 text-meta text-ink-3">
            <span>{channelStateCopy(channel)}</span>
            <span>· {channel.episodes.available} summaries</span>
            {channel.lastIngestedAt !== null && (
              <span>· last {relativeTime(channel.lastIngestedAt)}</span>
            )}
            <span>
              ·{" "}
              <a class="text-primary" href={channel.canonicalUrl}>
                On YouTube
              </a>
            </span>
          </p>
        </div>
        {channel.status !== "declined" && (
          <button
            type="button"
            class={`btn btn-sm min-h-11 border-edge bg-panel text-ui ${
              channel.following ? "text-ink-2" : "text-primary"
            }`}
            disabled={busy}
            onClick={onFollow}
          >
            {channel.following ? "Unfollow" : "Follow"}
          </button>
        )}
      </div>

      {review !== null && (
        <p class="mt-3 font-serif text-excerpt text-ink-2">{review}</p>
      )}

      {isOwner && (
        <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3 text-ui text-owner">
          <span class="text-label uppercase">Owner</span>
          <ChannelStatusActions
            channel={channel}
            busy={busy}
            idPrefix="source-"
            act={act}
          />
          <a
            class="inline-flex min-h-11 items-center text-primary"
            href={`/curate/${channel.channelId}`}
          >
            Open in Curate
          </a>
        </div>
      )}
    </header>
  );
}

/** An episode with no summary still belongs in the history, with the reason it has none. */
function WaitingRow({ episode }: { episode: Episode }) {
  return (
    <article class="flex gap-3 border-b border-rule py-[18px]">
      <div class="min-w-0 flex-1">
        <h3 class="font-serif text-row-compact font-semibold text-ink-2">
          <a href={`https://youtu.be/${episode.episodeId}`}>{episode.title}</a>
        </h3>
        <p class="mt-1 flex flex-wrap gap-x-2 text-meta text-ink-3">
          <span>{episodePhrase(episode) ?? "Not summarised yet"}</span>
          <span>
            · published{" "}
            {new Date(episode.publishedAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </p>
      </div>
    </article>
  );
}
