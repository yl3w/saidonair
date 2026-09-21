import type { Context } from "hono";
import type { AppEnv } from "../env";

/**
 * The caller's eligible channels: their active follows intersected with `approved`, paused or not
 * (docs/PRD.md §4.3). One definition, because it decides what a digest returns, which episodes
 * carry a read receipt, and which channels chat may retrieve from — a second copy would drift, and
 * drift here means answering from a channel the caller does not follow.
 */
export async function eligibleChannelIds(
  c: Context<AppEnv>,
): Promise<Set<string>> {
  return new Set(
    (await c.var.registry.listEligibleChannels(c.var.identity.userId)).map(
      (channel) => channel.channelId,
    ),
  );
}
