import type {
  ApproveChannelRequestResponse,
  ChannelAlreadyAvailableResponse,
  ChannelRequest,
  ChannelRequestResponse,
  ChannelRequestsResponse,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import type { ChannelRequest as ChannelRequestRecord } from "../do/registry/types";
import type { AppEnv } from "../env";
import {
  optionalPositiveInt,
  optionalString,
  parseScope,
  readJsonObject,
  readOptionalJsonObject,
  requireString,
} from "../lib/body";
import { isAvailable } from "../lib/channel-view";
import { DomainError } from "../lib/errors";
import { requestIngestion } from "../lib/ingestion";
import { toChannelRequest } from "../lib/outcome";
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
  .get("/", async (c) => {
    const scope = parseScope(c.req.query("scope"));
    const requests =
      scope === "all"
        ? await c.var.registry.listAllRequests(assertOwner(c))
        : await c.var.registry.listOwnRequests(c.var.identity.email);
    return c.json<ChannelRequestsResponse>({
      requests: await withChannelState(c, requests),
    });
  })

  .post("/", async (c) => {
    const body = await readJsonObject(c);
    const submitted = requireString(body, "channelId").trim();
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
      throw new DomainError("INVALID_INPUT", "no YouTube channel has that id");
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
  })

  .post("/:id/approve", requireOwner, async (c) => {
    const body = await readOptionalJsonObject(c);
    const { request, channel, channelCreated } =
      await c.var.registry.approveRequest(
        c.var.identity.email,
        c.req.param("id"),
        {
          title: optionalString(body, "title"),
          initialImportCount: optionalPositiveInt(body, "initialImportCount"),
          explanation: optionalString(body, "explanation"),
        },
      );
    if (channelCreated) {
      requestIngestion(channel.channelId, "request_approved");
    }
    return c.json<ApproveChannelRequestResponse>({
      request: toChannelRequest(request, channel),
      channel: await ownerChannel(c, channel.channelId),
      channelCreated,
    });
  })

  .post("/:id/reject", requireOwner, async (c) => {
    const body = await readOptionalJsonObject(c);
    const request = await c.var.registry.rejectRequest(
      c.var.identity.email,
      c.req.param("id"),
      { explanation: optionalString(body, "explanation") },
    );
    const channel = await c.var.registry.getChannel(request.youtubeChannelId);
    return c.json<ChannelRequestResponse>({
      request: toChannelRequest(request, channel),
    });
  });

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
