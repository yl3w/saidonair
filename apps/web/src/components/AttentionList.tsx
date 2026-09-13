import type { Channel } from "@media-digest/shared";
import { api } from "../api";
import { attemptCountCopy, failureDetailCopy } from "../lib/copy";
import { useLoad } from "../lib/use-load";
import { Time } from "./Time";

export type Act = (
  channelId: string,
  work: () => Promise<unknown>,
) => Promise<void>;

/**
 * **Needs attention** (spec §7; PRD §7): publications that exhausted their 48 hours, grouped by
 * channel with the last reason, launched attempts, Retry, and Skip; then approved channels with no
 * discovery run at all, each with Start.
 */
export function AttentionList({
  channels,
  busy,
  disabled,
  errors,
  act,
}: {
  channels: Channel[];
  busy: Record<string, boolean>;
  disabled: boolean;
  errors: Record<string, string>;
  act: Act;
}) {
  const failedChannels = channels.filter(
    (c) => c.status === "approved" && c.episodes.failed > 0,
  );
  const neverStarted = channels.filter(
    (c) => c.status === "approved" && c.management?.neverStarted,
  );

  return (
    <section id="attention">
      <h2>Needs attention</h2>
      <h3>Failed episodes</h3>
      {failedChannels.length === 0 && <p class="muted">No failed episodes.</p>}
      {failedChannels.map((c) => (
        <FailedEpisodes
          key={c.channelId}
          channel={c}
          busy={disabled || (busy[c.channelId] ?? false)}
          actionError={errors[c.channelId]}
          act={act}
        />
      ))}

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
            {errors[c.channelId] && <p class="error">{errors[c.channelId]}</p>}
          </div>
          <div class="actions">
            <button
              id={`attention-start-${c.channelId}`}
              type="button"
              disabled={disabled || (busy[c.channelId] ?? false)}
              onClick={() => act(c.channelId, () => api.startRun(c.channelId))}
            >
              Start
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * One channel's failed episodes, loaded on their own so a failure here reaches no other channel
 * and can be retried in place (spec §11). The load is keyed on the channel's failed count, so a
 * Retry or Skip that changes it refetches the list instead of leaving the acted-on episode shown.
 */
function FailedEpisodes({
  channel: c,
  busy,
  actionError,
  act,
}: {
  channel: Channel;
  busy: boolean;
  actionError: string | undefined;
  act: Act;
}) {
  const failedCount = c.episodes.failed;
  const [load, reload] = useLoad(
    () =>
      api
        .listEpisodes(c.channelId, 200)
        .then((r) => r.episodes.filter((e) => e.status === "failed")),
    [c.channelId, failedCount],
  );
  return (
    <div>
      <p>
        <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
      </p>
      {load.status === "loading" && <p class="muted">Loading…</p>}
      {load.status === "error" && (
        <p class="error">
          Couldn't load failed episodes: {load.error.message}.{" "}
          <button
            id={`attention-reload-${c.channelId}`}
            type="button"
            onClick={reload}
          >
            Retry
          </button>
        </p>
      )}
      {load.status === "ready" &&
        load.data.map((e) => (
          <div class="row" key={e.videoId}>
            <div class="grow">
              <a href={`https://youtu.be/${e.videoId}`}>{e.title}</a>
              <div class="meta">
                {e.processing.failureCode ?? "unknown failure"}
                {e.processing.failureDetail &&
                  ` · ${failureDetailCopy(e.processing.failureDetail)}`}
                {" · "}
                {attemptCountCopy(e.processing.attemptCount)} · failed{" "}
                <Time at={e.processing.updatedAt} />
              </div>
            </div>
            <div class="actions">
              <button
                id={`retry-${e.videoId}`}
                type="button"
                disabled={busy}
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
                disabled={busy}
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
      {actionError && <p class="error">{actionError}</p>}
    </div>
  );
}
