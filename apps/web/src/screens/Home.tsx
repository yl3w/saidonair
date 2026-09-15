import { useCallback, useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { AddChannel } from "../components/AddChannel";
import { CatalogList, FollowedList } from "../components/ChannelList";
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
    () => api.getDigest(Date.now() - (showingWeek ? 7 : 1) * DAY_MS),
    [showingWeek],
    { enabled: listsReady },
  );

  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  // After a follow or unfollow only the lists reload. The digest follows on its own: `listsReady`
  // drops while they load and comes back once both are ready, and that flip is what starts its one
  // request. Reloading the digest here as well would fire it in the same render, while the lists
  // still read "ready", and every summary it returned would be marked read before being shown.
  const reloadLists = useCallback(() => {
    reloadFollows();
    reloadChannels();
  }, [reloadFollows, reloadChannels]);

  // A failed action shows its message on the row. The lists reload whether the call succeeded or
  // failed: a request that reached the server but lost its response would otherwise leave the row
  // stale, and no poll would correct it, since polling runs only while a followed channel is requested.
  async function withBusy(channelId: string, work: () => Promise<unknown>) {
    setBusy((current) => new Set(current).add(channelId));
    setErrors(({ [channelId]: _cleared, ...rest }) => rest);
    try {
      await work();
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [channelId]: caught instanceof Error ? caught.message : String(caught),
      }));
    } finally {
      reloadLists();
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
  const requestAgain = (channelId: string) =>
    withBusy(channelId, () => api.requestChannel(channelId));

  const followList = follows.status === "ready" ? follows.data.follows : [];
  const hasApprovedFollow = followList.some(
    (f) => f.channel.status === "approved",
  );
  const available =
    channels.status === "ready"
      ? channels.data.channels.filter((c) => !c.following)
      : [];

  // While a followed channel is awaiting the owner's decision, poll the lists so an approval or
  // decline shows up without a manual reload; stop as soon as nothing is left pending.
  const hasRequestedFollow = followList.some(
    (f) => f.channel.status === "requested",
  );
  useEffect(() => {
    if (!hasRequestedFollow) return;
    const id = setInterval(reloadLists, 15_000);
    return () => clearInterval(id);
  }, [hasRequestedFollow, reloadLists]);

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
        hasApprovedFollow={follows.status !== "ready" || hasApprovedFollow}
        available={available}
        busy={busy}
        errors={errors}
        onFollow={follow}
        showingWeek={showingWeek}
        onToggleWeek={() => setShowingWeek((w) => !w)}
        onRefresh={reloadLists}
        onRetry={reloadDigest}
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
            errors={errors}
            onUnfollow={unfollow}
            onRequestAgain={requestAgain}
          />
        )}

        <h3>Catalog ({available.length})</h3>
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
          <CatalogList
            channels={available}
            busy={busy}
            errors={errors}
            onFollow={follow}
          />
        )}

        <AddChannel onChanged={reloadLists} />
      </section>
    </main>
  );
}
