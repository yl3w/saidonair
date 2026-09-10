import {
  type Channel,
  ChannelParamsSchema,
  type ChannelResponse,
  ChannelResponseSchema,
  type ChannelsResponse,
  ChannelsResponseSchema,
  CreateChannelBodySchema,
  type EpisodesResponse,
  EpisodesResponseSchema,
  type FollowersResponse,
  FollowersResponseSchema,
  type IngestionRunsResponse,
  IngestionRunsResponseSchema,
  LimitQuerySchema,
  ScopeQuerySchema,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { CatalogChannel } from "../do/registry/types";
import type { AppEnv } from "../env";
import { isApproved, toChannel } from "../lib/channel-view";
import { eligibleChannels } from "../lib/eligibility";
import { toEpisode } from "../lib/episode-view";
import { DomainError } from "../lib/errors";
import { requestIngestion } from "../lib/ingestion";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";
import { extractChannelId } from "../lib/youtube/ids";
import { feedFetcher, fetchChannelFeed } from "../lib/youtube/rss";
import { assertOwner, isOwner, requireOwner } from "../middleware/owner";

type Ctx = Context<AppEnv>;

/**
 * Channels are the catalog's members. Everyone reads the requested and approved ones; the owner
 * reads every status (`?scope=all`, `management`) and performs the state changes. Sub-resources:
 * episodes for everyone with follower-dependent detail, ingestion runs for the owner.
 */
export const channelRoutes = new Hono<AppEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["channels"],
      summary: "List channels",
      description:
        "Requested and approved channels with `following` and `processedCount`. With `?scope=all` (owner) every status including declined, each with `management`.",
      responses: {
        200: jsonResponse(
          ChannelsResponseSchema,
          "Channels the caller may act on.",
        ),
        ...errorResponses({ owner: true }),
      },
    }),
    validate("query", ScopeQuerySchema),
    async (c) => {
      const { scope } = c.req.valid("query");
      const following = new Set(await c.var.user.activeChannelIds());

      if (scope === "all") {
        const email = assertOwner(c);
        const rows = await c.var.registry.listChannelManagement(email);
        const followers = await c.var.registry.countFollowers(
          rows.map((row) => row.channel.channelId),
        );
        return c.json<ChannelsResponse>({
          channels: rows.map((row) =>
            toChannel(row.channel, {
              following: following.has(row.channel.channelId),
              processedCount: row.episodes.processed,
              followerCount: followers[row.channel.channelId] ?? 0,
              management: row,
            }),
          ),
        });
      }

      const listed = await c.var.registry.listCatalogChannels();
      const ids = listed.map((channel) => channel.channelId);
      const counts = await c.var.registry.countEpisodesByChannel(ids);
      const followers = await c.var.registry.countFollowers(ids);
      return c.json<ChannelsResponse>({
        channels: listed.map((channel) =>
          toChannel(channel, {
            following: following.has(channel.channelId),
            processedCount: counts[channel.channelId]?.processed ?? 0,
            followerCount: followers[channel.channelId] ?? 0,
          }),
        ),
      });
    },
  )

  .post(
    "/",
    describeRoute({
      tags: ["channels"],
      summary: "Add a channel",
      description:
        "The owner's add is approved at once and starts its initial import; anyone else's is a request awaiting review. The id is verified against its RSS feed; the feed title is used unless one is given.",
      responses: {
        201: jsonResponse(
          ChannelResponseSchema,
          "The new channel; the owner also receives `management`.",
        ),
        ...errorResponses({
          conflict: "The id is already in the catalog",
        }),
      },
    }),
    validate("json", CreateChannelBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      const channelId = extractChannelId(body.channelId);

      // Fast path only: skips the YouTube round trip for a known id. The Registry's
      // createChannel is the authoritative check; a channel added while the feed is in
      // flight still ends in the same 409, never in an overwrite.
      if (await c.var.registry.getChannel(channelId)) {
        throw new DomainError(
          "INVALID_STATE",
          "channel is already in the catalog",
        );
      }
      const feed = await fetchChannelFeed(channelId, feedFetcher(c.env));
      if (!feed) {
        throw new DomainError(
          "INVALID_INPUT",
          "no YouTube channel has that id",
        );
      }

      const owner = isOwner(c);
      const channel = await c.var.registry.createChannel(c.var.identity.email, {
        channelId,
        title: body.title ?? feed.title,
        initialImportCount: body.initialImportCount,
        status: owner ? "approved" : "requested",
      });
      if (channel.status === "approved") {
        requestIngestion(channel.channelId, "channel_approved");
      }
      return c.json<ChannelResponse>(
        {
          channel: owner
            ? await ownerChannel(c, channel.channelId)
            : toChannel(channel, {
                following: false,
                processedCount: 0,
                followerCount: 0,
              }),
        },
        201,
      );
    },
  )

  .get(
    "/:id",
    describeRoute({
      tags: ["channels"],
      summary: "Get a channel",
      description:
        "Any caller sees a channel in any status; the owner also receives `management`.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The channel."),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await requireChannel(c, c.req.valid("param").id);
      if (isOwner(c)) {
        return c.json<ChannelResponse>({
          channel: await ownerChannel(c, channel.channelId),
        });
      }
      const counts = await c.var.registry.countEpisodesByChannel([
        channel.channelId,
      ]);
      const followers = await c.var.registry.countFollowers([
        channel.channelId,
      ]);
      return c.json<ChannelResponse>({
        channel: toChannel(channel, {
          following: await isFollowing(c, channel.channelId),
          processedCount: counts[channel.channelId]?.processed ?? 0,
          followerCount: followers[channel.channelId] ?? 0,
        }),
      });
    },
  )

  .get(
    "/:id/episodes",
    describeRoute({
      tags: ["episodes"],
      summary: "List a channel's episodes",
      description:
        "Newest first. The owner, and a follower of an approved channel, receive `summary`, `related`, and `wasUnread`, and the returned summaries are marked read for the caller. Other callers receive the episodes without summaries. The owner also receives `processing`.",
      responses: {
        200: jsonResponse(EpisodesResponseSchema, "Episodes, newest first."),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    validate("query", LimitQuerySchema),
    async (c) => {
      const channel = await requireChannel(c, c.req.valid("param").id);
      const { limit } = c.req.valid("query");
      const owner = isOwner(c);
      const includeSummary =
        owner ||
        ((await isFollowing(c, channel.channelId)) && isApproved(channel));
      // Related titles are filtered to the caller's eligible channels, whoever the caller is.
      const relatedScope = includeSummary
        ? (await eligibleChannels(c.var.registry, c.var.user)).map(
            (eligible) => eligible.channelId,
          )
        : [];

      const records = await c.var.registry.listEpisodes(channel.channelId, {
        limit,
        relatedScope,
      });

      // A summary counts as read once it has actually been returned to this caller.
      let alreadyRead = new Set<string>();
      if (includeSummary) {
        const returned = records
          .filter((record) => record.summary !== null)
          .map((record) => record.videoId);
        if (returned.length > 0) {
          alreadyRead = new Set(await c.var.user.readVideoIds(returned));
          await c.var.user.markRead(returned);
        }
      }

      return c.json<EpisodesResponse>({
        episodes: records.map((record) =>
          toEpisode(record, {
            includeSummary,
            includeProcessing: owner,
            wasUnread:
              includeSummary && record.summary !== null
                ? !alreadyRead.has(record.videoId)
                : undefined,
          }),
        ),
      });
    },
  )

  .get(
    "/:id/ingestion-runs",
    describeRoute({
      tags: ["ingestion-runs"],
      summary: "List a channel's ingestion runs (owner)",
      description: "Runs newest first, each with its per-episode outcomes.",
      responses: {
        200: jsonResponse(IngestionRunsResponseSchema, "Runs, newest first."),
        ...errorResponses({ owner: true, notFound: true }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const runs = await c.var.registry.listRuns(
        c.var.identity.email,
        c.req.valid("param").id,
      );
      return c.json<IngestionRunsResponse>({ runs });
    },
  )

  .get(
    "/:id/followers",
    describeRoute({
      tags: ["channels"],
      summary: "List a channel's active followers (owner)",
      description:
        "Emails and follow times, oldest first. The web shows emails only in the queue.",
      responses: {
        200: jsonResponse(FollowersResponseSchema, "Active followers."),
        ...errorResponses({ owner: true, notFound: true }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) =>
      c.json<FollowersResponse>({
        followers: await c.var.registry.listFollowers(
          c.var.identity.email,
          c.req.valid("param").id,
        ),
      }),
  );

/** Every caller sees a channel in any status; only an unknown id is 404. */
async function requireChannel(
  c: Ctx,
  channelId: string,
): Promise<CatalogChannel> {
  const channel = await c.var.registry.getChannel(channelId);
  if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
  return channel;
}

async function isFollowing(c: Ctx, channelId: string): Promise<boolean> {
  return (await c.var.user.activeChannelIds()).includes(channelId);
}

/** The owner's view of one channel: the shared fields plus the `management` block. */
export async function ownerChannel(
  c: Ctx,
  channelId: string,
): Promise<Channel> {
  const [row] = await c.var.registry.listChannelManagement(
    c.var.identity.email,
    [channelId],
  );
  if (!row) throw new DomainError("NOT_FOUND", "channel not found");
  const followers = await c.var.registry.countFollowers([channelId]);
  return toChannel(row.channel, {
    following: await isFollowing(c, channelId),
    processedCount: row.episodes.processed,
    followerCount: followers[channelId] ?? 0,
    management: row,
  });
}
