import type { Channel, Follow } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { AddChannel } from "../components/AddChannel";
import { ChannelRow } from "../components/ChannelRow";
import { FindChannel } from "../components/FindChannel";
import { FollowButton } from "../components/FollowButton";
import { Page } from "../components/Page";
import {
  actionErrorCopy,
  channelStateCopy,
  LANDING_CHANNELS_HEADING,
  LANDING_EMPTY_COPY,
  NO_CHANNEL_BY_THAT_NAME,
  reviewCopy,
  SOURCE_SORTS,
  SOURCES_TABS,
  summaryCountCopy,
} from "../lib/copy";
import { publicChannels } from "../lib/public-view";
import { relativeTime } from "../lib/time";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { useSession } from "../session";

type Tab = keyof typeof SOURCES_TABS;
type Sort = keyof typeof SOURCE_SORTS;
const PAGE = 25;

export function Sources() {
  useDocumentTitle("Sources");
  return <SourcesScreen />;
}

/** One row of any tab: a channel, with whatever the reader's relationship to it adds. */
type Row = { channel: Channel; unreadCount: number; followedAt: number | null };

/**
 * Where channels come from and where they go (docs/specs/design-phase.md §4.6). Three sections —
 * what you follow, what the catalog holds, what the owner declined — as links rather than
 * client-side tabs, so a link is a link and a reload lands where it was (docs/design.md §2.6).
 *
 * Search, a sort order and paging at 25 are part of the design, not a later fix: a list that is
 * elegant at six follows is four screens of scrolling at thirty (docs/design.md §5).
 *
 * **Public since 2026-09-21** (docs/specs/public-reading.md §4.1). A visitor sees the catalog: the
 * approved and paused channels, with the same search, sort and paging. What they do not see is
 * added here rather than forked into a second screen — the tabs (there is no "following" and no
 * "declined" without a session), the Follow controls, and Add a channel. Two copies of this screen
 * would drift, and the drift would only show on the half nobody had signed out of lately.
 */
