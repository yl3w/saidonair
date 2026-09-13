import type { AttemptTrigger } from "@media-digest/shared";
import { getRegistry } from "../do/registry";
import type { DiscoveryResult, EpisodeRecord } from "../do/registry/types";
import type { Env } from "../env";
import { domainErrorCode } from "./errors";
import { type ChannelFeed, feedFetcher, fetchChannelFeed } from "./youtube/rss";

/**
 * The start points of ingestion (docs/PRD.md §4.2; docs/specs/m3-4-discovery.md §3). Discovery is
 * one RSS read of one approved channel recorded as a completed run, from first approval, the
 * owner's Start, or the discovery cron; it never touches the transcript provider. The episodes a
 * run creates are handed to `startEpisodeAttempts`, which logs until M3.5 replaces its body with
 * the pre-flight, the ledger write, and the Workflow launch.
 */

/** Discovery, every six hours on the hour, UTC; `env.production` only (AGENTS.md → Environments). */
export const DISCOVERY_CRON = "0 */6 * * *";

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

/**
 * The common attempt starter for discovery's new episodes, the recovery tick, and Owner Retry.
 * Until M3.5 it records the request as a log line, so the call sites are in place and visible under
 * `wrangler dev`; M3.5 replaces the body with pre-flight, `beginAttempt`, and the launch.
 */
export async function startEpisodeAttempts(
  _env: Env,
  episodes: readonly EpisodeRecord[],
  trigger: AttemptTrigger,
): Promise<void> {
  for (const episode of episodes) {
    console.log({
      event: "ingestion.attempt_start_requested",
      channelId: episode.channelId,
      videoId: episode.videoId,
      trigger,
    });
  }
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

/** The `scheduled` handler's dispatch, by cron expression (AGENTS.md → Stack). */
export async function runScheduled(cron: string, env: Env): Promise<void> {
  if (cron === DISCOVERY_CRON) {
    await runDiscoveryTick(env);
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
