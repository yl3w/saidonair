import type {
  AttemptTrigger,
  EpisodeIngestionAttempt,
  TranscriptProviderHealth,
} from "@media-digest/shared";
import { getRegistry } from "../do/registry";
import type {
  BlockReason,
  DiscoveryResult,
  EpisodeRecord,
} from "../do/registry/types";
import type { Env } from "../env";
import { domainErrorCode } from "./errors";
import { transcriptProviderHealth } from "./transcripts/status";
import { type IngestParams, ingestLauncher } from "./workflows";
import { type ChannelFeed, feedFetcher, fetchChannelFeed } from "./youtube/rss";

/**
 * The start points of ingestion (docs/PRD.md §4.2; docs/specs/m3-4-discovery.md §3;
 * docs/specs/m3-5-episode-workflow.md §3.2; docs/specs/m3-6-recovery.md §3). Discovery is one RSS
 * read of one approved channel recorded as a completed run, from first approval, the owner's Start,
 * or the discovery cron; it never touches the transcript provider. The episodes a run creates, the
 * recovery tick's due episodes, and an owner's Retry all go through `startEpisodeAttempts`: one
 * provider pre-flight per batch, one ledger row per episode, one Workflow instance per launched
 * attempt, three seconds apart. The recovery tick reconciles stale running attempts against the
 * engine first, then starts every due episode regardless of its channel's status or pause.
 */

/** Discovery, every six hours on the hour, UTC; `env.production` only (AGENTS.md → Environments). */
export const DISCOVERY_CRON = "0 */6 * * *";

/** Recovery, every six hours at half past, UTC; `env.production` only. */
export const RECOVERY_CRON = "30 */6 * * *";

export type DiscoveryOptions = {
  /** Bypass the fetch: the parsed feed, or null for an unreadable one. Tests use it; nothing else. */
  feed?: ChannelFeed | null;
};

/**
 * One feed check of one channel: fetch (a 404 or an unreachable YouTube is an unavailable feed, not
 * an error), record the run and the new episodes, then start their attempts. The Registry enforces
 * that the channel is approved; pause is the cron's concern, not this function's (rule 4).
 */
export async function startDiscovery(
  env: Env,
  channelId: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const feed =
    options.feed !== undefined ? options.feed : await readFeed(env, channelId);
  const result = await getRegistry(env).recordDiscovery(channelId, feed);
  console.log({
    event: "discovery.recorded",
    channelId,
    runId: result.run.runId,
    kind: result.run.kind,
    feedStatus: result.run.feedStatus,
    discoveredCount: result.run.discoveredCount,
  });
  await startEpisodeAttempts(env, result.created, "channel_ingestion");
  return result;
}

/** Running attempts older than this are checked against the engine before Retry or recovery proceeds (rules 15, 17). */
export const RECONCILE_AFTER_MS = 60 * 60 * 1000;

/** The k-th attempt launched in one batch sleeps this long first (docs/PRD.md §4.2 rule 8), k from 0. */
export function startDelaySec(k: number): number {
  return k * 3;
}

/** What the provider's health means for a start: a rejected key or no credits blocks it, anything else does not (rule 9). */
export function preflight(
  health: TranscriptProviderHealth,
): BlockReason | null {
  if (health.status === "auth_failed") return "PROVIDER_AUTH";
  if (health.status === "ok" && health.remainingCredits === 0)
    return "PROVIDER_LIMIT";
  return null;
}

export type AttemptStartResult = {
  videoId: string;
  /** `started` launched an instance; `blocked` recorded a blocked row; `running` found one in flight; `lost` could not launch. */
  kind: "started" | "blocked" | "running" | "lost";
  attempt: EpisodeIngestionAttempt;
};

export type StartOptions = {
  /** The owner behind an `owner_retry`; the automatic triggers pass nothing. */
  requestedByEmail?: string;
};

