import type { Channel, Episode } from "@media-digest/shared";
import type { ComponentChildren } from "preact";
import { api } from "../api";
import {
  attemptCountCopy,
  CHANNEL_ACTION_COPY,
  failureDetailCopy,
  retryWaitCopy,
} from "../lib/copy";
import { relativeTime } from "../lib/time";
import { useLoad } from "../lib/use-load";
import { Action } from "./ChannelStatusActions";
import { Retry } from "./Retry";

export type Act = (
  channelId: string,
  work: () => Promise<unknown>,
) => Promise<void>;

export type NeedsYou = {
  /** Channels waiting for a decision, oldest request first. */
  waiting: Channel[];
  /** Approved channels holding a publication that exhausted its 48 hours. */
  failed: Channel[];
  /** Approved channels with no discovery run at all. */
  neverStarted: Channel[];
  total: number;
};

/**
 * What needs the owner, derived once so the section, its lists and its emptiness cannot disagree.
 * Each list used to filter the same array for itself, which was fine while every one of them
 * rendered an empty sentence and nothing had to know whether *all* of them were empty.
 */
export function needsYou(channels: readonly Channel[]): NeedsYou {
  const waiting = channels
    .filter((c) => c.status === "requested")
    .sort(
      (a, b) => (a.management?.createdAt ?? 0) - (b.management?.createdAt ?? 0),
    );
  const failed = channels.filter(
    (c) => c.status === "approved" && c.episodes.failed > 0,
  );
  const neverStarted = channels.filter(
    (c) => c.status === "approved" && c.management?.neverStarted,
  );
  return {
    waiting,
    failed,
    neverStarted,
    total: waiting.length + failed.length + neverStarted.length,
  };
}

/**
 * The part of **Needs you** that is episodes rather than channels: publications that exhausted
 * their 48 hours, grouped by channel with the last reason, and approved channels that never started
 * a discovery run at all. Neither paginates — a list of what needs a person is not a list you page
 * through (docs/specs/design-phase.md §4.8).
 */
export function AttentionList({
  failed,
  neverStarted,
  busy,
  disabled,
  errors,
  act,
}: {
  failed: Channel[];
  neverStarted: Channel[];
  busy: Record<string, boolean>;
  disabled: boolean;
  errors: Record<string, string>;
  act: Act;
}) {
  return (
    <>
      <Group title="Failed episodes" count={failed.length}>
        {failed.map((c) => (
          <FailedEpisodes
            key={c.channelId}
            channel={c}
            busy={disabled || (busy[c.channelId] ?? false)}
            actionError={errors[c.channelId]}
            act={act}
          />
        ))}
      </Group>

      <Group title="Approved, never started" count={neverStarted.length}>
        {neverStarted.map((c) => (
          <div
            key={c.channelId}
            class="flex flex-wrap items-center gap-3 border-b border-rule py-3"
          >
            <div class="min-w-0 flex-1">
              <a
                class="text-ui font-semibold text-ink"
                href={`/curate/${c.channelId}`}
              >
                {c.title}
              </a>
              <p class="text-meta text-ink-3">
                approved{" "}
                {c.approvedAt === null ? "—" : relativeTime(c.approvedAt)}, no
                run yet
              </p>
              {errors[c.channelId] && (
                <p class="text-meta text-consequence">{errors[c.channelId]}</p>
              )}
            </div>
            <Action
              id={`attention-start-${c.channelId}`}
              busy={disabled || (busy[c.channelId] ?? false)}
              title={CHANNEL_ACTION_COPY.checkFeedHint}
              onClick={() => act(c.channelId, () => api.startRun(c.channelId))}
            >
              {CHANNEL_ACTION_COPY.checkFeed}
            </Action>
          </div>
        ))}
      </Group>
    </>
  );
}

/**
 * A category of **Needs you**, which renders only when it holds something. A heading, a zero and a
 * sentence explaining the zero, three times over, was how this screen greeted an owner on every
 * healthy day — and a healthy day is the usual one, since the nav carries a count and shows it only
 * when something waits (owner decision 2026-09-15, docs/PRD.md §9). The section says it once
 * instead.
 */
function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ComponentChildren;
}) {
  if (count === 0) return null;
  return (
    <section class="mt-6">
      <h3 class="flex items-baseline gap-2 text-label uppercase text-ink-3">
        {title}
        <span>{count}</span>
      </h3>
      <div class="mt-1 border-t border-rule">{children}</div>
    </section>
  );
}

/**
 * One channel's failed episodes, loaded on their own so a failure here reaches no other channel and
 * can be retried in place. The load is keyed on the channel's failed count, so a Retry or Skip that
 * changes it refetches instead of leaving the acted-on episode on screen.
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
    <div class="border-b border-rule py-3">
      <a class="text-ui font-semibold text-ink" href={`/curate/${c.channelId}`}>
        {c.title}
      </a>

      {load.status === "loading" && <div class="skeleton mt-2 h-8 w-full" />}
      {load.status === "error" && (
        <p class="mt-1 text-meta text-consequence">
          Couldn't load its failed episodes: {load.error.message}.{" "}
          <Retry id={`attention-reload-${c.channelId}`} onClick={reload} />
        </p>
      )}

      {load.status === "ready" &&
        load.data.map((e) => (
          <EpisodeRow
            key={e.episodeId}
            episode={e}
            busy={busy}
            act={(work) => act(c.channelId, work)}
          />
        ))}

      {actionError && (
        <p class="mt-1 text-meta text-consequence">{actionError}</p>
      )}
    </div>
  );
}

/**
 * A failed episode with the two things that can be done to it. **Skip renders on failed episodes
 * only** (docs/PRD.md §7), which is what this list holds; Retry says on the row when it is not
 * available yet and who started the attempt that is holding it, rather than greying out silently.
 */
function EpisodeRow({
  episode: e,
  busy,
  act,
}: {
  episode: Episode;
  busy: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const wait = retryWaitCopy(e.processing.latestAttempt);
  return (
    <div class="mt-2 flex flex-wrap items-center gap-3 pl-3">
      <div class="min-w-0 flex-1">
        <a class="text-cell text-ink" href={`https://youtu.be/${e.episodeId}`}>
          {e.title}
        </a>
        <p class="text-meta text-ink-3">
          {e.processing.failureCode ?? "unknown failure"}
          {e.processing.failureDetail &&
            ` · ${failureDetailCopy(e.processing.failureDetail)}`}
          {` · ${attemptCountCopy(e.processing.attemptCount)} · failed ${relativeTime(e.processing.updatedAt)}`}
        </p>
        {wait !== null && <p class="text-meta text-owner">{wait}</p>}
      </div>
      <Action
        id={`retry-${e.episodeId}`}
        busy={busy || wait !== null}
        onClick={() => act(() => api.retryEpisode(e.channelId, e.episodeId))}
      >
        Retry
      </Action>
      <Action
        id={`skip-${e.episodeId}`}
        busy={busy}
        tone="consequence"
        onClick={() => act(() => api.skipEpisode(e.channelId, e.episodeId))}
      >
        Skip
      </Action>
    </div>
  );
}
