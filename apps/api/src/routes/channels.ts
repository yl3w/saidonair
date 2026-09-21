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
import type { RegistryDO } from "../do/registry";
import type { CatalogChannel, RegistryUser } from "../do/registry/types";
import type { UserDO } from "../do/user";
import type { AppEnv, PublicEnv } from "../env";
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
import { requireOwner } from "../middleware/owner";
import { optionalIdentity, requireIdentity } from "../middleware/user";

type Ctx = Context<AppEnv>;
type Registry = DurableObjectStub<RegistryDO>;

/**
 * Channels are the catalog's members, in **three routers** because a channel route can want three
 * different things of its caller, and `index.ts` registers them in that order (its comment carries
 * the whole ordering):
 *
 * - `channelFeedRoutes` — `GET /channels/feed`, which needs a session and has to be registered
 *   first so the public `/{id}` cannot swallow it.
 * - `channelPublicRoutes` — four reads that answer with or without a session, richer with one.
 * - `channelRoutes` — everything else, below `requireIdentity`.
 *
 * Nine operations are the owner's: the seven that change the catalog, refused with 403 for anybody
 * else since A8 (docs/PRD.md §2, §9), and — since 2026-09-21 — `GET /catalog` and the follower
 * list, which hands one reader another reader's address (docs/specs/route-visibility.md §3). The
 * web offers review, pause, retry, and skip to the owner role. Sub-resources: episodes, discovery
 * runs, followers.
 */

/**
 * `GET /channels/feed` alone, and its own export only because of where it has to be registered.
 * It is **not** public — it makes an outbound request to YouTube per call, so anonymous access
 * would make it an unmetered proxy (docs/specs/route-visibility.md §3, decision 6) — so it mounts
 * `requireIdentity` itself. It must be registered ahead of the public `GET /channels/{id}`:
 * `ChannelParamsSchema` validates an id as any non-empty string, so `feed` passes validation and
 * the id route would answer 404 for it. Verified against Hono before the split, not assumed.
 */

export const channelFeedRoutes = new Hono<AppEnv>().get(
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
  requireIdentity,
  validate("query", ChannelFeedQuerySchema),
  async (c) => {
    const channelId = extractChannelId(c.req.valid("query").channelId);
    const fetcher = feedFetcher(c.env);
    const [channelFeed, longForm] = await Promise.all([
      fetchChannelFeed(channelId, fetcher),
      fetchLongFormFeed(channelId, fetcher),
    ]);
    if (!channelFeed) {
      throw new DomainError("INVALID_INPUT", "no YouTube channel has that id");
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
      channel:
        existing === null
          ? null
          : await fullChannel(c.var.registry, channelId, c.var.identity),
    });
  },
);

/**
 * The four channel reads a signed-out caller may make (docs/specs/route-visibility.md §3). Mounted
 * above `requireIdentity`, so they answer whether or not a session was presented, and typed
 * `PublicEnv`, so the compiler makes each one say what it does without a caller: `management`
 * omitted, `following` false, `related` empty and `read` absent, with the summary, `status`,
 * `skipReason` and `waitReason` the same for everyone (§4.3).
 */

