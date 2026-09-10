import type { Channel as ChannelData } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { ApiError, api } from "../api";
import { EpisodeItem } from "../components/EpisodeItem";
import { Nav } from "../components/Nav";
import { Time } from "../components/Time";
import { channelStateCopy, reviewCopy } from "../lib/copy";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Channel() {
  return (
    <Guard>
      <ChannelScreen />
    </Guard>
  );
}

/**
 * One channel, any status (spec §7). Requested: awaiting-approval line, Follow or Unfollow, no
 * episodes. Approved: as today, with skipped and pending episodes listed by title and phrase.
 * Declined: the owner's note and Request again, plus titles-only episodes when it had been
 * approved. Followers of an approved channel see summaries newest first, and the API records
 * their read receipts; everyone else sees titles only. No chat input here.
 */
function ChannelScreen() {
  const { params } = useRoute();
  const channelId = params.id ?? "";
  const [channel, reloadChannel] = useLoad(
    () => api.getChannel(channelId),
    [channelId],
  );
  // A requested channel has no episodes at all, so its episodes load never fires; the load starts
  // once the channel is known and is not requested.
  const [episodes, reloadEpisodes] = useLoad(
    () => api.listEpisodes(channelId),
    [channelId],
    {
      enabled:
        channel.status === "ready" &&
        channel.data.channel.status !== "requested",
    },
  );
  const [busy, setBusy] = useState(false);

  async function toggleFollow(following: boolean) {
    setBusy(true);
    try {
      if (following) await api.unfollow(channelId);
      else await api.follow(channelId);
      reloadChannel();
      reloadEpisodes();
    } finally {
      setBusy(false);
    }
  }

  async function requestAgain(c: ChannelData) {
    if (!window.confirm(`${reviewCopy(c) ?? "Declined"}. Ask the owner again?`))
      return;
    setBusy(true);
    try {
      await api.requestChannel(channelId);
      reloadChannel();
      reloadEpisodes();
    } finally {
      setBusy(false);
    }
  }

  const showEpisodes =
    channel.status === "ready" &&
    channel.data.channel.status !== "requested" &&
    (channel.data.channel.status !== "declined" ||
      channel.data.channel.approvedAt !== null);

  return (
    <main>
      <Nav />
      <p>
        <a href="/home">← Home</a>
      </p>
      {channel.status === "loading" && <p>Loading…</p>}
      {channel.status === "error" &&
        (channel.error instanceof ApiError && channel.error.status === 404 ? (
          <p>This channel is not in the catalog.</p>
        ) : (
          <p class="error">
            Couldn't load the channel: {channel.error.message}.{" "}
            <button id="channel-retry" type="button" onClick={reloadChannel}>
              Retry
            </button>
          </p>
        ))}
      {channel.status === "ready" && (
        <ChannelDetail
          channel={channel.data.channel}
          busy={busy}
          onToggleFollow={() => toggleFollow(channel.data.channel.following)}
          onRequestAgain={() => requestAgain(channel.data.channel)}
        />
      )}
      {showEpisodes && (
        <>
          <h2>Episodes</h2>
          {episodes.status === "loading" && <p>Loading…</p>}
          {episodes.status === "error" && (
            <p class="error">
              Couldn't load episodes: {episodes.error.message}.{" "}
              <button
                id="episodes-retry"
                type="button"
                onClick={reloadEpisodes}
              >
                Retry
              </button>
            </p>
          )}
          {episodes.status === "ready" &&
            episodes.data.episodes.length === 0 && (
              <p class="muted">No episodes yet.</p>
            )}
          {episodes.status === "ready" &&
            episodes.data.episodes.map((episode) => (
              <EpisodeItem
                key={episode.videoId}
                episode={episode}
                showChannel={false}
              />
            ))}
        </>
      )}
    </main>
  );
}

/** The header and status-specific controls (spec §7): requested, approved, or declined. */
function ChannelDetail({
  channel: c,
  busy,
  onToggleFollow,
  onRequestAgain,
}: {
  channel: ChannelData;
  busy: boolean;
  onToggleFollow: () => void;
  onRequestAgain: () => void;
}) {
  return (
    <>
      <h1>{c.title}</h1>
      <p class="muted">
        <a href={c.canonicalUrl}>{c.channelId}</a>
      </p>
      {c.status === "requested" && (
        <>
          <p>
            {channelStateCopy(c)} · {c.followerCount} following
          </p>
          <p>
            <button
              id="channel-follow-toggle"
              type="button"
              disabled={busy}
              onClick={onToggleFollow}
            >
              {c.following ? "Unfollow" : "Follow"}
            </button>
          </p>
        </>
      )}
      {c.status === "approved" && (
        <>
          <p class="muted">
            {c.episodes.available} summarised · last ingested{" "}
            <Time at={c.lastIngestedAt} fallback="never" />
            {c.paused && " · paused"}
          </p>
          <p>
            <button
              id="channel-follow-toggle"
              type="button"
              disabled={busy}
              onClick={onToggleFollow}
            >
              {c.following ? "Unfollow" : "Follow"}
            </button>
            {!c.following && (
              <span class="help"> Follow to read the summaries.</span>
            )}
          </p>
        </>
      )}
      {c.status === "declined" && (
        <>
          <p>{reviewCopy(c) ?? channelStateCopy(c)}</p>
          <p>
            <button
              id="channel-request-again"
              type="button"
              disabled={busy}
              onClick={onRequestAgain}
            >
              Request again
            </button>
          </p>
        </>
      )}
    </>
  );
}
