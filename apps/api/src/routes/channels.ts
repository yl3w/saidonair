import {
  type Channel,
  ChannelParamsSchema,
  type ChannelRequestsResponse,
  type ChannelResponse,
  type ChannelsResponse,
  CreateChannelBodySchema,
  type EpisodesResponse,
  type IngestionRunsResponse,
  LimitQuerySchema,
  ScopeQuerySchema,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import type { CatalogChannel } from "../do/registry/types";
import type { AppEnv } from "../env";
import { isAvailable, toChannel } from "../lib/channel-view";
import { eligibleChannels } from "../lib/eligibility";
import { toEpisode } from "../lib/episode-view";
import { DomainError } from "../lib/errors";
import { requestIngestion } from "../lib/ingestion";
import { toChannelRequest } from "../lib/outcome";
import { validate } from "../lib/validation";
import { extractChannelId } from "../lib/youtube/ids";
import { feedFetcher, fetchChannelFeed } from "../lib/youtube/rss";
import { assertOwner, isOwner, requireOwner } from "../middleware/owner";

type Ctx = Context<AppEnv>;

/**
 * Channels are the catalog's members. Everyone reads the available ones; the owner reads every
 * state (`?scope=all`, `management`) and performs the state changes. Sub-resources: episodes for
 * everyone with follower-dependent detail, ingestion runs and requests for the owner.
 */
export const channelRoutes = new Hono<AppEnv>()
  .get("/", validate("query", ScopeQuerySchema), async (c) => {
    const { scope } = c.req.valid("query");
    const following = new Set(await c.var.user.activeChannelIds());

    if (scope === "all") {
      const email = assertOwner(c);
      const rows = await c.var.registry.listChannelManagement(email);
      return c.json<ChannelsResponse>({
        channels: rows.map((row) =>
          toChannel(row.channel, {
            following: following.has(row.channel.channelId),
            processedCount: row.episodes.processed,
            management: row,
          }),
        ),
      });
    }

    const available = await c.var.registry.listAvailableChannels();
    const counts = await c.var.registry.countEpisodesByChannel(
      available.map((channel) => channel.channelId),
    );
    return c.json<ChannelsResponse>({
      channels: available.map((channel) =>
        toChannel(channel, {
          following: following.has(channel.channelId),
          processedCount: counts[channel.channelId]?.processed ?? 0,
        }),
      ),
    });
  })

  .post(
    "/",
    requireOwner,
    validate("json", CreateChannelBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      const channelId = extractChannelId(body.channelId);

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

      const { channel, created } = await c.var.registry.configureChannel(
        c.var.identity.email,
        {
          channelId,
          title: body.title ?? feed.title,
          initialImportCount: body.initialImportCount,
        },
      );
      if (created) requestIngestion(channel.channelId, "channel_created");
      return c.json<ChannelResponse>(
        { channel: await ownerChannel(c, channel.channelId) },
        201,
      );
    },
  )

  .get("/:id", validate("param", ChannelParamsSchema), async (c) => {
    const channel = await visibleChannel(c, c.req.valid("param").id);
    if (isOwner(c)) {
      return c.json<ChannelResponse>({
        channel: await ownerChannel(c, channel.channelId),
      });
    }
    const counts = await c.var.registry.countEpisodesByChannel([
      channel.channelId,
    ]);
    return c.json<ChannelResponse>({
      channel: toChannel(channel, {
        following: await isFollowing(c, channel.channelId),
        processedCount: counts[channel.channelId]?.processed ?? 0,
      }),
    });
  })

  .delete(
    "/:id",
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.deleteChannel(
        c.var.identity.email,
        c.req.valid("param").id,
      );
      return c.json<ChannelResponse>({
        channel: await ownerChannel(c, channel.channelId),
      });
    },
  )

  .post(
    "/:id/restore",
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.restoreChannel(
        c.var.identity.email,
        c.req.valid("param").id,
      );
      return c.json<ChannelResponse>({
        channel: await ownerChannel(c, channel.channelId),
      });
    },
  )

  .post(
    "/:id/retry",
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.retryChannel(
        c.var.identity.email,
        c.req.valid("param").id,
      );
      requestIngestion(channel.channelId, "owner_retry");
      return c.json<ChannelResponse>({
        channel: await ownerChannel(c, channel.channelId),
      });
    },
  )

  .get(
    "/:id/episodes",
    validate("param", ChannelParamsSchema),
    validate("query", LimitQuerySchema),
    async (c) => {
      const channel = await visibleChannel(c, c.req.valid("param").id);
      const { limit } = c.req.valid("query");
      const owner = isOwner(c);
      const includeSummary = owner || (await isFollowing(c, channel.channelId));
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
    "/:id/requests",
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      // Requests may exist for an id that is not (yet) in the catalog, so no 404 here.
      const channelId = c.req.valid("param").id;
      const [requests, channel] = await Promise.all([
        c.var.registry.listRequestsForChannel(c.var.identity.email, channelId),
        c.var.registry.getChannel(channelId),
      ]);
      return c.json<ChannelRequestsResponse>({
        requests: requests.map((request) => toChannelRequest(request, channel)),
      });
    },
  );

/** Readers see a channel only while it is available and not deleted; the owner sees any state. */
async function visibleChannel(
  c: Ctx,
  channelId: string,
): Promise<CatalogChannel> {
  const channel = await c.var.registry.getChannel(channelId);
  if (!channel || (!isOwner(c) && !isAvailable(channel))) {
    throw new DomainError("NOT_FOUND", "channel not found");
  }
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
  return toChannel(row.channel, {
    following: await isFollowing(c, channelId),
    processedCount: row.episodes.processed,
    management: row,
  });
}