/**
 * The common attempt starter. One pre-flight for the whole batch; then per episode: a blocked row
 * when the provider refuses work, otherwise a running row and a Workflow instance whose first step
 * sleeps k × 3 seconds, k counting launches. A `create` that throws finishes the attempt
 * `WORKFLOW_LOST` and the batch continues; so does any other failure on one episode.
 */
export async function startEpisodeAttempts(
  env: Env,
  episodes: readonly EpisodeRecord[],
  trigger: AttemptTrigger,
  options: StartOptions = {},
): Promise<AttemptStartResult[]> {
  if (episodes.length === 0) return [];
  const registry = getRegistry(env);
  const launcher = ingestLauncher(env);
  const block = preflight(await transcriptProviderHealth(env));
  const results: AttemptStartResult[] = [];
  let launched = 0;
  for (const episode of episodes) {
    const { videoId, channelId } = episode;
    try {
      if (block) {
        const { attempt } = await registry.recordBlockedAttempt(
          videoId,
          trigger,
          block,
          options.requestedByEmail,
        );
        console.log({
          event: "ingestion.attempt_blocked",
          channelId,
          videoId,
          trigger,
          reason: block,
        });
        results.push({ videoId, kind: "blocked", attempt });
        continue;
      }
      const start = await registry.beginAttempt(
        videoId,
        trigger,
        options.requestedByEmail,
      );
      if (start.kind === "running") {
        console.log({
          event: "ingestion.attempt_running",
          channelId,
          videoId,
          attemptId: start.attempt.attemptId,
        });
        results.push({ videoId, kind: "running", attempt: start.attempt });
        continue;
      }
      const params: IngestParams = {
        attemptId: start.attempt.attemptId,
        videoId,
        channelId,
        startDelaySec: startDelaySec(launched),
      };
      try {
        await launcher.create(params);
      } catch (error) {
        const lost = await registry.finishAttempt(params.attemptId, {
          status: "failed",
          code: "WORKFLOW_LOST",
          detail: `create failed: ${messageOf(error)}`,
        });
        console.log({
          event: "ingestion.attempt_lost",
          channelId,
          videoId,
          attemptId: params.attemptId,
        });
        results.push({ videoId, kind: "lost", attempt: lost.attempt });
        continue;
      }
      launched += 1;
      console.log({
        event: "ingestion.attempt_started",
        channelId,
        videoId,
        trigger,
        attemptId: params.attemptId,
        startDelaySec: params.startDelaySec,
      });
      results.push({ videoId, kind: "started", attempt: start.attempt });
    } catch (error) {
      console.log({
        event: "ingestion.start_failed",
        channelId,
        videoId,
        trigger,
        error: messageOf(error),
      });
    }
  }
  return results;
}

/**
 * A running attempt whose instance is gone or missing finishes `WORKFLOW_LOST` and its episode stays
 * in its window (rule 15). Retry calls this inline on an attempt older than an hour; the recovery
 * tick's reconciliation calls it for every such attempt.
 */
export async function closeLostEpisodeAttempt(
  env: Env,
  attemptId: string,
): Promise<void> {
  await getRegistry(env).finishAttempt(attemptId, {
    status: "failed",
    code: "WORKFLOW_LOST",
    detail: "the Workflow instance is gone or missing after an hour",
  });
  console.log({ event: "ingestion.attempt_lost", attemptId });
}

export type DiscoveryTickResult = {
  channels: number;
  read: number;
  unavailable: number;
  failed: number;
};

/**
 * The discovery cron: every approved, unpaused channel, one at a time so the log reads in order and
 * YouTube sees no burst. A channel that throws is logged and does not stop the next.
 */
export async function runDiscoveryTick(env: Env): Promise<DiscoveryTickResult> {
  const channels = await getRegistry(env).listDiscoveryChannels();
  const result: DiscoveryTickResult = {
    channels: channels.length,
    read: 0,
    unavailable: 0,
    failed: 0,
  };
  for (const channel of channels) {
    try {
      const { run } = await startDiscovery(env, channel.channelId);
      if (run.feedStatus === "read") result.read += 1;
      else result.unavailable += 1;
    } catch (error) {
      result.failed += 1;
      console.log({
        event: "discovery.channel_failed",
        channelId: channel.channelId,
        error: messageOf(error),
      });
    }
  }
  console.log({ event: "discovery.tick", ...result });
  return result;
}

