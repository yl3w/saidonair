import type { Channel, Episode } from "@media-digest/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Time } from "./Time";

export type Act = (channelId: string, work: () => Promise<unknown>) => void;

/** **Needs attention** (spec §7): failed episodes grouped by channel, then channels never started. */
export function AttentionList({
  channels,
  busy,
  errors,
  act,
}: {
  channels: Channel[];
  busy: Record<string, boolean>;
  errors: Record<string, string>;
  act: Act;
}) {
  const failedChannels = channels.filter(
    (c) => c.status === "approved" && (c.management?.episodes.failed ?? 0) > 0,
  );
  const neverStarted = channels.filter(
    (c) => c.status === "approved" && c.management?.neverStarted,
  );
  const failedChannelIds = failedChannels.map((c) => c.channelId);
  const failedChannelIdsKey = failedChannelIds.join(",");

  const [episodesByChannel, setEpisodesByChannel] = useState<
    Record<string, Episode[]>
  >({});

  useEffect(() => {
    let cancelled = false;
    if (failedChannelIds.length === 0) {
      setEpisodesByChannel({});
      return;
    }
    Promise.all(
      failedChannelIds.map((id) =>
        api
          .listEpisodes(id, 200)
          .then(
            (r) =>
              [id, r.episodes.filter((e) => e.status === "failed")] as const,
          ),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, Episode[]> = {};
      for (const [id, list] of pairs) next[id] = list;
      setEpisodesByChannel(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedChannelIdsKey]);

  return (
    <section id="attention">
      <h2>Needs attention</h2>
      <h3>Failed episodes</h3>
      {failedChannels.length === 0 && <p class="muted">No failed episodes.</p>}
      {failedChannels.map((c) => {
        const episodes = episodesByChannel[c.channelId];
        return (
          <div key={c.channelId}>
            <p>
              <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
            </p>
            {episodes === undefined && <p class="muted">Loading…</p>}
            {episodes?.map((e) => (
              <div class="row" key={e.videoId}>
                <div class="grow">
                  <a href={`https://youtu.be/${e.videoId}`}>{e.title}</a>
                  <div class="meta">
                    {e.processing?.failureCode ?? "unknown failure"} · attempt{" "}
                    {e.processing?.attemptCount ?? 0}
                  </div>
                </div>
                <div class="actions">
                  <button
                    id={`retry-${e.videoId}`}
                    type="button"
                    disabled={busy[c.channelId]}
                    onClick={() =>
                      act(c.channelId, () =>
                        api.retryEpisode(c.channelId, e.videoId),
                      )
                    }
                  >
                    Retry
                  </button>
                  <button
                    id={`skip-${e.videoId}`}
                    type="button"
                    disabled={busy[c.channelId]}
                    onClick={() =>
                      act(c.channelId, () =>
                        api.skipEpisode(c.channelId, e.videoId),
                      )
                    }
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
            {errors[c.channelId] && <p class="error">{errors[c.channelId]}</p>}
          </div>
        );
      })}

      <h3>Approved, never started</h3>
      {neverStarted.length === 0 && (
        <p class="muted">Nothing approved is waiting to start.</p>
      )}
      {neverStarted.map((c) => (
        <div class="row" key={c.channelId}>
          <div class="grow">
            <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
            <div class="meta">
              approved <Time at={c.approvedAt} />, never started
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
