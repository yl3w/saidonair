import type { Channel, Episode } from "@media-digest/shared";
import { ArrowLeft, ExternalLink, SquarePen } from "lucide-preact";
import { useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import {
  type ChannelAct,
  ChannelStatusActions,
} from "../components/ChannelStatusActions";
import { FollowButton } from "../components/FollowButton";
import { Icon } from "../components/Icon";
import { MetaLine } from "../components/MetaLine";
import { Page } from "../components/Page";
import {
  fullDate,
  SummaryRow,
  SummaryRowSkeleton,
} from "../components/SummaryRow";
import { goBack } from "../lib/back";
import {
  actionErrorCopy,
  BACK_COPY,
  CURATE_LINK_COPY,
  channelExceptionCopy,
  EXTERNAL_CHANNEL_COPY,
  EXTERNAL_HINT_COPY,
  episodeCountCopy,
  episodePhrase,
  followerCountCopy,
  reviewCopy,
  summaryCountCopy,
} from "../lib/copy";
import { rememberOrigin, useReturnAnchor } from "../lib/reading-origin";
import { relativeTime } from "../lib/time";
import { useDocumentTitle } from "../lib/title";
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

  // Coming back from a summary: this history is publication-ordered and nothing leaves it, so the
  // row the reader opened is always still there to return to.
  useReturnAnchor(episodes.status === "ready");

  // Before the early return below: a hook's order is not something a screen's state may change.
  useDocumentTitle(
    channel.status === "ready" ? channel.data.channel.title : null,
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
      <Page bar={<SourceBar channel={null} />}>
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
    <Page
      bar={
        <SourceBar
          channel={record}
          isOwner={role === "owner"}
          busy={busy}
          act={act}
          onFollow={() => record !== null && follow(record.following)}
        />
      }
    >
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
          <h2 class="mr-auto font-reading text-section font-semibold text-ink">
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
          <p class="mt-3 font-reading text-body text-ink-2">
            Nothing has been published here yet, or nothing has been discovered
            yet.
          </p>
        )}

        <div class="mt-3 border-t border-rule">
          {shown.map((episode) =>
            episode.summary === null ? (
              <WaitingRow key={episode.episodeId} episode={episode} />
            ) : (
              <SummaryRow
                key={episode.episodeId}
                episode={episode}
                list="channel"
                onOpen={() =>
                  rememberOrigin({
                    kind: "source",
                    episodeId: episode.episodeId,
                    ...(record === null ? {} : { label: record.title }),
                  })
                }
              />
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

/**
 * This screen's own bar, in place of the product's nav (docs/design.md §3): a way back, and the one
 * act that belongs to the whole channel rather than to any row — the way out to YouTube. It is the
 * reading column's bar, for the same reason: a page *about* one object carries that object's acts,
 * not the product's destinations.
 *
 * Back is the browser's, which is what "the page I came from" means; a reader who opened this URL
 * directly has no such page, and goes to Sources, which is this channel's home.
 */
function SourceBar({
  channel,
  isOwner = false,
  busy = false,
  act,
  onFollow,
}: {
  channel: Channel | null;
  isOwner?: boolean;
  busy?: boolean;
  act?: ChannelAct;
  onFollow?: () => void;
}) {
  const { route } = useLocation();
  return (
    <header class="sticky top-0 z-20 border-b border-rule bg-ground">
      {/* Constrained to this screen's own measure, as the reading column's bar and a chat's are:
          a bar belongs to the column beneath it, not to the window (2026-09-17). */}
      <div class="mx-auto flex h-14 max-w-list items-center gap-2 px-5 md:px-8">
        <button
          type="button"
          class="flex size-11 items-center justify-center text-ink-2"
          onClick={() => goBack(() => route("/sources"))}
        >
          <Icon of={ArrowLeft} size={20} label={BACK_COPY} />
        </button>

        {channel !== null && (
          <div class="ml-auto flex items-center gap-3">
            {/* The acts join the bar from md up; below it they are in the header, where there is
                room for them (see ChannelActs). */}
            {act !== undefined && onFollow !== undefined && (
              <div class="hidden items-center gap-3 md:flex">
                <ChannelActs
                  channel={channel}
                  isOwner={isOwner}
                  busy={busy}
                  act={act}
                  onFollow={onFollow}
                />
              </div>
            )}
            <a
              class="flex min-h-11 items-center gap-1.5 px-2 text-ui text-primary"
              href={channel.canonicalUrl}
              title={EXTERNAL_HINT_COPY}
            >
              {EXTERNAL_CHANNEL_COPY}
              <Icon of={ExternalLink} size={16} />
            </a>
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * A channel's own acts (docs/design.md §3). The owner's are amber and come first because they are
 * about the channel; the follow is everyone's and comes last because it is about the reader. No
 * label over either half: they are told apart by colour and by the border on the reader's own.
 */
function ChannelActs({
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
  return (
    <>
      {isOwner && (
        <>
          <ChannelStatusActions
            channel={channel}
            busy={busy}
            idPrefix="source-"
            scope="adjustments"
            tone="owner"
            act={act}
          />
          <a
            class="flex size-11 shrink-0 items-center justify-center rounded text-owner"
            href={`/curate/${channel.channelId}`}
            title={CURATE_LINK_COPY}
          >
            <Icon of={SquarePen} size={20} label={CURATE_LINK_COPY} />
          </a>
        </>
      )}

      {channel.status !== "declined" && (
        <FollowButton
          title={channel.title}
          following={channel.following}
          busy={busy}
          onClick={onFollow}
        />
      )}
    </>
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
  // Silence means approved and running — the page's own existence says that — so only the states a
  // reader cannot infer are printed. Assembled, so the separator belongs to the line and the first
  // item dropping out leaves no stray dot.
  const exception = channelExceptionCopy(channel);
  const meta = [
    exception,
    episodeCountCopy(channel.episodes),
    summaryCountCopy(channel.episodes),
    // A fact about the channel, so it sits with the facts. It was beside the controls to make a
    // withdrawal's consequence visible before it was chosen — and withdrawal moved to Curate, so
    // that reason left with it (owner decision 2026-09-15).
    followerCountCopy(channel.followerCount),
    channel.lastIngestedAt === null
      ? null
      : `last summary ${relativeTime(channel.lastIngestedAt)}`,
  ].filter((item): item is string => item !== null);

  return (
    <header>
      <div class="flex flex-wrap items-center gap-3">
        <Avatar id={channel.channelId} name={channel.title} size={46} />
        <div class="min-w-0 flex-1">
          <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
            {channel.title}
          </h1>
          <MetaLine class="mt-1.5" items={meta} />
        </div>
      </div>

      {review !== null && (
        <p class="mt-3 font-reading text-excerpt text-ink-2">{review}</p>
      )}

      {/* Below md the acts stay here: in the bar they would come to about 430 px of controls in
          350 px of room. Above it they belong to the bar, where a screen about one object carries
          that object's acts (docs/design.md §3). One component, rendered in one place at a time. */}
      <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3 md:hidden">
        <ChannelActs
          channel={channel}
          isOwner={isOwner}
          busy={busy}
          act={act}
          onFollow={onFollow}
        />
      </div>
    </header>
  );
}

/**
 * An episode with no summary still belongs in the history, with the reason it has none. It is the
 * same row as a summarised one — the published date leading, then the title — so a channel's
 * history reads as one list rather than two interleaved shapes. What differs is what a row can
 * offer: no excerpt, no meta, a title in `--ink-2` and a link to the video rather than to a summary
 * that does not exist, and the phrase where the executive summary would be.
 */
function WaitingRow({ episode }: { episode: Episode }) {
  return (
    <article class="flex gap-3 border-b border-rule py-[18px]">
      <div class="min-w-0 flex-1">
        <p class="text-label uppercase text-ink-3">
          {fullDate(episode.publishedAt)}
        </p>
        <h3 class="mt-0.5 font-reading text-row-sm font-semibold text-ink-2 md:text-row">
          <a href={`https://youtu.be/${episode.episodeId}`}>{episode.title}</a>
        </h3>
        <p class="mt-1 font-reading text-excerpt text-ink-2">
          {episodePhrase(episode) ?? "Not summarised yet"}
        </p>
      </div>
    </article>
  );
}
