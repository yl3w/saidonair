import {
  ApproveChannelBodySchema,
  type Channel,
  type ChannelDeclinedResponse,
  ChannelDeclinedResponseSchema,
  ChannelParamsSchema,
  type ChannelResponse,
  ChannelResponseSchema,
  type ChannelsResponse,
  ChannelsResponseSchema,
  CreateChannelBodySchema,
  DeclineChannelBodySchema,
  EpisodeParamsSchema,
  type EpisodeResponse,
  EpisodeResponseSchema,
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
import { toChannel } from "../lib/channel-view";
import { toEpisode } from "../lib/episode-view";
import { DomainError, domainErrorCode } from "../lib/errors";
import { requestIngestion } from "../lib/ingestion";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";
import { extractChannelId } from "../lib/youtube/ids";
import { feedFetcher, fetchChannelFeed } from "../lib/youtube/rss";

type Ctx = Context<AppEnv>;

/**
 * Channels are the catalog's members. Every caller receives the same representation, `management`
 * included, and every operation is accepted from any identity: the API enforces no authorization
 * (docs/PRD.md §2, §9); the web offers review, pause, retry, and skip to the owner role. Sub-resources:
 * episodes, discovery runs, followers.
 */
export const channelRoutes = new Hono<AppEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["channels"],
      summary: "List channels",
      description:
        "Requested and approved channels, each with `following`, `followerCount`, `episodes`, and `management`. With `?scope=all`, every status including declined.",
      responses: {
        200: jsonResponse(ChannelsResponseSchema, "The channels."),
        ...errorResponses(),
      },
    }),
    validate("query", ScopeQuerySchema),
    async (c) => {
      const { scope } = c.req.valid("query");
      const following = new Set(
        await c.var.registry.activeChannelIds(c.var.identity.email),
      );
      const rows =
        scope === "all"
          ? await c.var.registry.listChannelManagement()
          : await c.var.registry.listCatalogManagement();
      const followers = await c.var.registry.countFollowers(
        rows.map((row) => row.channel.channelId),
      );
      return c.json<ChannelsResponse>({
        channels: rows.map((row) =>
          toChannel(row, {
            following: following.has(row.channel.channelId),
            followerCount: followers[row.channel.channelId] ?? 0,
          }),
        ),
      });
    },
  )

  .post(
    "/",
    describeRoute({
      tags: ["channels"],
      summary: "Add or follow a channel",
      description:
        "A new id is verified against its RSS feed and added as `requested`, whoever asks; approval is always `POST /channels/{id}/approve`. An existing requested or approved id is simply followed. A declined id is refused with the review note; `POST /channels/{id}/request` reopens it. Either way the caller ends up following the channel. `title` and `initialImportCount` are honoured from any caller; the web offers them to the owner.",
      responses: {
        201: jsonResponse(
          ChannelResponseSchema,
          "The new channel, followed by the caller.",
        ),
        200: jsonResponse(
          ChannelResponseSchema,
          "The existing channel, now followed by the caller.",
        ),
        ...errorResponses({ upstream: true }),
        409: jsonResponse(
          ChannelDeclinedResponseSchema,
          "The channel was declined by the owner (`INVALID_STATE`); request it again.",
        ),
      },
    }),
    validate("json", CreateChannelBodySchema),
    async (c) => {
      const body = c.req.valid("json");
      const channelId = extractChannelId(body.channelId);

      // Fast path only: skips the YouTube round trip for a known id. The Registry's
      // createChannel is the authoritative check below, so a channel added while the feed
      // is in flight still ends in a follow, never in an overwrite.
      const existing = await c.var.registry.getChannel(channelId);
      if (existing?.status === "declined") return declinedResponse(c, existing);
      if (existing) return followAndView(c, channelId, false);

      const feed = await fetchChannelFeed(channelId, feedFetcher(c.env));
      if (!feed) {
        throw new DomainError(
          "INVALID_INPUT",
          "no YouTube channel has that id",
        );
      }

      try {
        await c.var.registry.createChannel({
          channelId,
          title: body.title ?? feed.title,
          initialImportCount: body.initialImportCount,
        });
      } catch (error) {
        if (domainErrorCode(error) !== "INVALID_STATE") throw error;
        // Created meanwhile by another caller; treat it the same as the fast path above.
        const raced = await c.var.registry.getChannel(channelId);
        if (!raced) throw error;
        if (raced.status === "declined") return declinedResponse(c, raced);
        return followAndView(c, channelId, false);
      }
      return followAndView(c, channelId, true);
    },
  )

  .post(
    "/:id/request",
    describeRoute({
      tags: ["channels"],
      summary: "Request a declined channel again",
      description:
        "`declined → requested`, keeping the review note. The caller is followed onto it.",
      responses: {
        200: jsonResponse(
          ChannelResponseSchema,
          "The requested channel, now followed by the caller.",
        ),
        ...errorResponses({
          notFound: true,
          conflict: "Only a declined channel can be requested again",
        }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      await c.var.registry.requestChannel(id);
      return followAndView(c, id, false);
    },
  )

  .post(
    "/:id/approve",
    describeRoute({
      tags: ["channels"],
      summary: "Approve a channel",
      description:
        "`requested` or `declined` → `approved`. Sets `approvedAt` the first time and starts the initial import only then; a re-approved channel waits for the next scheduled discovery. Recomputes the pause from the follower count. The caller is recorded as the reviewer; the web offers this to the owner.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The approved channel."),
        ...errorResponses({
          notFound: true,
          conflict: "The channel is already approved",
        }),
      },
    }),
    validate("param", ChannelParamsSchema),
    validate("json", ApproveChannelBodySchema),
    async (c) => {
      const { channel, importStarts } = await c.var.registry.approveChannel(
        c.var.identity.email,
        c.req.valid("param").id,
        c.req.valid("json"),
      );
      if (importStarts) requestIngestion(channel.channelId, "channel_approved");
      return c.json<ChannelResponse>({
        channel: await fullChannel(c, channel.channelId),
      });
    },
  )

  .post(
    "/:id/decline",
    describeRoute({
      tags: ["channels"],
      summary: "Decline a channel",
      description:
        "`requested` or `approved` → `declined`, with the pause cleared. Future discovery stops; recovery of episodes already discovered continues, and the web hides the channel's summaries from readers until it is approved again. The caller is recorded as the reviewer; the web offers this to the owner. `POST /channels/{id}/request` reopens it.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The declined channel."),
        ...errorResponses({
          notFound: true,
          conflict: "The channel is already declined",
        }),
      },
    }),
    validate("param", ChannelParamsSchema),
    validate("json", DeclineChannelBodySchema),
    async (c) => {
      const channel = await c.var.registry.declineChannel(
        c.var.identity.email,
        c.req.valid("param").id,
        c.req.valid("json"),
      );
      return c.json<ChannelResponse>({
        channel: await fullChannel(c, channel.channelId),
      });
    },
  )

  .post(
    "/:id/pause",
    describeRoute({
      tags: ["channels"],
      summary: "Pause a channel",
      description:
        "No new discovery while paused. Idempotent; only an approved channel can be paused. The web offers this to the owner.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The paused channel."),
        ...errorResponses({
          notFound: true,
          conflict: "Only approved channels can be paused or resumed",
        }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.pauseChannel(
        c.req.valid("param").id,
      );
      return c.json<ChannelResponse>({
        channel: await fullChannel(c, channel.channelId),
      });
    },
  )

  .post(
    "/:id/resume",
    describeRoute({
      tags: ["channels"],
      summary: "Resume a channel",
      description:
        "Clears an owner or system pause. Idempotent; only an approved channel can be resumed. The web offers this to the owner.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The resumed channel."),
        ...errorResponses({
          notFound: true,
          conflict: "Only approved channels can be paused or resumed",
        }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.resumeChannel(
        c.req.valid("param").id,
      );
      return c.json<ChannelResponse>({
        channel: await fullChannel(c, channel.channelId),
      });
    },
  )

  .get(
    "/:id",
    describeRoute({
      tags: ["channels"],
      summary: "Get a channel",
      description:
        "One channel in any status, so a declined one can show its note, with `management`.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The channel."),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await requireChannel(c, c.req.valid("param").id);
      return c.json<ChannelResponse>({
        channel: await fullChannel(c, channel.channelId),
      });
    },
  )

  .get(
    "/:id/episodes",
    describeRoute({
      tags: ["episodes"],
      summary: "List a channel's episodes",
      description:
        "Newest first, each with its summary, related titles filtered to the caller's eligible channels, `waitReason` on a pending one, and `processing` with the open window (intent, start, deadline, next attempt) and the latest attempt. An eligible caller, an active follower of an approved channel, also receives `wasUnread`, and the summaries returned to them are marked read; nobody else's receipts are touched.",
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
      const eligible = new Set(
        (await c.var.registry.listEligibleChannels(c.var.identity.email)).map(
          (row) => row.channelId,
        ),
      );
      const records = await c.var.registry.listEpisodes(channel.channelId, {
        limit,
        relatedScope: [...eligible],
      });

      // Read receipts belong to eligible callers only (docs/PRD.md §4.4); everyone else receives
      // the same summaries with nothing recorded, so a first follow still starts unread.
      const recordsReceipts = eligible.has(channel.channelId);
      let alreadyRead = new Set<string>();
      if (recordsReceipts) {
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
            wasUnread:
              recordsReceipts && record.summary !== null
                ? !alreadyRead.has(record.videoId)
                : undefined,
          }),
        ),
      });
    },
  )

  .post(
    "/:id/episodes/:videoId/retry",
    describeRoute({
      tags: ["episodes"],
      summary: "Retry an episode",
      description:
        "Any episode state, in any channel status. A `pending`, `failed`, or `skipped` episode returns to `pending` with intent `publish` and a fresh 48-hour window; an `available` one gets intent `replace`, its summary and vectors untouched until the replacement succeeds. Refused only while an attempt is running. Until M3 lands the attempt starter, nothing launches and the response is the episode alone. The web offers this to the owner.",
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode, pending again."),
        ...errorResponses({
          notFound: true,
          conflict: "An attempt is running for this episode",
        }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, videoId } = c.req.valid("param");
      const record = await c.var.registry.retryEpisode(id, videoId);
      requestIngestion(id, "episode_retry");
      return c.json<EpisodeResponse>({ episode: toEpisode(record) });
    },
  )

  .post(
    "/:id/episodes/:videoId/skip",
    describeRoute({
      tags: ["episodes"],
      summary: "Skip a failed episode",
      description:
        "`failed → skipped`, recorded with skip reason `OWNER` and the caller's email, in any channel status. The web offers this to the owner.",
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode, now skipped."),
        ...errorResponses({
          notFound: true,
          conflict: "The episode is not failed",
        }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, videoId } = c.req.valid("param");
      const record = await c.var.registry.skipEpisode(
        c.var.identity.email,
        id,
        videoId,
      );
      return c.json<EpisodeResponse>({ episode: toEpisode(record) });
    },
  )

  .get(
    "/:id/runs",
    describeRoute({
      tags: ["runs"],
      summary: "List a channel's discovery runs",
      description:
        "Completed RSS discovery runs newest first: kind, whether the feed was read, and how many episodes were created. An episode names the run that discovered it in `processing.discoveredByRunId`. Renamed from `ingestion-runs` on 2026-09-12. The web shows them on the Owner screens.",
      responses: {
        200: jsonResponse(IngestionRunsResponseSchema, "Runs, newest first."),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const runs = await c.var.registry.listRuns(c.req.valid("param").id);
      return c.json<IngestionRunsResponse>({ runs });
    },
  )

  .get(
    "/:id/followers",
    describeRoute({
      tags: ["channels"],
      summary: "List a channel's active followers",
      description:
        "Emails and follow times, oldest first. The web shows emails only in the owner's queue.",
      responses: {
        200: jsonResponse(FollowersResponseSchema, "Active followers."),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) =>
      c.json<FollowersResponse>({
        followers: await c.var.registry.listFollowers(c.req.valid("param").id),
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
  return (await c.var.registry.activeChannelIds(c.var.identity.email)).includes(
    channelId,
  );
}

/** One channel as every caller sees it: the shared fields, `management`, and the caller's own `following`. */
async function fullChannel(c: Ctx, channelId: string): Promise<Channel> {
  const [record] = await c.var.registry.listChannelManagement([channelId]);
  if (!record) throw new DomainError("NOT_FOUND", "channel not found");
  const followers = await c.var.registry.countFollowers([channelId]);
  return toChannel(record, {
    following: await isFollowing(c, channelId),
    followerCount: followers[channelId] ?? 0,
  });
}

/** Follows the caller onto a channel (one Registry write) and returns the channel as they see it. */
async function followAndView(c: Ctx, channelId: string, created: boolean) {
  await c.var.registry.recordFollow(c.var.identity.email, channelId);
  return c.json<ChannelResponse>(
    { channel: await fullChannel(c, channelId) },
    created ? 201 : 200,
  );
}

function declinedResponse(c: Ctx, channel: CatalogChannel) {
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
