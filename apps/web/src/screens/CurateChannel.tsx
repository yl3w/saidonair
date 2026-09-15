import type { Channel, Episode } from "@media-digest/shared";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { api } from "../api";
import {
  Action,
  type ChannelAct,
  ChannelStatusActions,
} from "../components/ChannelStatusActions";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import { Time } from "../components/Time";
import {
  actionErrorCopy,
  attemptCountCopy,
  channelStateCopy,
  EPISODE_STATUS_COPY,
  failureDetailCopy,
  intentCopy,
  OUTCOME_CODE_COPY,
  retryWaitCopy,
  runningForCopy,
  runResultCopy,
  SKIP_REASON_COPY,
  WAIT_REASON_COPY,
} from "../lib/copy";
import { type Load, useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function CurateChannel() {
  return (
    <Guard ownerOnly>
      <CurateChannelScreen />
    </Guard>
  );
}

/** One channel for the owner (spec §8; PRD §7): management header, discovery runs, episodes, followers. */
function CurateChannelScreen() {
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
    <Page measure="wide" desktopOnly>
      <p>
        <a
          class="inline-flex min-h-11 items-center text-ui text-primary"
          href="/curate"
        >
          ← Curate
        </a>
      </p>
      <Section load={channel} label="the channel" reload={reloadChannel}>
        {({ channel: c }) => (
          <Header channel={c} busy={busy} error={error} act={act} />
        )}
      </Section>

      <h2 class="mt-8 font-reading text-section font-semibold text-ink">
        Discovery runs
      </h2>
      <Section load={runs} label="discovery runs" reload={reloadRuns}>
        {({ runs: list }) =>
          list.length === 0 ? (
            <p class="mt-2 font-reading text-excerpt text-ink-2">
              No runs yet: Start checks the feed now.
            </p>
          ) : (
            <ul class="mt-2 text-cell text-ink-2">
              {list.map((run) => (
                <li key={run.runId} class="border-b border-rule py-2">
                  {run.kind} · {runResultCopy(run)} · checked{" "}
                  <Time at={run.finishedAt} />
                  {run.episodeLimit !== null && ` · limit ${run.episodeLimit}`}
                </li>
              ))}
            </ul>
          )
        }
      </Section>

      <h2 class="mt-8 font-reading text-section font-semibold text-ink">
        Episodes
      </h2>
      <Section load={episodes} label="episodes" reload={reloadEpisodes}>
        {({ episodes: list }) =>
          list.length === 0 ? (
            <p class="mt-2 font-reading text-excerpt text-ink-2">
              No episodes yet.
            </p>
          ) : (
            <EpisodesTable episodes={list} busy={busy} act={act} />
          )
        }
      </Section>

      <h2 class="mt-8 font-reading text-section font-semibold text-ink">
        Followers
      </h2>
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
                  <p class="mt-2 font-reading text-excerpt text-ink-2">
                    Nobody is waiting.
                  </p>
                ) : (
                  <ul class="mt-2 text-cell text-ink-2">
                    {list.map((f) => (
                      <li key={f.email} class="border-b border-rule py-2">
                        {f.email} · followed <Time at={f.followedAt} />
                      </li>
                    ))}
                  </ul>
                )
              }
            </Section>
          ) : (
            <p class="mt-2 text-cell text-ink-2">
              {followerLabel(c.followerCount)}
            </p>
          )
        }
      </Section>
    </Page>
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
      <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
        {c.title}
      </h1>
      <p class="mt-1 text-meta text-ink-3">
        <a class="text-primary" href={c.canonicalUrl}>
          {c.channelId}
        </a>{" "}
        · {channelStateCopy(c)}
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
      <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
        <span class="text-label uppercase text-owner">Owner</span>
        <ChannelStatusActions
          channel={c}
          busy={busy}
          idPrefix="detail-"
          scope="everything"
          act={act}
        />
      </div>
      {error !== null && <p class="mt-2 text-ui text-consequence">{error}</p>}
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
    <div class="mt-2 overflow-x-auto">
      <table class="w-full border-collapse text-cell">
        <thead>
          <tr class="border-b border-edge text-left">
            <th class="py-2 pr-4 font-semibold text-ink-3">Title</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Published</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Status</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Window</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Attempts</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Chunks</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Summary</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Available since</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => {
            const p = e.processing;
            return (
              <tr key={e.episodeId} class="border-b border-rule align-top">
                <td class="py-2 pr-4">
                  <a href={`https://youtu.be/${e.episodeId}`}>{e.title}</a>
                </td>
                <td class="py-2 pr-4 text-ink-2">
                  <Time at={e.publishedAt} />
                </td>
                <td class="py-2 pr-4 text-ink-2">{statusCopy(e)}</td>
                <td class="py-2 pr-4 text-ink-2">
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
                <td class="py-2 pr-4 text-ink-2">
                  {attemptCountCopy(p.attemptCount)}
                  {p.latestAttempt && ` · ${latestAttemptCopy(e)}`}
                </td>
                <td class="py-2 pr-4 text-ink-2">{p.chunkCount ?? "—"}</td>
                <td class="py-2 pr-4 text-ink-2">{e.summary?.format ?? "—"}</td>
                <td class="py-2 pr-4 text-ink-2">
                  <Time at={e.summaryAvailableAt} />
                </td>
                <td class="py-2 pr-4 text-ink-2">
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
 * Retry on every row; **Skip on failed rows only** (docs/PRD.md §7), which is why a pending episode
 * offers Retry alone. An unavailable Retry carries its reason on the row — who started the attempt
 * that is holding it and when it frees up — rather than being a dead grey control (docs/design.md §4);
 * after an hour the route reconciles a lost instance itself (docs/PRD.md §4.2 rule 17).
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
  const wait = retryWaitCopy(e.processing.latestAttempt);
  return (
    <div class="flex flex-wrap items-center gap-1">
      <Action
        id={`detail-retry-${e.episodeId}`}
        busy={busy || wait !== null}
        onClick={() => act(() => api.retryEpisode(e.channelId, e.episodeId))}
      >
        Retry
      </Action>
      {e.status === "failed" && (
        <Action
          id={`detail-skip-${e.episodeId}`}
          busy={busy}
          tone="consequence"
          onClick={() => act(() => api.skipEpisode(e.channelId, e.episodeId))}
        >
          Skip
        </Action>
      )}
      {wait !== null && (
        <span class="block w-full text-meta text-owner">{wait}</span>
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
  children: (data: T) => JSX.Element;
}) {
  if (load.status === "loading")
    return <div class="skeleton mt-2 h-8 w-full" />;
  if (load.status === "error") {
    return (
      <p class="mt-2 text-ui text-consequence">
        Couldn't load {label}: {load.error.message}. <Retry onClick={reload} />
      </p>
    );
  }
  return children(load.data);
}