export const channelPublicRoutes = new Hono<PublicEnv>()
  // Once for the router rather than four times: a read added here is public by default, which is
  // the right default for a file whose only members are public reads.
  .use("*", optionalIdentity)
  .get(
    "/",
    describeRoute({
      tags: ["channels"],
      summary: "List channels",
      description:
        "Requested and approved channels, each with `following`, `followerCount` and `episodes`; `?scope=all` adds every status including declined. **Public**: a caller with a session also receives `management` and their own `following`, and an anonymous one receives neither — `management` is absent and `following` is `false`. `followerCount` is present either way.",
      security: [],
      responses: {
        200: jsonResponse(ChannelsResponseSchema, "The channels."),
        ...errorResponses({ public: true }),
      },
    }),
    validate("query", ScopeQuerySchema),
    async (c) => {
      const { scope } = c.req.valid("query");
      const registry = c.var.registry;
      const identity = c.var.identity;
      const following = new Set(
        identity === undefined
          ? []
          : await registry.activeChannelIds(identity.userId),
      );
      const rows =
        scope === "all"
          ? await registry.listChannelManagement()
          : await registry.listCatalogManagement();
      const followers = await registry.countFollowers(
        rows.map((row) => row.channel.channelId),
      );
      return c.json<ChannelsResponse>({
        channels: rows.map((row) =>
          toChannel(row, {
            following: following.has(row.channel.channelId),
            followerCount: followers[row.channel.channelId] ?? 0,
            management: identity !== undefined,
          }),
        ),
      });
    },
  )

  .get(
    "/:id",
    describeRoute({
      tags: ["channels"],
      summary: "Get a channel",
      description:
        "One channel in any status, so a declined one can show its note. **Public**: `management` accompanies it for a caller with a session and is absent without one.",
      security: [],
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The channel."),
        ...errorResponses({ public: true, notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    async (c) => {
      const registry = c.var.registry;
      const channel = await requireChannel(registry, c.req.valid("param").id);
      return c.json<ChannelResponse>({
        channel: await fullChannel(registry, channel.channelId, c.var.identity),
      });
    },
  )

  .get(
    "/:id/episodes",
    describeRoute({
      tags: ["episodes"],
      summary: "List a channel's episodes",
      description:
        "Newest first, each with its summary, `status`, `skipReason` and `waitReason` on a pending one. A pure read: no receipt is recorded here or anywhere else a route only reads (docs/PRD.md §4.4). **Public**: a caller with a session also receives `processing` — the open window (intent, start, deadline, next attempt) and the latest attempt — and related titles filtered to their eligible channels, and an eligible caller, an active follower of an approved channel, also receives `read` per summary. An anonymous caller receives the summaries with `processing` absent, `related` empty and no `read`.",
      security: [],
      responses: {
        200: jsonResponse(EpisodesResponseSchema, "Episodes, newest first."),
        ...errorResponses({ public: true, notFound: true }),
      },
    }),
    validate("param", ChannelParamsSchema),
    validate("query", LimitQuerySchema),
    async (c) => {
      const registry = c.var.registry;
      const identity = c.var.identity;
      const channel = await requireChannel(registry, c.req.valid("param").id);
      const { limit } = c.req.valid("query");
      const eligible = await eligibleChannelIds(registry, identity);
      const records = await registry.listEpisodes(channel.channelId, {
        limit,
        relatedScope: [...eligible],
      });

      // Read state belongs to eligible callers only (docs/PRD.md §4.4); everyone else receives the
      // same summaries with no receipt of their own to report. An anonymous caller is eligible for
      // nothing, so this is empty and the User DO is never addressed.
      const summaries = eligible.has(channel.channelId)
        ? records.filter((record) => record.summary !== null)
        : [];
      const read = await readSubset(
        c.var.user,
        summaries.map((record) => record.episodeId),
      );

      return c.json<EpisodesResponse>({
        episodes: records.map((record) =>
          toEpisode(record, {
            read:
              eligible.has(channel.channelId) && record.summary !== null
                ? read.has(record.episodeId)
                : undefined,
            processing: identity !== undefined,
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
        "One episode of a channel with its summary — the reading view's deep link, answering on a cold load. A pure read: it records nothing. **Public**, and it degrades exactly as the list above does: `processing` and the related titles need a session, and `read` an eligible caller.",
      security: [],
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode."),
        ...errorResponses({ public: true, notFound: true }),
      },
    }),
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, episodeId } = c.req.valid("param");
      const registry = c.var.registry;
      const identity = c.var.identity;
      await requireChannel(registry, id);
      const eligible = await eligibleChannelIds(registry, identity);
      const record = await registry.getEpisode(id, episodeId, [...eligible]);
      if (!record) throw new DomainError("NOT_FOUND", "episode not found");
      const reports = eligible.has(id) && record.summary !== null;
      const read = reports
        ? (await readSubset(c.var.user, [episodeId])).has(episodeId)
        : undefined;
      return c.json<EpisodeResponse>({
        episode: toEpisode(record, {
          read,
          processing: identity !== undefined,
        }),
      });
    },
  );

export const channelRoutes = new Hono<AppEnv>()
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
        "`requested` or `declined` → `approved`. Sets `approvedAt` the first time and performs the initial discovery run only then, even when the new channel is paused for having no followers; the run is complete when this answers, so `management.latestRun` already reports it, and a feed that could not be read is recorded as `unavailable` without failing the approval. A re-approved channel waits for the next scheduled discovery. Recomputes the pause from the follower count. The caller is recorded as the reviewer; the web offers this to the owner.",
      responses: {
        200: jsonResponse(ChannelResponseSchema, "The approved channel."),
        ...errorResponses({
          owner: true,
          notFound: true,
          conflict: "The channel is already approved",
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    validate("json", ApproveChannelBodySchema),
    async (c) => {
      const { channel, importStarts } = await c.var.registry.approveChannel(
        c.var.identity.userId,
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
        channel: await fullChannel(
          c.var.registry,
          channel.channelId,
          c.var.identity,
        ),
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
          owner: true,
          notFound: true,
          conflict: "The channel is already declined",
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    validate("json", DeclineChannelBodySchema),
    async (c) => {
      const channel = await c.var.registry.declineChannel(
        c.var.identity.userId,
        c.req.valid("param").id,
        c.req.valid("json"),
      );
      return c.json<ChannelResponse>({
        channel: await fullChannel(
          c.var.registry,
          channel.channelId,
          c.var.identity,
        ),
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
          owner: true,
          notFound: true,
          conflict: "Only approved channels can be paused or resumed",
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.pauseChannel(
        c.req.valid("param").id,
      );
      return c.json<ChannelResponse>({
        channel: await fullChannel(
          c.var.registry,
          channel.channelId,
          c.var.identity,
        ),
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
          owner: true,
          notFound: true,
          conflict: "Only approved channels can be paused or resumed",
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await c.var.registry.resumeChannel(
        c.req.valid("param").id,
      );
      return c.json<ChannelResponse>({
        channel: await fullChannel(
          c.var.registry,
          channel.channelId,
          c.var.identity,
        ),
      });
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
        episode: toEpisode(record, { read: true, processing: true }),
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
        episode: toEpisode(record, { read: false, processing: true }),
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
          owner: true,
          notFound: true,
          conflict: "An attempt is running for this episode",
        }),
      },
    }),
    requireOwner,
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
          c.var.identity.userId,
        );
        return c.json<EpisodeRetryResponse>({
          episode: toEpisode(blocked.episode, { processing: true }),
          attempt: blocked.attempt,
        });
      }

      const reopened = await registry.retryEpisode(id, episodeId);
      const [result] = await startEpisodeAttempts(
        c.env,
        [reopened],
        "owner_retry",
        {
          requestedByUserId: c.var.identity.userId,
        },
      );
      if (!result)
        throw new Error("the starter answered nothing for one episode");
      const after = await registry.getEpisode(id, episodeId);
      return c.json<EpisodeRetryResponse>({
        episode: toEpisode(after ?? reopened, { processing: true }),
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
          owner: true,
          notFound: true,
          conflict: "The episode is not failed",
        }),
      },
    }),
    requireOwner,
    validate("param", EpisodeParamsSchema),
    async (c) => {
      const { id, episodeId } = c.req.valid("param");
      const record = await c.var.registry.skipEpisode(
        c.var.identity.userId,
        id,
        episodeId,
      );
      return c.json<EpisodeResponse>({
        episode: toEpisode(record, { processing: true }),
      });
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
          owner: true,
          notFound: true,
          conflict: "Only an approved channel is checked",
          upstream: true,
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) => {
      const channel = await requireChannel(
        c.var.registry,
        c.req.valid("param").id,
      );
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
        "Emails and follow times, oldest first. The owner's: a list of who reads what is not something a reader would expect a stranger to browse, and PRD §8's carve-out for it was withdrawn on 2026-09-21. The owner still sees addresses; the web shows them in the owner's queue.",
      responses: {
        200: jsonResponse(FollowersResponseSchema, "Active followers."),
        ...errorResponses({ owner: true, notFound: true }),
      },
    }),
    requireOwner,
    validate("param", ChannelParamsSchema),
    async (c) =>
      c.json<FollowersResponse>({
        followers: await c.var.registry.listFollowers(c.req.valid("param").id),
      }),
  );

/**
 * Every caller sees a channel in any status; only an unknown id is 404. Takes the stub rather than
 * the context because both the public and the guarded routers call it, and they do not share a
 * context type.
 */

async function requireChannel(
  registry: Registry,
  channelId: string,
): Promise<CatalogChannel> {
  const channel = await registry.getChannel(channelId);
  if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
  return channel;
}

/**
 * The caller's receipts among the given summaries; the empty list never crosses to the User DO,
 * and neither does an anonymous caller — they have no stub, and no receipts to find.
 */
async function readSubset(
  user: DurableObjectStub<UserDO> | undefined,
  episodeIds: string[],
): Promise<ReadonlySet<string>> {
  if (user === undefined || episodeIds.length === 0) return new Set<string>();
  return new Set(await user.readEpisodeIds(episodeIds));
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
  const eligible = await eligibleChannelIds(c.var.registry, c.var.identity);
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

/** An anonymous caller follows nothing, so the question never reaches the Registry. */
async function isFollowing(
  registry: Registry,
  identity: RegistryUser | undefined,
  channelId: string,
): Promise<boolean> {
  if (identity === undefined) return false;
  return (await registry.activeChannelIds(identity.userId)).includes(channelId);
}

/**
 * One channel as this caller sees it: the shared fields, their own `following`, and `management`
 * whenever there is a caller at all (docs/specs/route-visibility.md §4.3).
 */
async function fullChannel(
  registry: Registry,
  channelId: string,
  identity: RegistryUser | undefined,
): Promise<Channel> {
  const [record] = await registry.listChannelManagement([channelId]);
  if (!record) throw new DomainError("NOT_FOUND", "channel not found");
  const followers = await registry.countFollowers([channelId]);
  return toChannel(record, {
    following: await isFollowing(registry, identity, channelId),
    followerCount: followers[channelId] ?? 0,
    management: identity !== undefined,
  });
}

/** Follows the caller onto a channel (one Registry write) and returns the channel as they see it. */
async function followAndView(c: Ctx, channelId: string, created: boolean) {
  await c.var.registry.recordFollow(c.var.identity.userId, channelId);
  return c.json<ChannelResponse>(
    { channel: await fullChannel(c.var.registry, channelId, c.var.identity) },
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
