import type { Channel, Episode } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { api } from "../api";
import {
  type ChannelAct,
  ChannelStatusActions,
} from "../components/ChannelStatusActions";
import { Nav } from "../components/Nav";
import { Time } from "../components/Time";
import {
  channelStateCopy,
  EPISODE_STATUS_COPY,
  SKIP_REASON_COPY,
  WAITING_CODE_COPY,
} from "../lib/copy";
import { type Load, useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function OwnerChannel() {
  return (
    <Guard ownerOnly>
      <OwnerChannelScreen />
    </Guard>
  );
}

/** One channel for the owner (spec §8): management header, episodes, runs, followers. */
function OwnerChannelScreen() {
  const { params } = useRoute();
  const channelId = params.id ?? "";
  const [channel, reloadChannel] = useLoad(
    () => api.getChannel(channelId),
    [channelId],
  );
  const [episodes, reloadEpisodes] = useLoad(
    () => api.listEpisodes(channelId, 200),
    [channelId],
  );
  const [runs, reloadRuns] = useLoad(
    () => api.listIngestionRuns(channelId),
    [channelId],
  );
  // Followers are only fetched for a requested channel (spec §7); any other status shows a count.
  const showFollowers =
    channel.status === "ready" && channel.data.channel.status === "requested";
  const [followers, reloadFollowers] = useLoad(
    () => api.listFollowers(channelId),
    [channelId],
    { enabled: showFollowers },
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One action against this channel or one of its episodes; every button reloads through this,
  // on failure as well as success, since the Registry may have applied the change before the
  // response was lost.
  const act: ChannelAct = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      reloadChannel();
      reloadEpisodes();
      reloadRuns();
      setBusy(false);
    }
  };

  const channelApproved =
    channel.status === "ready" && channel.data.channel.status === "approved";

  return (
    <main class="wide">
      <Nav />
      <p>
        <a href="/owner">← Owner</a>
      </p>
      <Section load={channel} label="the channel" reload={reloadChannel}>
        {({ channel: c }) => (
          <Header channel={c} busy={busy} error={error} act={act} />
        )}
      </Section>

      <h2>Episodes</h2>
      <Section load={episodes} label="episodes" reload={reloadEpisodes}>
        {({ episodes: list }) =>
          list.length === 0 ? (
            <p class="muted">No episodes yet.</p>
          ) : (
            <EpisodesTable
              episodes={list}
              channelApproved={channelApproved}
              busy={busy}
              act={act}
            />
          )
        }
      </Section>

      <h2>Runs</h2>
      <Section load={runs} label="ingestion runs" reload={reloadRuns}>
        {({ runs: list }) =>
          list.length === 0 ? (
            <p class="muted">No runs yet.</p>
          ) : (
            <div>
              {list.map((run) => (
                <details key={run.runId}>
                  <summary>
                    {run.kind} · {run.status} · started{" "}
                    <Time at={run.startedAt} /> · finished{" "}
                    <Time at={run.finishedAt} />
                    {run.failureCode && ` · ${run.failureCode}`}
                    {run.episodeLimit !== null &&
                      ` · limit ${run.episodeLimit}`}
                  </summary>
                  {run.failureDetail && (
                    <p class="muted">{run.failureDetail}</p>
                  )}
                  {run.episodes.length === 0 ? (
                    <p class="muted">No episode outcomes recorded.</p>
                  ) : (
                    <ul>
                      {run.episodes.map((re) => (
                        <li key={re.videoId}>
                          {re.videoId} · {re.status.replace("_", " ")}
                          {re.failureCode && ` · ${re.failureCode}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}
            </div>
          )
        }
      </Section>

      <h2>Followers</h2>
      <Section load={channel} label="the channel" reload={reloadChannel}>
        {({ channel: c }) =>
          c.status === "requested" ? (
            <Section
              load={followers}
              label="followers"
              reload={reloadFollowers}
            >
              {({ followers: list }) =>
                list.length === 0 ? (
                  <p class="muted">Nobody is waiting.</p>
                ) : (
                  <ul>
                    {list.map((f) => (
                      <li key={f.email}>
                        {f.email} · followed <Time at={f.followedAt} />
                      </li>
                    ))}
                  </ul>
                )
              }
            </Section>
          ) : (
            <p>{followerLabel(c.followerCount)}</p>
          )
        }
      </Section>
    </main>
  );
}

/** State copy, review history, pause state, import and follower counts, and the actions the status allows. */
function Header({
  channel: c,
  busy,
  error,
  act,
}: {
  channel: Channel;
  busy: boolean;
  error: string | null;
  act: ChannelAct;
}) {
  const m = c.management;
  return (
    <>
      <h1>{c.title}</h1>
      <p class="muted">
        <a href={c.canonicalUrl}>{c.channelId}</a> · {channelStateCopy(c)}
        {" · approved since "}
        <Time at={c.approvedAt} fallback="never" />
        {c.reviewedAt !== null && (
          <>
            {" · reviewed "}
            <Time at={c.reviewedAt} />
            {m?.reviewedByEmail && ` by ${m.reviewedByEmail}`}
            {c.reviewNote && ` “${c.reviewNote}”`}
          </>
        )}
        {c.paused && (
          <>
            {" · paused since "}
            <Time at={m?.pausedAt ?? null} />
          </>
        )}
        {m && (
          <>
            {` · import count ${m.initialImportCount} · `}
            {followerLabel(c.followerCount)}
          </>
        )}
      </p>
      <ChannelStatusActions
        channel={c}
        busy={busy}
        idPrefix="detail-"
        act={act}
      />
      {error && <p class="error">{error}</p>}
    </>
  );
}

/** Every episode of the channel, with retry and skip where the channel's status allows them. */
function EpisodesTable({
  episodes: list,
  channelApproved,
  busy,
  act,
}: {
  episodes: Episode[];
  channelApproved: boolean;
  busy: boolean;
  act: ChannelAct;
}) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Published</th>
            <th>Status</th>
            <th>Waiting</th>
            <th>Attempts</th>
            <th>Reason</th>
            <th>Chunks</th>
            <th>Summary</th>
            <th>Processed</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => {
            const p = e.processing;
            return (
              <tr key={e.videoId}>
                <td class="wrap">
                  <a href={`https://youtu.be/${e.videoId}`}>{e.title}</a>
                </td>
                <td>
                  <Time at={e.publishedAt} />
                </td>
                <td>{EPISODE_STATUS_COPY[e.status]}</td>
                <td>
                  {p?.waitingCode ? WAITING_CODE_COPY[p.waitingCode] : "—"}
                </td>
                <td>{p?.attemptCount ?? "—"}</td>
                <td>
                  {p?.skipReason
                    ? SKIP_REASON_COPY[p.skipReason]
                    : (p?.failureCode ?? "—")}
                </td>
                <td>{p?.chunkCount ?? "—"}</td>
                <td>{e.summary?.format ?? "—"}</td>
                <td>
                  <Time at={p?.processedAt ?? null} />
                </td>
                <td>
                  <EpisodeActions
                    episode={e}
                    channelApproved={channelApproved}
                    busy={busy}
                    act={act}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Retry (failed, skipped) and Skip (failed), only on an approved channel (spec §7). */
function EpisodeActions({
  episode: e,
  channelApproved,
  busy,
  act,
}: {
  episode: Episode;
  channelApproved: boolean;
  busy: boolean;
  act: ChannelAct;
}) {
  if (!channelApproved) return null;
  const canRetry = e.status === "failed" || e.status === "skipped";
  const canSkip = e.status === "failed";
  if (!canRetry && !canSkip) return null;
  return (
    <div class="actions">
      {canRetry && (
        <button
          id={`detail-retry-${e.videoId}`}
          type="button"
          disabled={busy}
          onClick={() => act(() => api.retryEpisode(e.channelId, e.videoId))}
        >
          Retry
        </button>
      )}
      {canSkip && (
        <button
          id={`detail-skip-${e.videoId}`}
          type="button"
          disabled={busy}
          onClick={() => act(() => api.skipEpisode(e.channelId, e.videoId))}
        >
          Skip
        </button>
      )}
    </div>
  );
}

function followerLabel(count: number): string {
  return `${count} follower${count === 1 ? "" : "s"}`;
}

/** Loading and error handling for one section; children render only with data (spec §11). */
function Section<T>({
  load,
  label,
  reload,
  children,
}: {
  load: Load<T>;
  label: string;
  reload: () => void;
  children: (data: T) => preact.JSX.Element;
}) {
  if (load.status === "loading") return <p>Loading…</p>;
  if (load.status === "error") {
    return (
      <p class="error">
        Couldn't load {label}: {load.error.message}.{" "}
        <button type="button" onClick={reload}>
          Retry
        </button>
      </p>
    );
  }
  return children(load.data);
}