function SourcesScreen() {
  const { state } = useSession();
  const signedIn = state.status === "ready";
  const role = state.status === "ready" ? state.role : null;
  // A reader's session is `loading` before it is `ready`, and fetching on that first pass would
  // show them the visitor's list for a moment and then replace it. A visitor is `none` at once,
  // with nothing to wait for. `error` counts as settled: if `GET /me` failed there is no reader to
  // identify, and the public catalog is the honest thing to show.
  const waitingForSession = state.status === "loading";
  const { query } = useLocation();
  const tab: Tab = isTab(query.show) ? query.show : "following";
  const [sort, setSort] = useState<Sort>("unread");
  const [needle, setNeedle] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // A visitor has no follows to ask for, and `?scope=all` exists to show the reader their declined
  // channels — neither means anything without a session, and `listFollows` would be refused.
  const [follows, reloadFollows] = useLoad(
    () => api.listFollows(),
    [signedIn],
    {
      enabled: signedIn,
    },
  );
  const [channels, reloadChannels] = useLoad(
    () => api.listChannels(signedIn ? { scope: "all" } : {}),
    [signedIn],
  );

  function reloadAll() {
    reloadFollows();
    reloadChannels();
  }

  async function act(channelId: string, work: () => Promise<unknown>) {
    setBusy((current) => new Set(current).add(channelId));
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      reloadAll();
      setBusy((current) => {
        const next = new Set(current);
        next.delete(channelId);
        return next;
      });
    }
  }

  const ready = signedIn
    ? follows.status === "ready" && channels.status === "ready"
    : channels.status === "ready";

  const rows =
    signedIn && follows.status === "ready" && channels.status === "ready"
      ? partition(follows.data.follows, channels.data.channels)
      : { following: [], catalog: [], declined: [] };

  /** A visitor's one list: the catalog, with no relationship to carry (lib/public-view.ts). */
  const visitorRows: Row[] =
    !signedIn && channels.status === "ready"
      ? publicChannels(channels.data.channels).map((channel) => ({
          channel,
          unreadCount: 0,
          followedAt: null,
        }))
      : [];

  // "Most unread" and "Longest followed" describe a relationship a visitor does not have. The
  // reader's default is left alone: their first render is `loading`, not signed out, and switching
  // the stored default on the way through would change their screen for nobody's benefit.
  const effectiveSort: Sort =
    signedIn || (sort !== "unread" && sort !== "followed") ? sort : "name";

  const filtered = (signedIn ? rows[tab] : visitorRows)
    .filter((row) =>
      needle.trim().length === 0
        ? true
        : row.channel.title.toLowerCase().includes(needle.trim().toLowerCase()),
    )
    .sort(comparator(effectiveSort));
  const page = filtered.slice(0, shown);

  return (
    <Page>
      {/* Named by the nav, in both bars, so the heading is sr-only and the tabs lead
          (owner decision 2026-09-15, docs/PRD.md §9; the tab carries the name, lib/title.ts). */}
      <h1 class="sr-only">Sources</h1>

      {/* A visitor gets the name in words: the bar above says "Said on Air" and nothing else, so
          without this the page opens on a search box with no subject. A reader's nav already
          marks Sources as current, which is why theirs stays sr-only. */}
      {!signedIn && (
        <h2 class="border-b border-rule pb-2 text-label uppercase text-ink-3">
          {LANDING_CHANNELS_HEADING}
        </h2>
      )}

      {signedIn && (
        <nav
          class="flex flex-wrap gap-4 border-b border-rule"
          aria-label="Sections"
        >
          {(Object.keys(SOURCES_TABS) as Tab[]).map((name) => (
            <a
              key={name}
              href={name === "following" ? "/sources" : `/sources?show=${name}`}
              aria-current={tab === name ? "page" : undefined}
              class={`flex min-h-11 items-center gap-1.5 border-b-2 text-ui hover:text-ink ${
                tab === name
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent text-ink-2"
              }`}
              onClick={() => setShown(PAGE)}
            >
              {SOURCES_TABS[name]}
              {ready && (
                <span class="text-meta text-ink-3">{rows[name].length}</span>
              )}
            </a>
          ))}
        </nav>
      )}

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <FindChannel
          class="flex-1"
          value={needle}
          onChange={(next) => {
            setNeedle(next);
            setShown(PAGE);
          }}
        />
        <label class="flex cursor-pointer items-center gap-2 text-meta text-ink-3">
          Sort
          <select
            class="select"
            value={effectiveSort}
            onChange={(event) => setSort(event.currentTarget.value as Sort)}
          >
            {(Object.keys(SOURCE_SORTS) as Sort[])
              .filter((name) =>
                signedIn
                  ? name !== "followed" || tab === "following"
                  : name !== "unread" && name !== "followed",
              )
              .map((name) => (
                <option key={name} value={name}>
                  {SOURCE_SORTS[name]}
                </option>
              ))}
          </select>
        </label>
      </div>

      {error !== null && <p class="mt-3 text-ui text-consequence">{error}</p>}

      {!ready && <div class="skeleton mt-6 h-24 w-full" />}

      {ready && filtered.length === 0 && (
        <p class="mt-8 font-reading text-body text-ink-2">
          {signedIn ? emptyNote(tab, needle) : visitorEmptyNote(needle)}
        </p>
      )}

      <div class="mt-4 border-t border-rule">
        {page.map((row) => (
          <ChannelRow
            key={row.channel.channelId}
            channel={row.channel}
            signedIn={signedIn}
            unreadCount={row.unreadCount}
            note={signedIn ? reviewCopy(row.channel) : null}
            action={
              signedIn ? (
                <RowAction
                  channel={row.channel}
                  busy={busy.has(row.channel.channelId)}
                  onFollow={() =>
                    act(row.channel.channelId, () =>
                      api.follow(row.channel.channelId),
                    )
                  }
                  onUnfollow={() =>
                    act(row.channel.channelId, () =>
                      api.unfollow(row.channel.channelId),
                    )
                  }
                  onRequest={() =>
                    act(row.channel.channelId, () =>
                      api.requestChannel(row.channel.channelId),
                    )
                  }
                />
              ) : null
            }
          />
        ))}
      </div>

      {filtered.length > page.length && (
        <button
          type="button"
          class="btn btn-quiet mt-4"
          onClick={() => setShown(shown + PAGE)}
        >
          Show {Math.min(PAGE, filtered.length - page.length)} more
        </button>
      )}

      {/* Adding a channel is a write, and a visitor has no controls at all (spec §3, decision 10):
          signing in returns them here, where the field is. */}
      {signedIn && (
        <div class="mt-10">
          <AddChannel isOwner={role === "owner"} onChanged={reloadAll} />
        </div>
      )}
    </Page>
  );
}

