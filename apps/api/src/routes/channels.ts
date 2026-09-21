import {
  ApproveChannelBodySchema,
  type Channel,
  type ChannelDeclinedResponse,
  ChannelDeclinedResponseSchema,
  ChannelFeedQuerySchema,
  type ChannelFeedResponse,
  ChannelFeedResponseSchema,
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
  type EpisodeRetryResponse,
  EpisodeRetryResponseSchema,
  type EpisodesResponse,
  EpisodesResponseSchema,
  type FollowersResponse,
  FollowersResponseSchema,
  type IngestionRunResponse,
  IngestionRunResponseSchema,
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
import { eligibleChannelIds } from "../lib/eligibility";
import { toEpisode } from "../lib/episode-view";
import { DomainError, domainErrorCode } from "../lib/errors";
import {
  closeLostEpisodeAttempt,
  preflight,
  RECONCILE_AFTER_MS,
  startDiscovery,
  startEpisodeAttempts,
} from "../lib/ingestion";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { transcriptProviderHealth } from "../lib/transcripts/status";
import { validate } from "../lib/validation";
import { ingestLauncher } from "../lib/workflows";
import { extractChannelId } from "../lib/youtube/ids";
import {
  feedFetcher,
  fetchChannelFeed,
  fetchLongFormFeed,
} from "../lib/youtube/rss";

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
        await c.var.registry.activeChannelIds(c.var.identity.userId),
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

  .get(
    "/feed",
    describeRoute({
      tags: ["channels"],
      summary: "Read a channel id's feeds",
      description:
        "What YouTube's two public feeds say about an id right now, and whatever the catalog already holds for it. Nothing is created and nothing is stored: this is the middle of the three steps that add a channel, so a reader can see the title and how much long-form the channel actually publishes before deciding. Discovery reads the long-form feed alone, so `longFormCount` is the number that matters — a channel whose newest fifteen are all Shorts makes no episodes. A handle or an id with no feed is 400. Registered before `/{id}`, and `feed` is not a shape a channel id can take.",
      responses: {
        200: jsonResponse(
          ChannelFeedResponseSchema,
          "What the feeds say, and what the catalog holds.",
        ),
        ...errorResponses({ upstream: true }),
      },
    }),
    validate("query", ChannelFeedQuerySchema),
    async (c) => {
      const channelId = extractChannelId(c.req.valid("query").channelId);
      const fetcher = feedFetcher(c.env);
      const [channelFeed, longForm] = await Promise.all([
        fetchChannelFeed(channelId, fetcher),
        fetchLongFormFeed(channelId, fetcher),
      ]);
      if (!channelFeed) {
        throw new DomainError(
          "INVALID_INPUT",
          "no YouTube channel has that id",
        );
      }
      // The long-form feed is an exact subset of the channel feed (docs/specs/
      // discovery-long-form-feed.md), so "how many of the newest fifteen are long-form" is the
      // overlap; a 404 on that feed means none at all.
      const longFormIds = new Set(
        (longForm?.entries ?? []).map((entry) => entry.videoId),
      );
      const existing = await c.var.registry.getChannel(channelId);
      return c.json<ChannelFeedResponse>({
        feed: {
          channelId,
          title: channelFeed.title,
          entryCount: channelFeed.entries.length,
          longFormCount: channelFeed.entries.filter((entry) =>
            longFormIds.has(entry.videoId),
          ).length,
          newestLongFormAt:
            longForm?.entries.reduce<number | null>(
              (newest, entry) =>
                newest === null || entry.publishedAt > newest
                  ? entry.publishedAt
                  : newest,
              null,
            ) ?? null,
        },
        channel: existing === null ? null : await fullChannel(c, channelId),
      });
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
        "`requested` or `declined` → `approved`. Sets `approvedAt` the first time and performs the initial discovery run only then, even when the new channel is paused for having no followers; the run is complete when this answers, so `management.latestRun` already reports it, and a feed that could not be read is recorded as `unavailable` without failing the approval. A re-approved channel waits for the next scheduled discovery. Recomputes the pause from the follower count. The caller is recorded as the reviewer; the web offers this to the owner.",
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
      // First approval discovers now (docs/PRD.md §4.2 rules 1 and 4); RSS can never fail an approval.
      if (importStarts) {
        try {
          await startDiscovery(c.env, channel.channelId);
        } catch (error) {
          console.log({
            event: "discovery.failed_after_approval",
            channelId: channel.channelId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
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
        "Newest first, each with its summary, related titles filtered to the caller's eligible channels, `waitReason` on a pending one, and `processing` with the open window (intent, start, deadline, next attempt) and the latest attempt. A pure read: an eligible caller, an active follower of an approved channel, also receives `read` per summary, and no receipt is recorded here or anywhere else a route only reads (docs/PRD.md §4.4).",
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
      const eligible = await eligibleChannelIds(c);
      const records = await c.var.registry.listEpisodes(channel.channelId, {
        limit,
        relatedScope: [...eligible],
      });

      // Read state belongs to eligible callers only (docs/PRD.md §4.4); everyone else receives the
      // same summaries with no receipt of their own to report.
      const summaries = eligible.has(channel.channelId)
        ? records.filter((record) => record.summary !== null)
        : [];
      const read = await readSubset(
        c,
        summaries.map((record) => record.episodeId),
      );

      return c.json<EpisodesResponse>({
        episodes: records.map((record) =>
          toEpisode(record, {
            read:
              eligible.has(channel.channelId) && record.summary !== null
                ? read.has(record.episodeId)
                : undefined,
          }),
        ),
      });
    },
  )

  .get(
    "/:id/episodes/:episodeId",
    describeRoute({
      tags: ["episodes"],
      summary: "Get one episode",
      description:
        "One episode of a channel with its summary, related titles filtered to the caller's eligible channels, and `processing` — the reading view's deep link, answering on a cold load. An eligible caller also receives `read`. A pure read: it records nothing.",
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode."),
        ...errorResponses({ notFound: true }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, episodeId } = c.req.valid("param");
      await requireChannel(c, id);
      const eligible = await eligibleChannelIds(c);
      const record = await c.var.registry.getEpisode(id, episodeId, [
        ...eligible,
      ]);
      if (!record) throw new DomainError("NOT_FOUND", "episode not found");
      const reports = eligible.has(id) && record.summary !== null;
      const read = reports
        ? (await readSubset(c, [episodeId])).has(episodeId)
        : undefined;
      return c.json<EpisodeResponse>({ episode: toEpisode(record, { read }) });
    },
  )

  .post(
    "/:id/episodes/:episodeId/read",
    describeRoute({
      tags: ["episodes"],
      summary: "Mark a summary read",
      description:
        "Records the caller's read receipt, the one write that marks a summary done (docs/PRD.md §4.4). Idempotent: an existing receipt keeps its original time. Only an eligible caller, an active follower of an approved channel, has receipts; anyone else records nothing and gets 404.",
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode, now read."),
        ...errorResponses({
          notFound: true,
          conflict: "The episode has no summary to mark read",
        }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, episodeId } = c.req.valid("param");
      const record = await requireReadableSummary(c, id, episodeId);
      await c.var.user.markRead([episodeId]);
      return c.json<EpisodeResponse>({
        episode: toEpisode(record, { read: true }),
      });
    },
  )

  .delete(
    "/:id/episodes/:episodeId/read",
    describeRoute({
      tags: ["episodes"],
      summary: "Undo a read receipt",
      description:
        "Removes the caller's read receipt, so the summary returns to the queue. Idempotent. Only an eligible caller has receipts; anyone else removes nothing and gets 404. The web offers this from History, where the row is visible (docs/design.md §4).",
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode, now unread."),
        ...errorResponses({
          notFound: true,
          conflict: "The episode has no summary to mark read",
        }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, episodeId } = c.req.valid("param");
      const record = await requireReadableSummary(c, id, episodeId);
      await c.var.user.clearRead([episodeId]);
      return c.json<EpisodeResponse>({
        episode: toEpisode(record, { read: false }),
      });
    },
  )

  .post(
    "/:id/episodes/:episodeId/retry",
    describeRoute({
      tags: ["episodes"],
      summary: "Retry an episode",
      description:
        "Any episode state, in any channel status. Refused with 409 only while an attempt is running: under an hour old unconditionally, older only when the Workflow engine still reports it active (a gone or missing instance is reconciled as WORKFLOW_LOST first). Then the transcript provider's pre-flight: a rejected key or no credits records a `blocked` attempt and returns the episode unchanged. Otherwise a `pending`, `failed`, or `skipped` episode returns to `pending` with intent `publish` and a fresh 48-hour window, an `available` one gets intent `replace` with its summary and vectors untouched until the replacement succeeds, and one Workflow instance starts at once. Never reads RSS or writes a channel or run. The web offers this to the owner.",
      responses: {
        200: jsonResponse(
          EpisodeRetryResponseSchema,
          "The episode and the attempt just started, or blocked.",
        ),
        ...errorResponses({
          notFound: true,
          conflict: "An attempt is running for this episode",
        }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, episodeId } = c.req.valid("param");
      const registry = c.var.registry;
      const before = await registry.getEpisode(id, episodeId);
      if (!before) throw new DomainError("NOT_FOUND", "episode not found");

      // A running attempt refuses Retry, unless it is old and the engine has lost it (rule 17).
      const running = before.processing.latestAttempt;
      if (running?.status === "running") {
        const refuse = () =>
          new DomainError(
            "INVALID_STATE",
            "an attempt is running for this episode",
          );
        if (Date.now() - running.startedAt < RECONCILE_AFTER_MS) throw refuse();
        const status = await ingestLauncher(c.env).status(running.attemptId);
        if (status === "active") throw refuse();
        await closeLostEpisodeAttempt(c.env, running.attemptId);
      }

      // Pre-flight before the window resets, so a blocked Retry leaves the window untouched (rule 16).
      const block = preflight(await transcriptProviderHealth(c.env));
      if (block) {
        const blocked = await registry.recordBlockedAttempt(
          episodeId,
          "owner_retry",
          block,
          c.var.identity.email,
        );
        return c.json<EpisodeRetryResponse>({
          episode: toEpisode(blocked.episode),
          attempt: blocked.attempt,
        });
      }

      const reopened = await registry.retryEpisode(id, episodeId);
      const [result] = await startEpisodeAttempts(
        c.env,
        [reopened],
        "owner_retry",
        {
          requestedByEmail: c.var.identity.email,
        },
      );
      if (!result)
        throw new Error("the starter answered nothing for one episode");
      const after = await registry.getEpisode(id, episodeId);
      return c.json<EpisodeRetryResponse>({
        episode: toEpisode(after ?? reopened),
        attempt: result.attempt,
      });
    },
  )

  .post(
    "/:id/episodes/:episodeId/skip",
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
      const { id, episodeId } = c.req.valid("param");
      const record = await c.var.registry.skipEpisode(
        c.var.identity.email,
        id,
        episodeId,
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

  .post(
    "/:id/runs",
    describeRoute({
      tags: ["runs"],
      summary: "Check the feed now",
      description:
        "One discovery run of an approved channel, paused or not: reads the RSS feed, records the completed run, creates the untracked entries as pending episodes, and starts their attempts. Answers the completed run, including one that found nothing new. 409 `INVALID_STATE` for a requested or declined channel. When YouTube does not answer, the `unavailable` run is recorded first and the response is 502 `UPSTREAM_UNAVAILABLE`. Never touches the transcript provider. The web offers this to the owner.",
      responses: {
        200: jsonResponse(
          IngestionRunResponseSchema,
          "The completed discovery run.",
        ),
        ...errorResponses({
          notFound: true,
          conflict: "Only an approved channel is checked",
          upstream: true,
        }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await requireChannel(c, c.req.valid("param").id);
      if (channel.status !== "approved") {
        throw new DomainError(
          "INVALID_STATE",
          `only an approved channel is checked (status: ${channel.status})`,
        );
      }
      const { run } = await startDiscovery(c.env, channel.channelId);
      if (run.feedStatus === "unavailable") {
        throw new DomainError(
          "UPSTREAM_UNAVAILABLE",
          "YouTube did not answer; the unavailable run is recorded",
        );
      }
      return c.json<IngestionRunResponse>({ run });
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

/** The caller's receipts among the given summaries; the empty list never crosses to the User DO. */
async function readSubset(
  c: Ctx,
  episodeIds: string[],
): Promise<ReadonlySet<string>> {
  if (episodeIds.length === 0) return new Set<string>();
  return new Set(await c.var.user.readEpisodeIds(episodeIds));
}

/**
 * The summary a receipt can be written for: an episode of this channel, available with a stored
 * summary, and the caller eligible to read it. An ineligible caller gets 404 and writes nothing,
 * exactly as the implicit rule did (docs/specs/design-phase.md §4.3).
 */
async function requireReadableSummary(
  c: Ctx,
  channelId: string,
  episodeId: string,
) {
  const eligible = await eligibleChannelIds(c);
  if (!eligible.has(channelId)) {
    throw new DomainError("NOT_FOUND", "episode not found");
  }
  const record = await c.var.registry.getEpisode(channelId, episodeId, [
    ...eligible,
  ]);
  if (!record) throw new DomainError("NOT_FOUND", "episode not found");
  if (record.summary === null) {
    throw new DomainError(
      "INVALID_STATE",
      `only a summary can be marked read (status: ${record.status})`,
    );
  }
  return record;
}

async function isFollowing(c: Ctx, channelId: string): Promise<boolean> {
  return (
    await c.var.registry.activeChannelIds(c.var.identity.userId)
  ).includes(channelId);
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
  await c.var.registry.recordFollow(c.var.identity.userId, channelId);
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
