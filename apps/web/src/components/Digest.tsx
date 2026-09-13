import type { Channel, DigestResponse } from "@media-digest/shared";
import type { Load } from "../lib/use-load";
import { CatalogList } from "./ChannelList";
import { EpisodeItem } from "./EpisodeItem";
import { Time } from "./Time";

/**
 * Today's digest (spec §6.3; PRD §7). Three empty states: no active follows shows the catalog
 * inline with follow controls; follows with none approved yet points at the channel rows; follows
 * and nothing in the window names the window. Refresh reloads the lists, which re-fetch the digest
 * after them so NEW markers and unread counts describe one moment.
 */
export function Digest({
  load,
  hasFollows,
  hasApprovedFollow,
  available,
  busy,
  errors,
  onFollow,
  showingWeek,
  onToggleWeek,
  onRefresh,
  onRetry,
}: {
  load: Load<DigestResponse>;
  hasFollows: boolean;
  hasApprovedFollow: boolean;
  available: Channel[];
  busy: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  onFollow: (channelId: string) => void;
  showingWeek: boolean;
  onToggleWeek: () => void;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  return (
    <section id="digest">
      <h2>Today's digest</h2>
      {!hasFollows && (
        <>
          <p>Follow a channel to start your digest.</p>
          <CatalogList
            channels={available}
            busy={busy}
            errors={errors}
            onFollow={onFollow}
          />
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
            </button>{" "}
            <button id="digest-refresh" type="button" onClick={onRefresh}>
              Refresh
            </button>
          </p>
          {load.data.episodes.length === 0 ? (
            <p>
              {hasApprovedFollow
                ? `No new summaries in the last ${showingWeek ? "7 days" : "24 hours"}.`
                : "No summaries yet: none of the channels you follow is approved. Their rows below say where each one stands."}
            </p>
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
