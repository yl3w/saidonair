import { useCallback, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { AvailableList, FollowedList } from "../components/ChannelList";
import { Digest } from "../components/Digest";
import { Nav } from "../components/Nav";
import { OwnerCard } from "../components/OwnerCard";
import { useLoad } from "../lib/use-load";
import { Guard, useReadySession } from "../session";

const DAY_MS = 24 * 60 * 60 * 1000;

export function Home() {
  return (
    <Guard>
      <HomeScreen />
    </Guard>
  );
}

/**
 * The reader view for everyone (spec §6). Follows and channels load first, then the digest, so the
 * unread counts and the NEW markers describe the same moment. The owner card loads only for the owner.
 */
function HomeScreen() {
  const { role } = useReadySession();
  const { query } = useLocation();
  const isOwner = role === "owner";

  const [follows, reloadFollows] = useLoad(() => api.listFollows(), []);
  const [channels, reloadChannels] = useLoad(() => api.listChannels(), []);
  const [catalog] = useLoad(() => api.getCatalog(), [], { enabled: isOwner });

  const listsReady = follows.status === "ready" && channels.status === "ready";
  const [showingWeek, setShowingWeek] = useState(false);
  const [digest, reloadDigest] = useLoad(
    () => api.getDigest(showingWeek ? Date.now() - 7 * DAY_MS : undefined),
    [showingWeek],
    { enabled: listsReady },
  );

  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // After a follow or unfollow only the lists reload. The digest follows on its own: `listsReady`
  // drops while they load and comes back once both are ready, and that flip is what starts its one
  // request. Reloading the digest here as well would fire it in the same render, while the lists
  // still read "ready", and every summary it returned would be marked read before being shown.
  const reloadLists = useCallback(() => {
    reloadFollows();
    reloadChannels();
  }, [reloadFollows, reloadChannels]);

  async function withBusy(channelId: string, work: () => Promise<unknown>) {
    setBusy((current) => new Set(current).add(channelId));
    try {
      await work();
      reloadLists();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(channelId);
        return next;
      });
    }
  }
  const follow = (channelId: string) =>
    withBusy(channelId, () => api.follow(channelId));
  const unfollow = (channelId: string) =>
    withBusy(channelId, () => api.unfollow(channelId));

  const followList = follows.status === "ready" ? follows.data.follows : [];
  const available =
    channels.status === "ready"
      ? channels.data.channels.filter((c) => !c.following)
      : [];

  return (
    <main>
      <Nav />
      {query.note === "owner-only" && (
        <p class="note">That page is for the owner.</p>
      )}
      {isOwner && catalog.status === "ready" && (
        <OwnerCard catalog={catalog.data.catalog} />
      )}
      <nav class="sections" aria-label="Sections">
        <a href="#digest">Digest</a>
        <a href="#channels">Channels</a>
      </nav>

      <Digest
        load={digest}
        hasFollows={follows.status !== "ready" || followList.length > 0}
        available={available}
        busy={busy}
        onFollow={follow}
        showingWeek={showingWeek}
        onToggleWeek={() => setShowingWeek((w) => !w)}
        onRetry={reloadDigest}
        isOwner={isOwner}
      />

      <section id="channels">
        <h2>Channels</h2>
        <h3>Followed ({followList.length})</h3>
        {follows.status === "loading" && <p>Loading…</p>}
        {follows.status === "error" && (
          <p class="error">
            Couldn't load your follows: {follows.error.message}.{" "}
            <button type="button" onClick={reloadFollows}>
              Retry
            </button>
          </p>
        )}
        {follows.status === "ready" && (
          <FollowedList
            follows={followList}
            busy={busy}
            onUnfollow={unfollow}
          />
        )}

        <h3>Available ({available.length})</h3>
        {channels.status === "loading" && <p>Loading…</p>}
        {channels.status === "error" && (
          <p class="error">
            Couldn't load the catalog: {channels.error.message}.{" "}
            <button type="button" onClick={reloadChannels}>
              Retry
            </button>
          </p>
        )}
        {channels.status === "ready" && (
          <AvailableList
            channels={available}
            busy={busy}
            onFollow={follow}
            isOwner={isOwner}
          />
        )}
      </section>
    </main>
  );
}