/**
 * A reader's control on a catalog row. A visitor gets none at all — absent rather than disabled
 * (docs/design.md §9b) — which is why this is the row's `action` slot and not part of the row.
 */
function RowAction({
  channel,
  busy,
  onFollow,
  onUnfollow,
  onRequest,
}: {
  channel: Channel;
  busy: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onRequest: () => void;
}) {
  if (channel.status === "declined") {
    return (
      <button
        type="button"
        class="btn btn-quiet"
        disabled={busy}
        onClick={onRequest}
      >
        Request again
      </button>
    );
  }
  return (
    <FollowButton
      title={channel.title}
      following={channel.following}
      busy={busy}
      onClick={channel.following ? onUnfollow : onFollow}
    />
  );
}

/**
 * The three sections. A follow of a declined channel files under Declined, not Following: what the
 * owner decided is the more useful fact about it, and the follow is kept either way.
 */
function partition(
  follows: readonly Follow[],
  channels: readonly Channel[],
): Record<Tab, Row[]> {
  const followed = new Map(follows.map((follow) => [follow.channelId, follow]));
  const rows: Record<Tab, Row[]> = {
    following: [],
    catalog: [],
    declined: [],
  };
  for (const channel of channels) {
    const follow = followed.get(channel.channelId);
    const row: Row = {
      channel,
      unreadCount: follow?.unreadCount ?? 0,
      followedAt: follow?.followedAt ?? null,
    };
    if (channel.status === "declined") rows.declined.push(row);
    else if (channel.following) rows.following.push(row);
    else rows.catalog.push(row);
  }
  return rows;
}

function comparator(sort: Sort): (a: Row, b: Row) => number {
  switch (sort) {
    case "unread":
      return (a, b) =>
        b.unreadCount - a.unreadCount ||
        a.channel.title.localeCompare(b.channel.title);
    case "active":
      return (a, b) =>
        (b.channel.lastIngestedAt ?? -1) - (a.channel.lastIngestedAt ?? -1) ||
        a.channel.title.localeCompare(b.channel.title);
    case "followed":
      return (a, b) =>
        (a.followedAt ?? Number.POSITIVE_INFINITY) -
        (b.followedAt ?? Number.POSITIVE_INFINITY);
    default:
      return (a, b) => a.channel.title.localeCompare(b.channel.title);
  }
}

function emptyNote(tab: Tab, needle: string): string {
  if (needle.trim().length > 0) return NO_CHANNEL_BY_THAT_NAME;
  if (tab === "following") {
    return "You follow nothing yet. Add a channel below, or take one from the catalog.";
  }
  if (tab === "catalog") {
    return "The catalog holds nothing you are not already following.";
  }
  return "Nothing has been declined.";
}

/** A visitor has one list, so the reader's three-way empty note does not fit it. */
function visitorEmptyNote(needle: string): string {
  return needle.trim().length > 0
    ? NO_CHANNEL_BY_THAT_NAME
    : LANDING_EMPTY_COPY;
}

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && value in SOURCES_TABS;
}
