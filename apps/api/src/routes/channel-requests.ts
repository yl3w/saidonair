import {
  ApproveChannelRequestBodySchema,
  type ApproveChannelRequestResponse,
  ApproveChannelRequestResponseSchema,
  type ChannelAlreadyAvailableResponse,
  ChannelAlreadyAvailableResponseSchema,
  type ChannelRequest,
  ChannelRequestParamsSchema,
  type ChannelRequestResponse,
  ChannelRequestResponseSchema,
  type ChannelRequestsResponse,
  ChannelRequestsResponseSchema,
  CreateChannelRequestBodySchema,
  RejectChannelRequestBodySchema,
  ScopeQuerySchema,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { ChannelRequest as ChannelRequestRecord } from "../do/registry/types";
import type { AppEnv } from "../env";
import { isAvailable } from "../lib/channel-view";
import { DomainError } from "../lib/errors";
import { requestIngestion } from "../lib/ingestion";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { toChannelRequest } from "../lib/outcome";
import { validate } from "../lib/validation";
import { extractChannelId } from "../lib/youtube/ids";
import { feedFetcher, fetchChannelFeed } from "../lib/youtube/rss";
import { assertOwner, requireOwner } from "../middleware/owner";
import { ownerChannel } from "./channels";

/**
 * A channel request is a user asking the owner to add a channel to the catalog. Requesters see
 * their own; the owner sees everyone's with `?scope=all` and reviews them. One representation
 * serves both: `outcome` for the requester's phrase, `channel.state` for the owner's decision.
 */
export const channelRequestRoutes = new Hono<AppEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["channel-requests"],
      summary: "List channel requests",
      description:
        "The caller's own requests, each with a derived `outcome` and the channel's current catalog state. `?scope=all` (owner) lists everyone's.",
      responses: {
        200: jsonResponse(
          ChannelRequestsResponseSchema,
          "Requests, newest first.",
        ),
        ...errorResponses({ owner: true }),
      },
    }),
    validate("query", ScopeQuerySchema),
    async (c) => {
      const { scope } = c.req.valid("query");
      const requests =
        scope === "all"
          ? await c.var.registry.listAllRequests(assertOwner(c))
          : await c.var.registry.listOwnRequests(c.var.identity.email);
      return c.json<ChannelRequestsResponse>({
        requests: await withChannelState(c, requests),
      });
    },
  )

  .post(
    "/",
    describeRoute({
      tags: ["channel-requests"],
      summary: "Request a channel",
      description:
        "Ask the owner to add a channel, by `UC…` id or a `/channel/UC…` URL. Handles, other URLs, and ids with no RSS feed are rejected with 400. A channel that is already available is refused with 409 and its id, so the client can offer Follow instead. One request per caller and channel.",
      responses: {
        201: jsonResponse(
          ChannelRequestResponseSchema,
          "The recorded request, awaiting review.",
        ),
        ...errorResponses(),
        409: jsonResponse(
          ChannelAlreadyAvailableResponseSchema,
          "The channel is already available; follow it instead (`INVALID_STATE`).",
        ),
      },
    }),
    validate("json", CreateChannelRequestBodySchema),
    async (c) => {
      const submitted = c.req.valid("json").channelId;
      const channelId = extractChannelId(submitted);

      // Nobody should request what they can already follow (decision 6).
      const existing = await c.var.registry.getChannel(channelId);
      if (existing && isAvailable(existing)) {
        return c.json<ChannelAlreadyAvailableResponse>(
          {
            error: "channel is already available; follow it instead",
            code: "INVALID_STATE",
            channelId,
          },
          409,
        );
      }

      const feed = await fetchChannelFeed(channelId, feedFetcher(c.env));
      if (!feed) {
        throw new DomainError(
          "INVALID_INPUT",
          "no YouTube channel has that id",
        );
      }
      const request = await c.var.registry.submitRequest(c.var.identity.email, {
        youtubeChannelId: channelId,
        submittedUrl: submitted,
        channelTitle: feed.title,
      });
      return c.json<ChannelRequestResponse>(
        { request: toChannelRequest(request, existing) },
        201,
      );
    },
  )

  .post(
    "/:id/approve",
    describeRoute({
      tags: ["channel-requests"],
      summary: "Approve a request (owner)",
      description:
        "Creates the channel with the request's stored title unless one is given, starts its initial import, and later follows it automatically for every requester. Refused while the channel is deleted: restore it first.",
      responses: {
        200: jsonResponse(
          ApproveChannelRequestResponseSchema,
          "The approved request, its channel, and whether approval created the channel.",
        ),
        ...errorResponses({
          owner: true,
          notFound: true,
          conflict: "The request is not pending, or its channel is deleted",
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelRequestParamsSchema),
    validate("json", ApproveChannelRequestBodySchema),
    async (c) => {
      const { title, initialImportCount, explanation } = c.req.valid("json");
      const { request, channel, channelCreated } =
        await c.var.registry.approveRequest(
          c.var.identity.email,
          c.req.valid("param").id,
          { title, initialImportCount, explanation },
        );
      if (channelCreated) {
        requestIngestion(channel.channelId, "request_approved");
      }
      return c.json<ApproveChannelRequestResponse>({
        request: toChannelRequest(request, channel),
        channel: await ownerChannel(c, channel.channelId),
        channelCreated,
      });
    },
  )

  .post(
    "/:id/reject",
    describeRoute({
      tags: ["channel-requests"],
      summary: "Reject a request (owner)",
      description:
        "Rejects a pending request, with an optional explanation the requester sees.",
      responses: {
        200: jsonResponse(
          ChannelRequestResponseSchema,
          "The rejected request.",
        ),
        ...errorResponses({
          owner: true,
          notFound: true,
          conflict: "The request is not pending",
        }),
      },
    }),
    requireOwner,
    validate("param", ChannelRequestParamsSchema),
    validate("json", RejectChannelRequestBodySchema),
    async (c) => {
      const request = await c.var.registry.rejectRequest(
        c.var.identity.email,
        c.req.valid("param").id,
        { explanation: c.req.valid("json").explanation },
      );
      const channel = await c.var.registry.getChannel(request.youtubeChannelId);
      return c.json<ChannelRequestResponse>({
        request: toChannelRequest(request, channel),
      });
    },
  );

/** Joins each request to its channel's current state in one Registry call. */
async function withChannelState(
  c: Context<AppEnv>,
  requests: ChannelRequestRecord[],
): Promise<ChannelRequest[]> {
  if (requests.length === 0) return [];
  const ids = [...new Set(requests.map((r) => r.youtubeChannelId))];
  const channels = new Map(
    (await c.var.registry.listChannelsByIds(ids)).map((channel) => [
      channel.channelId,
      channel,
    ]),
  );
  return requests.map((request) =>
    toChannelRequest(request, channels.get(request.youtubeChannelId) ?? null),
  );
}
