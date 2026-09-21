import type { Channel, Episode } from "@media-digest/shared";
import { ChevronDown, ChevronRight } from "lucide-preact";
import { type ComponentChildren, Fragment, type JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { api } from "../api";
import {
  Action,
  type ChannelAct,
  ChannelStatusActions,
} from "../components/ChannelStatusActions";
import { Icon } from "../components/Icon";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import { Time } from "../components/Time";
import {
  actionErrorCopy,
  attemptCountCopy,
  attemptHoldCopy,
  channelStateCopy,
  EPISODE_STATUS_COPY,
  failureDetailCopy,
  inProgressCopy,
  intentCopy,
  isRunning,
  OUTCOME_CODE_COPY,
  RAW_SUMMARY_COPY,
  RETRY_AVAILABLE_HINT,
  runningForCopy,
  runResultCopy,
  SKIP_REASON_COPY,
  WAIT_REASON_COPY,
} from "../lib/copy";
import { useDocumentTitle } from "../lib/title";
import { type Load, useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function CurateChannel() {
  return (
    <Guard ownerOnly>
      <CurateChannelScreen />
    </Guard>
  );
}

/** How often the episode table refetches while an attempt is running; it makes no requests otherwise. */
const REFRESH_MS = 10_000;

/** One channel for the owner (spec §8; PRD §7): management header, discovery runs, episodes, followers. */
function CurateChannelScreen() {
  const { params } = useRoute();
  const channelId = params.id ?? "";
  // `retainDataOnReload` on all four: a reload here is a **refresh of something already on screen**,
  // either after an action or from the poll below, and `Section` answers `loading` with a skeleton
  // that replaces the whole table. Without this the table blanked and redrew every ten seconds,
  // which is a worse thing to look at than a stale row — and the skeleton is a different height, so
  // it moved everything under it each time (owner, 2026-09-17). A dependency change still loads from
  // empty, because that is different data rather than newer data.
  const refresh = { retainDataOnReload: true };
  const [channel, reloadChannel] = useLoad(
    () => api.getChannel(channelId),
    [channelId],
    refresh,
  );
  const [episodes, reloadEpisodes] = useLoad(
    () => api.listEpisodes(channelId, 200),
    [channelId],
    refresh,
  );
  const [runs, reloadRuns] = useLoad(
    () => api.listIngestionRuns(channelId),
    [channelId],
    refresh,
  );
  // Followers are only fetched for a requested channel (spec §7); any other status shows a count.
  const showFollowers =
    channel.status === "ready" && channel.data.channel.status === "requested";
  const [followers, reloadFollowers] = useLoad(
    () => api.listFollowers(channelId),
    [channelId],
    { enabled: showFollowers, ...refresh },
  );

  // Which channel, and which of the two screens about it: a source's page and its review carry the
  // same title otherwise, and an owner has both open.
  useDocumentTitle(
    channel.status === "ready"
      ? `${channel.data.channel.title} · Curate`
      : "Curate",
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * **While an attempt is running, the table refetches itself** (2026-09-17). Everything else here
   * reloads only when a button is pressed, which is right for a screen whose facts change when the
   * owner changes them — but an attempt is the one thing that changes on its own, takes minutes,
   * and is the reason a control is unavailable. Without this the owner presses Retry and the row is
   * frozen until they think to reload, which is what made the screen read as broken rather than
   * busy.
   *
   * Stops when nothing is running, so a settled screen makes no requests. `REFRESH_MS` is well
   * inside a typical attempt (two to three minutes), and the request is one already-cheap list.
   */
  const anyRunning =
    episodes.status === "ready" &&
    episodes.data.episodes.some((e) =>
      isRunning(e.processing?.latestAttempt ?? null),
    );
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(reloadEpisodes, REFRESH_MS);
    return () => clearInterval(timer);
  }, [anyRunning, reloadEpisodes]);

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
          class="inline-flex min-h-11 items-center text-ui link link-hover link-primary"
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

      {/* TODO(owner): **always list the addresses**, whatever the channel's status — decided
          2026-09-21, deferred until the route-visibility plan is finished.

          Today they are fetched only for a `requested` channel, because they exist to answer "who
          is waiting", which is what the review decision turns on (PRD §7). Every other status
          falls through to a count the header line already prints six facts higher up —
          "UC… · Approved · 3 followers" — so the heading and the section repeat one number.

          Withholding them was never really a privacy rule, and since 2026-09-21 it cannot be one:
          this route is the owner's (docs/specs/route-visibility.md §3). Listing them always gives
          the section something the header cannot say — which three people a withdrawal would
          actually affect, before Withdraw approval is pressed. The change is `showFollowers` and
          the `requested` branch below; record it in docs/design.md when it lands. */}
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
      {/* Identity, then the facts in a labelled grid. They were one sentence of up to nine clauses
          chained with "·" at 12.5 px, which is density from small type rather than from structure
          (docs/design.md principle 6, owner decision 2026-09-15). */}
      <p class="mt-1 text-meta text-ink-3">
        <a class="link link-hover link-primary" href={c.canonicalUrl}>
          {c.channelId}
        </a>{" "}
        · {channelStateCopy(c)} · {followerLabel(c.followerCount)}
      </p>
      <dl class="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-cell lg:grid-cols-[auto_1fr_auto_1fr]">
        <Fact label="Approved">
          <Time at={c.approvedAt} fallback="never" />
        </Fact>
        <Fact label="Feed read">
          <Time at={m?.lastCheckedAt ?? null} fallback="never" />
        </Fact>
        <Fact label="Latest run">
          {m?.latestRun
            ? `${m.latestRun.kind} · ${runResultCopy(m.latestRun)}`
            : "none"}
        </Fact>
        <Fact label="Import count">{m?.initialImportCount ?? "—"}</Fact>
        {c.reviewedAt !== null && (
          <Fact label="Reviewed">
            <Time at={c.reviewedAt} />
            {m?.reviewedByEmail && ` by ${m.reviewedByEmail}`}
            {c.reviewNote && ` “${c.reviewNote}”`}
          </Fact>
        )}
        {c.paused && (
          <Fact label="Paused">
            <Time at={m?.pausedAt ?? null} />
          </Fact>
        )}
      </dl>
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
 * Every episode of the channel. **Four columns answer the question this screen exists for** — which
 * episode, when it was published, what state it is in, and what the owner can do — and everything
 * else opens on the row that needs it (owner decision 2026-09-15, PRD §7 and §9).
 *
 * Nine columns were on by default, and five of them were diagnosis: the window is `—` on every
 * healthy row, attempts and chunks matter only when something is wrong, "available since" answers
 * nothing anyone asks here, and the summary format said `structured` on every working row — a
 * constant with a heading. Its opposite is not: `raw_fallback` means the model's JSON never parsed
 * and a reader is looking at raw text, so that one is promoted into the state, where it can be
 * acted on.
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
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (episodeId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(episodeId)) next.add(episodeId);
      return next;
    });

  return (
    <div class="mt-2 overflow-x-auto">
      <table class="w-full border-collapse text-cell">
        <thead>
          <tr class="border-b border-edge text-left">
            <th class="py-2 pr-2">
              <span class="sr-only">Diagnostics</span>
            </th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Episode</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Published</th>
            {/* The one column whose text changes while the reader watches: "Summarised" becomes
                "Re-processing · running for 12 min" and back. In an auto-layout table that
                reallocates every column and the whole row shifts sideways, so the column reserves
                the width the longest in-progress phrase needs and stops moving (owner, 2026-09-17). */}
            <th class="min-w-56 py-2 pr-4 font-semibold text-ink-3">State</th>
            <th class="py-2 pr-4 font-semibold text-ink-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => {
            const shown = open.has(e.episodeId);
            const panel = `diagnostics-${e.episodeId}`;
            return (
              <Fragment key={e.episodeId}>
                <tr class="border-b border-rule align-middle">
                  <td class="py-2 pr-2">
                    <button
                      type="button"
                      class="btn btn-ghost btn-square"
                      aria-expanded={shown}
                      aria-controls={panel}
                      aria-label={`Diagnostics for "${e.title}"`}
                      onClick={() => toggle(e.episodeId)}
                    >
                      <Icon of={shown ? ChevronDown : ChevronRight} size={16} />
                    </button>
                  </td>
                  <td class="py-2 pr-4">
                    <a href={`https://youtu.be/${e.episodeId}`}>{e.title}</a>
                  </td>
                  <td class="py-2 pr-4 text-ink-2">
                    <Time at={e.publishedAt} />
                  </td>
                  <td class="py-2 pr-4 text-ink-2">{statusCopy(e)}</td>
                  <td class="py-2 pr-4 text-ink-2">
                    <EpisodeActions episode={e} busy={busy} act={act} />
                  </td>
                </tr>
                {shown && (
                  <tr id={panel} class="border-b border-rule">
                    <td />
                    <td colSpan={4} class="pb-3 pr-4">
                      <Diagnostics episode={e} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the row does not show until it is asked: the window, the attempts, and the vector counts. */
function Diagnostics({ episode: e }: { episode: Episode }) {
  const p = e.processing;
  // Absent only for a caller with no session, which no screen behind the guard is
  // (docs/specs/route-visibility.md §4.3). Nothing to diagnose without it.
  if (p === undefined) return null;
  return (
    <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
      <Fact label="Window">
        {p.intent === null ? (
          "none open"
        ) : (
          <>
            {intentCopy(p.intent)}
            {" · next attempt "}
            <Time at={p.nextAttemptAt} />
            {" · deadline "}
            <Time at={p.windowDeadlineAt} />
          </>
        )}
      </Fact>
      <Fact label="Attempts">
        {attemptCountCopy(p.attemptCount)}
        {p.latestAttempt && ` · ${latestAttemptCopy(e)}`}
      </Fact>
      <Fact label="Chunks">{p.chunkCount ?? "none"}</Fact>
      <Fact label="Summary">
        {e.summary === null ? (
          "none"
        ) : (
          <>
            {e.summary.format}
            {" · available since "}
            <Time at={e.summaryAvailableAt} />
          </>
        )}
      </Fact>
      <Fact label="Episode id">{e.episodeId}</Fact>
    </dl>
  );
}

/** One labelled fact, in a two-column grid: the label in the 12 px label, the value in a cell. */
function Fact({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <>
      <dt class="py-0.5 text-label uppercase text-ink-3">{label}</dt>
      <dd class="py-0.5 text-ink-2">{children}</dd>
    </>
  );
}

/**
 * Retry on every row; **Skip on failed rows only** (docs/PRD.md §7), which is why a pending episode
 * offers Retry alone.
 *
 * **A running attempt is said in the status column, not here** (2026-09-17). Retry is simply
 * unavailable while one holds the episode, and "Re-processing · running for 2 min" beside it is a
 * better explanation than any sentence this cell could carry. The one thing left on the row is the
 * takeover, and only once it is real: an attempt past the hour is one the engine has probably lost,
 * and then Retry is an action again rather than a wait (docs/PRD.md §4.2 rule 17).
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
  const running = isRunning(e.processing?.latestAttempt ?? null);
  const takeover = attemptHoldCopy(e.processing?.latestAttempt ?? null);
  // Blue says "you can act on this" (docs/design.md §2.1), and on an episode that is already
  // summarised there is nothing to act on: Retry there replaces a working summary, costs a
  // transcript credit, and may return something no better. It stays on every row as §7 requires —
  // findable, and saying what it would do — but it stops asking to be pressed.
  const routine = e.status !== "available";
  return (
    <div class="flex flex-wrap items-center gap-1">
      <Action
        id={`detail-retry-${e.episodeId}`}
        busy={busy || (running && takeover === null)}
        tone={routine ? "safe" : "quiet"}
        title={routine ? undefined : RETRY_AVAILABLE_HINT}
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
      {takeover !== null && (
        <span class="block w-full text-meta text-owner">{takeover}</span>
      )}
    </div>
  );
}

/**
 * The content status with what explains it: the wait, the skip reason, the timeout's last reason —
 * or, on an otherwise healthy episode, that its summary is raw text. `raw_fallback` is the one
 * summary fact worth a column's worth of attention, because it is what a reader is looking at.
 */
function statusCopy(e: Episode): string {
  // What is happening now outranks what the episode last came to rest as: an episode being
  // re-processed is not "Summarised", whatever its stored status still says.
  const latest = e.processing?.latestAttempt ?? null;
  if (latest?.status === "running") {
    return `${inProgressCopy(e.status)} · ${runningForCopy(latest.startedAt)}`;
  }
  const base = EPISODE_STATUS_COPY[e.status];
  if (e.status === "pending" && e.waitReason)
    return `${base} · ${WAIT_REASON_COPY[e.waitReason]}`;
  if (e.status === "skipped" && e.skipReason)
    return `${base} · ${SKIP_REASON_COPY[e.skipReason]}`;
  const p = e.processing;
  if (e.status === "failed" && p?.failureCode) {
    return p.failureDetail
      ? `${base} · ${p.failureCode} · ${failureDetailCopy(p.failureDetail)}`
      : `${base} · ${p.failureCode}`;
  }
  if (e.summary?.format === "raw_fallback") {
    return `${base} · ${RAW_SUMMARY_COPY}`;
  }
  return base;
}

/** The latest attempt's phrase: how long it has run, its outcome, or its status when it has no code. */
function latestAttemptCopy(e: Episode): string {
  const latest = e.processing?.latestAttempt;
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
