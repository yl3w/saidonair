import {
  type Follow,
  FollowParamsSchema,
  type FollowResponse,
  type FollowsResponse,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import type { CatalogChannel } from "../do/registry/types";
import type { ChannelFollow } from "../do/user/types";
import type { AppEnv } from "../env";
import { isAvailable, toChannel } from "../lib/channel-view";
import { DomainError } from "../lib/errors";
import { validate } from "../lib/validation";

type Ctx = Context<AppEnv>;

/**
 * The caller's follows. Each embeds its channel, so a follow whose channel the owner has deleted
 * still lists, marked unavailable, and comes back when the channel is restored (AGENTS.md).
 * Unread = processed episodes the caller has no read receipt for.
 */
export const followRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const follows = await c.var.user.listFollows();
    if (follows.length === 0) return c.json<FollowsResponse>({ follows: [] });

    const ids = follows.map((follow) => follow.channelId);
    const channels = new Map(
      (await c.var.registry.listChannelsByIds(ids)).map((channel) => [
        channel.channelId,
        channel,
      ]),
    );
    const counts = await c.var.registry.countEpisodesByChannel(ids);
    const unread = await unreadByChannel(c, ids);

    const rows: Follow[] = [];
    for (const follow of follows) {
      const channel = channels.get(follow.channelId);
      if (!channel) continue; // a follow of an id the Registry never had; nothing to show
      rows.push(
        toFollow(follow, channel, {
          processedCount: counts[follow.channelId]?.processed ?? 0,
          unreadCount: unread[follow.channelId] ?? 0,
        }),
      );
    }
    rows.sort(
      (a, b) =>
        (b.channel.lastIngestedAt ?? -1) - (a.channel.lastIngestedAt ?? -1) ||
        a.channel.title.localeCompare(b.channel.title),
    );
    return c.json<FollowsResponse>({ follows: rows });
  })

  .put("/:channelId", validate("param", FollowParamsSchema), async (c) => {
    const { channelId } = c.req.valid("param");
    const channel = await c.var.registry.getChannel(channelId);
    if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
    if (!isAvailable(channel)) {
      throw new DomainError(
        "INVALID_STATE",
        "only available channels can be followed",
      );
    }
    const follow = await c.var.user.follow(channelId);
    return c.json<FollowResponse>({
      follow: await followView(c, follow, channel),
    });
  })

  .delete("/:channelId", validate("param", FollowParamsSchema), async (c) => {
    const { channelId } = c.req.valid("param");
    const follow = await c.var.user.unfollow(channelId);
    const channel = await c.var.registry.getChannel(channelId);
    if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
    return c.json<FollowResponse>({
      follow: await followView(c, follow, channel),
    });
  });

async function followView(
  c: Ctx,
  follow: ChannelFollow,
  channel: CatalogChannel,
): Promise<Follow> {
  const counts = await c.var.registry.countEpisodesByChannel([
    channel.channelId,
  ]);
  const unread = await unreadByChannel(c, [channel.channelId]);
  return toFollow(follow, channel, {
    processedCount: counts[channel.channelId]?.processed ?? 0,
    unreadCount: unread[channel.channelId] ?? 0,
  });
}

/** Processed episodes minus the caller's read receipts, per channel. Absent means zero. */
async function unreadByChannel(
  c: Ctx,
  channelIds: string[],
): Promise<Record<string, number>> {
  const processed = await c.var.registry.listProcessedVideoIds(channelIds);
  if (processed.length === 0) return {};
  const read = new Set(
    await c.var.user.readVideoIds(processed.map((p) => p.videoId)),
  );
  const unread: Record<string, number> = {};
  for (const { channelId, videoId } of processed) {
    if (!read.has(videoId)) unread[channelId] = (unread[channelId] ?? 0) + 1;
  }
  return unread;
}

function toFollow(
  follow: ChannelFollow,
  channel: CatalogChannel,
  view: { processedCount: number; unreadCount: number },
): Follow {
  return {
    channelId: follow.channelId,
    followedAt: follow.followedAt,
    unfollowedAt: follow.unfollowedAt,
    origin: follow.origin,
    channel: toChannel(channel, {
      following: follow.unfollowedAt === null,
      processedCount: view.processedCount,
    }),
    unreadCount: view.unreadCount,
  };
}
