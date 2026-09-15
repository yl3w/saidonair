import {
  type ChannelDeclinedResponse,
  ChannelDeclinedResponseSchema,
  type Follow,
  FollowParamsSchema,
  type FollowResponse,
  FollowResponseSchema,
  type FollowsResponse,
  FollowsResponseSchema,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type {
  ChannelManagementRecord,
  FollowRecord,
} from "../do/registry/types";
import type { AppEnv } from "../env";
import { isApproved, toChannel } from "../lib/channel-view";
import { DomainError } from "../lib/errors";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

type Ctx = Context<AppEnv>;

/**
 * The caller's follows, read from the Registry's follower record, the one record of follows
 * (docs/PRD.md §4.3). Each embeds its channel, so a follow whose channel the owner has declined still
 * lists, with its status, and reads again once the channel is approved. Unread = available episodes
 * the caller has no read receipt for; receipts stay in the User DO.
 */
export const followRoutes = new Hono<AppEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["follows"],
      summary: "List the caller's follows",
      description:
        "Active follows, each embedding its channel and carrying `unreadCount`; most recent ingestion first. A followed channel the owner has declined stays listed, with its status, and reads again once it is approved.",
      responses: {
        200: jsonResponse(
          FollowsResponseSchema,
          "The caller's active follows.",
        ),
        ...errorResponses(),
      },
    }),
    async (c) => {
      const follows = await c.var.registry.listFollows(c.var.identity.email);
      if (follows.length === 0) return c.json<FollowsResponse>({ follows: [] });

      const ids = follows.map((follow) => follow.channelId);
      const records = new Map(
        (await c.var.registry.listChannelManagement(ids)).map((record) => [
          record.channel.channelId,
          record,
        ]),
      );
      const followers = await c.var.registry.countFollowers(ids);
      // Unread counts only ever cover eligible channels, so a followed channel the owner has
      // declined reads zero unread until it is approved again (docs/PRD.md §4.3).
      const unread = await unreadByChannel(
        c,
        ids.filter((id) => {
          const record = records.get(id);
          return record !== undefined && isApproved(record.channel);
        }),
      );

      const rows: Follow[] = [];
      for (const follow of follows) {
        const record = records.get(follow.channelId);
        if (!record) continue; // a follow of an id the Registry never had; nothing to show
        rows.push(
          toFollow(follow, record, {
            followerCount: followers[follow.channelId] ?? 0,
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
    },
  )

  .put(
    "/:channelId",
    describeRoute({
      tags: ["follows"],
      summary: "Follow a channel",
      description:
        "Follow, or refollow, a requested or approved channel. Clears an earlier unfollow. Existing summaries start unread.",
      responses: {
        200: jsonResponse(
          FollowResponseSchema,
          "The follow, with its channel.",
        ),
        ...errorResponses({ notFound: true }),
        409: jsonResponse(
          ChannelDeclinedResponseSchema,
          "The channel is declined (`INVALID_STATE`).",
        ),
      },
    }),
    validate("param", FollowParamsSchema),
    async (c) => {
      const { channelId } = c.req.valid("param");
      const channel = await c.var.registry.getChannel(channelId);
      if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
      if (channel.status === "declined") {
        return c.json<ChannelDeclinedResponse>(
          {
            error: "channel was declined by the owner; request it again",
            code: "INVALID_STATE",
            channelId: channel.channelId,
            status: "declined",
            reviewNote: channel.reviewNote,
            reviewedAt: channel.reviewedAt,
          },
          409,
        );
      }
      const follow = await c.var.registry.recordFollow(
        c.var.identity.email,
        channelId,
      );
      return c.json<FollowResponse>({
        follow: await followView(c, follow),
      });
    },
  )

  .delete(
    "/:channelId",
    describeRoute({
      tags: ["follows"],
      summary: "Unfollow a channel",
      description:
        "Records an unfollow tombstone. The catalog channel and the caller's read receipts are untouched.",
      responses: {
        200: jsonResponse(
          FollowResponseSchema,
          "The follow, now with `unfollowedAt` set.",
        ),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", FollowParamsSchema),
    async (c) => {
      const { channelId } = c.req.valid("param");
      const follow = await c.var.registry.recordUnfollow(
        c.var.identity.email,
        channelId,
      );
      return c.json<FollowResponse>({
        follow: await followView(c, follow),
      });
    },
  );

/** One follow after a write, with the channel read back so pause and follower count are current. */
async function followView(c: Ctx, follow: FollowRecord): Promise<Follow> {
  const [record] = await c.var.registry.listChannelManagement([
    follow.channelId,
  ]);
  if (!record) throw new DomainError("NOT_FOUND", "channel not found");
  const followers = await c.var.registry.countFollowers([follow.channelId]);
  const unread = await unreadByChannel(
    c,
    isApproved(record.channel) ? [follow.channelId] : [],
  );
  return toFollow(follow, record, {
    followerCount: followers[follow.channelId] ?? 0,
    unreadCount: unread[follow.channelId] ?? 0,
  });
}

/**
 * Available episodes minus the caller's read receipts, per channel. Absent means zero. Callers pass
 * approved channel ids only: episodes of any other status are not readable (the Registry's
 * `listEligibleChannels` is the one implementation of that rule).
 */
async function unreadByChannel(
  c: Ctx,
  channelIds: string[],
): Promise<Record<string, number>> {
  if (channelIds.length === 0) return {};
  const processed = await c.var.registry.listAvailableEpisodeIds(channelIds);
  if (processed.length === 0) return {};
  const read = new Set(
    await c.var.user.readEpisodeIds(processed.map((p) => p.episodeId)),
  );
  const unread: Record<string, number> = {};
  for (const { channelId, episodeId } of processed) {
    if (!read.has(episodeId)) unread[channelId] = (unread[channelId] ?? 0) + 1;
  }
  return unread;
}

function toFollow(
  follow: FollowRecord,
  record: ChannelManagementRecord,
  view: { followerCount: number; unreadCount: number },
): Follow {
  return {
    channelId: follow.channelId,
    followedAt: follow.followedAt,
    unfollowedAt: follow.unfollowedAt,
    channel: toChannel(record, {
      following: follow.unfollowedAt === null,
      followerCount: view.followerCount,
    }),
    unreadCount: view.unreadCount,
  };
}
