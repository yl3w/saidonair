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
  NO_CHANNEL_BY_THAT_NAME,
  reviewCopy,
  SOURCE_SORTS,
  SOURCES_TABS,
  summaryCountCopy,
} from "../lib/copy";
import { relativeTime } from "../lib/time";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { Guard, useReadySession } from "../session";

type Tab = keyof typeof SOURCES_TABS;
type Sort = keyof typeof SOURCE_SORTS;
const PAGE = 25;

export function Sources() {
  useDocumentTitle("Sources");
  return (
    <Guard>
      <SourcesScreen />
    </Guard>
  );
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
 * **A reader's screen, and only a reader's** (owner decision 2026-09-21). It was made public for a
 * few hours, because `GET /channels` is public and the spec listed this among the public screens.
 * Signed out it showed the same rows as the landing page, which lists every channel uncapped — the
 * sort and the paging were the whole difference, and neither is what somebody arriving needs. So a
 * visitor's catalog is `/`, and this is the screen for working through a long list: three tabs,
 * Follow, Add a channel, unread counts, none of which mean anything without a session.
 */
function SourcesScreen() {
  const { role } = useReadySession();
  const { query } = useLocation();
  const tab: Tab = isTab(query.show) ? query.show : "following";
  const [sort, setSort] = useState<Sort>("unread");
  const [needle, setNeedle] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [follows, reloadFollows] = useLoad(() => api.listFollows(), []);
  const [channels, reloadChannels] = useLoad(
    () => api.listChannels({ scope: "all" }),
    [],
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

  const ready = follows.status === "ready" && channels.status === "ready";
  const rows = ready
    ? partition(follows.data.follows, channels.data.channels)
    : { following: [], catalog: [], declined: [] };

  const filtered = rows[tab]
    .filter((row) =>
      needle.trim().length === 0
        ? true
        : row.channel.title.toLowerCase().includes(needle.trim().toLowerCase()),
    )
    .sort(comparator(sort));
  const page = filtered.slice(0, shown);

  return (
    <Page>
      {/* Named by the nav, in both bars, so the heading is sr-only and the tabs lead
          (owner decision 2026-09-15, docs/PRD.md §9; the tab carries the name, lib/title.ts). */}
      <h1 class="sr-only">Sources</h1>

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

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <FindChannel
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
            value={sort}
            onChange={(event) => setSort(event.currentTarget.value as Sort)}
          >
            {(Object.keys(SOURCE_SORTS) as Sort[])
              .filter((name) => name !== "followed" || tab === "following")
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
          {emptyNote(tab, needle)}
        </p>
      )}

      <div class="mt-4 border-t border-rule">
        {page.map((row) => (
          <ChannelRow
            key={row.channel.channelId}
            channel={row.channel}
            signedIn
            unreadCount={row.unreadCount}
            note={reviewCopy(row.channel)}
            action={
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

      <div class="mt-10">
        <AddChannel isOwner={role === "owner"} onChanged={reloadAll} />
      </div>
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

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && value in SOURCES_TABS;
}