export type ReconcileResult = {
  /** Running attempts older than an hour that were asked about. */
  checked: number;
  /** Those whose instance was gone or missing, now finished `WORKFLOW_LOST`. */
  lost: number;
};

/**
 * Reconciliation (rule 15): every running attempt older than an hour is asked about at the engine;
 * a gone or missing instance finishes `WORKFLOW_LOST`, so its episode is due again inside its
 * window, six hours on or at the deadline. One attempt that cannot be checked or closed is logged
 * and does not stop the next.
 */
export async function reconcileRunningAttempts(
  env: Env,
  now: number = Date.now(),
): Promise<ReconcileResult> {
  const stale = await getRegistry(env).listRunningAttempts(
    now - RECONCILE_AFTER_MS,
  );
  const launcher = ingestLauncher(env);
  let lost = 0;
  for (const attempt of stale) {
    try {
      const status = await launcher.status(attempt.attemptId);
      if (status === "active") continue;
      await closeLostEpisodeAttempt(env, attempt.attemptId);
      lost += 1;
    } catch (error) {
      console.log({
        event: "recovery.reconcile_failed",
        attemptId: attempt.attemptId,
        videoId: attempt.videoId,
        error: messageOf(error),
      });
    }
  }
  return { checked: stale.length, lost };
}

export type RecoveryTickResult = {
  /** Attempts finished `WORKFLOW_LOST` by reconciliation. */
  reconciled: number;
  /** Episodes whose next attempt was due, in every channel status and pause state. */
  due: number;
  started: number;
  blocked: number;
};

/**
 * The recovery cron (rules 13–15): reconcile first, then one attempt for every due episode,
 * numbered across the whole tick so the k-th launched instance sleeps k × 3 seconds, with one
 * provider pre-flight for the tick. No channel column is read. An episode at or after its deadline
 * is due like any other; the ledger settles its result as the final one (M3.2).
 */
export async function runRecoveryTick(
  env: Env,
  now: number = Date.now(),
): Promise<RecoveryTickResult> {
  const reconciliation = await reconcileRunningAttempts(env, now);
  const due = await getRegistry(env).listDueEpisodes(now);
  // TODO(owner): a cap on due episodes per tick would slice `due` here; today the stagger is the only throttle.
  const results = await startEpisodeAttempts(env, due, "scheduled_recovery");
  const count = (kind: AttemptStartResult["kind"]) =>
    results.filter((result) => result.kind === kind).length;
  const result: RecoveryTickResult = {
    reconciled: reconciliation.lost,
    due: due.length,
    started: count("started"),
    blocked: count("blocked"),
  };
  console.log({
    event: "recovery.tick",
    ...result,
    checked: reconciliation.checked,
    launchFailed: count("lost"),
  });
  return result;
}

/** The `scheduled` handler's dispatch, by cron expression (AGENTS.md → Stack). */
export async function runScheduled(cron: string, env: Env): Promise<void> {
  if (cron === DISCOVERY_CRON) {
    await runDiscoveryTick(env);
    return;
  }
  if (cron === RECOVERY_CRON) {
    await runRecoveryTick(env);
    return;
  }
  console.log({ event: "scheduled.unknown_cron", cron });
}

async function readFeed(
  env: Env,
  channelId: string,
): Promise<ChannelFeed | null> {
  try {
    return await fetchChannelFeed(channelId, feedFetcher(env));
  } catch (error) {
    if (domainErrorCode(error) !== "UPSTREAM_UNAVAILABLE") throw error;
    console.log({
      event: "discovery.feed_unavailable",
      channelId,
      error: messageOf(error),
    });
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
