import type { Channel, DigestResponse } from "@media-digest/shared";
import type { Load } from "../lib/use-load";
import { CatalogList } from "./ChannelList";
import { EpisodeItem } from "./EpisodeItem";
import { Time } from "./Time";

/**
 * Today's digest (spec §6.3). Two empty states: no active follows shows the catalog
 * inline with follow controls; follows but nothing new shows the fixed sentence.
 */
export function Digest({
  load,
  hasFollows,
  available,
  busy,
  onFollow,
  showingWeek,
  onToggleWeek,
  onRetry,
}: {
  load: Load<DigestResponse>;
  hasFollows: boolean;
  available: Channel[];
  busy: ReadonlySet<string>;
  onFollow: (channelId: string) => void;
  showingWeek: boolean;
  onToggleWeek: () => void;
  onRetry: () => void;
}) {
  return (
    <section id="digest">
      <h2>Today's digest</h2>
      {!hasFollows && (
        <>
          <p>Follow a channel to start your digest.</p>
          <CatalogList channels={available} busy={busy} onFollow={onFollow} />
        </>
      )}
      {hasFollows && load.status === "loading" && <p>Loading…</p>}
      {hasFollows && load.status === "error" && (
        <p class="error">
          Couldn't load the digest: {load.error.message}.{" "}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {hasFollows && load.status === "ready" && (
        <>
          <p class="muted">
            since <Time at={load.data.since} /> ·{" "}
            <button type="button" onClick={onToggleWeek}>
              {showingWeek ? "Show last 24 hours" : "Show last 7 days"}
            </button>
          </p>
          {load.data.episodes.length === 0 ? (
            <p>Nothing new since yesterday.</p>
          ) : (
            load.data.episodes.map((episode) => (
              <EpisodeItem key={episode.videoId} episode={episode} />
            ))
          )}
        </>
      )}
    </section>
  );
}
