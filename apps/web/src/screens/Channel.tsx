import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { ApiError, api } from "../api";
import { EpisodeItem } from "../components/EpisodeItem";
import { Nav } from "../components/Nav";
import { Time } from "../components/Time";
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
 * One available channel (AGENTS.md → Screens). Followers see summaries newest first, and the API
 * records their read receipts; non-followers see titles and a Follow control. No chat input here.
 */
function ChannelScreen() {
  const { params } = useRoute();
  const channelId = params.id ?? "";
  const [channel, reloadChannel] = useLoad(
    () => api.getChannel(channelId),
    [channelId],
  );
  const [episodes, reloadEpisodes] = useLoad(
    () => api.listEpisodes(channelId),
    [channelId],
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

  return (
    <main>
      <Nav />
      <p>
        <a href="/home">← Home</a>
      </p>
      {channel.status === "loading" && <p>Loading…</p>}
      {channel.status === "error" &&
        (channel.error instanceof ApiError && channel.error.status === 404 ? (
          <p>This channel is not available.</p>
        ) : (
          <p class="error">
            Couldn't load the channel: {channel.error.message}.{" "}
            <button type="button" onClick={reloadChannel}>
              Retry
            </button>
          </p>
        ))}
      {channel.status === "ready" && (
        <>
          <h1>{channel.data.channel.title}</h1>
          <p class="muted">
            <a href={channel.data.channel.canonicalUrl}>
              {channel.data.channel.channelId}
            </a>{" "}
            · {channel.data.channel.processedCount} processed · last ingested{" "}
            <Time at={channel.data.channel.lastIngestedAt} fallback="never" />
          </p>
          <p>
            <button
              type="button"
              disabled={busy}
              onClick={() => toggleFollow(channel.data.channel.following)}
            >
              {channel.data.channel.following ? "Unfollow" : "Follow"}
            </button>
            {!channel.data.channel.following && (
              <span class="help"> Follow to read the summaries.</span>
            )}
          </p>
        </>
      )}
      <h2>Episodes</h2>
      {episodes.status === "loading" && <p>Loading…</p>}
      {episodes.status === "error" && channel.status !== "error" && (
        <p class="error">
          Couldn't load episodes: {episodes.error.message}.{" "}
          <button type="button" onClick={reloadEpisodes}>
            Retry
          </button>
        </p>
      )}
      {episodes.status === "ready" && episodes.data.episodes.length === 0 && (
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
    </main>
  );
}
