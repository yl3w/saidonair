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
  actionErrorCopy,
  attemptCountCopy,
  channelStateCopy,
  EPISODE_STATUS_COPY,
  failureDetailCopy,
  intentCopy,
  OUTCOME_CODE_COPY,
  runningForCopy,
  runResultCopy,
  SKIP_REASON_COPY,
  WAIT_REASON_COPY,
} from "../lib/copy";
import { HOUR } from "../lib/time";
import { type Load, useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function OwnerChannel() {
  return (
    <Guard ownerOnly>
      <OwnerChannelScreen />
    </Guard>
  );
}

/** One channel for the owner (spec §8; PRD §7): management header, discovery runs, episodes, followers. */
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
      setError(actionErrorCopy(caught));
    } finally {
      reloadChannel();
      reloadEpisodes();
      reloadRuns();
      setBusy(false);
    }
  };

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

      <h2>Discovery runs</h2>
      <Section load={runs} label="discovery runs" reload={reloadRuns}>
        {({ runs: list }) =>
          list.length === 0 ? (
            <p class="muted">No runs yet: Start checks the feed now.</p>
          ) : (
            <ul>
              {list.map((run) => (
                <li key={run.runId}>
                  {run.kind} · {runResultCopy(run)} · checked{" "}
                  <Time at={run.finishedAt} />
                  {run.episodeLimit !== null && ` · limit ${run.episodeLimit}`}
                </li>
              ))}
            </ul>
          )
        }
      </Section>

      <h2>Episodes</h2>
      <Section load={episodes} label="episodes" reload={reloadEpisodes}>
        {({ episodes: list }) =>
          list.length === 0 ? (
            <p class="muted">No episodes yet.</p>
          ) : (
            <EpisodesTable episodes={list} busy={busy} act={act} />
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
            {" · feed read "}
            <Time at={m.lastCheckedAt} fallback="never" />
            {" · latest run "}
            {m.latestRun
              ? `${m.latestRun.kind} · ${runResultCopy(m.latestRun)}`
              : "none"}
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

/**
 * Every episode of the channel (PRD §7): content status, the open window's intent with next attempt
 * and deadline, launched attempts beside the latest attempt's phrase, summary format, and the
 * actions. Channel status never disables an episode action.
 */
function EpisodesTable({
  episodes: list,
  busy,
  act,
}: {
  episodes: Episode[];
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
            <th>Window</th>
            <th>Attempts</th>
            <th>Chunks</th>
            <th>Summary</th>
            <th>Available since</th>
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
                <td>{statusCopy(e)}</td>
                <td>
                  {p.intent === null ? (
                    "—"
                  ) : (
                    <>
                      {intentCopy(p.intent)}
                      {" · next attempt "}
                      <Time at={p.nextAttemptAt} />
                      {" · deadline "}
                      <Time at={p.windowDeadlineAt} />
                    </>
                  )}
                </td>
                <td>
                  {attemptCountCopy(p.attemptCount)}
                  {p.latestAttempt && ` · ${latestAttemptCopy(e)}`}
                </td>
                <td>{p.chunkCount ?? "—"}</td>
                <td>{e.summary?.format ?? "—"}</td>
                <td>
                  <Time at={e.summaryAvailableAt} />
                </td>
                <td>
                  <EpisodeActions episode={e} busy={busy} act={act} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Retry on every row, disabled only while the latest attempt has been running under an hour (after
 * that the route reconciles a dead instance itself, PRD §4.2 rule 17); Skip on failed rows.
 */
function EpisodeActions({
  episode: e,
  busy,
  act,
}: {
  episode: Episode;
  busy: boolean;
  act: ChannelAct;
}) {
  const latest = e.processing.latestAttempt;
  const runningRecently =
    latest?.status === "running" && Date.now() - latest.startedAt < HOUR;
  return (
    <div class="actions">
      <button
        id={`detail-retry-${e.videoId}`}
        type="button"
        disabled={busy || runningRecently}
        title={runningRecently ? "An attempt is running" : undefined}
        onClick={() => act(() => api.retryEpisode(e.channelId, e.videoId))}
      >
        Retry
      </button>
      {e.status === "failed" && (
        <button
          id={`detail-skip-${e.videoId}`}
          type="button"
          disabled={busy}
          onClick={() => act(() => api.skipEpisode(e.channelId, e.videoId))}
        >
          Skip
        </button>
      )}
      {runningRecently && latest && (
        <span class="muted">{runningForCopy(latest.startedAt)}</span>
      )}
    </div>
  );
}

/** The content status with what explains it: the wait, the skip reason, or the timeout's last reason. */
function statusCopy(e: Episode): string {
  const base = EPISODE_STATUS_COPY[e.status];
  if (e.status === "pending" && e.waitReason)
    return `${base} · ${WAIT_REASON_COPY[e.waitReason]}`;
  if (e.status === "skipped" && e.skipReason)
    return `${base} · ${SKIP_REASON_COPY[e.skipReason]}`;
  const p = e.processing;
  if (e.status === "failed" && p.failureCode) {
    return p.failureDetail
      ? `${base} · ${p.failureCode} · ${failureDetailCopy(p.failureDetail)}`
      : `${base} · ${p.failureCode}`;
  }
  return base;
}

/** The latest attempt's phrase: how long it has run, its outcome, or its status when it has no code. */
function latestAttemptCopy(e: Episode): string {
  const latest = e.processing.latestAttempt;
  if (!latest) return "";
  if (latest.status === "running") return runningForCopy(latest.startedAt);
  const phrase = latest.outcomeCode
    ? OUTCOME_CODE_COPY[latest.outcomeCode]
    : latest.status;
  return `${phrase} (${latest.trigger.replace("_", " ")})`;
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
