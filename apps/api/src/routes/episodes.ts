import {
  EpisodeIdParamsSchema,
  type EpisodeResponse,
  EpisodeResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { toEpisode } from "../lib/episode-view";
import { DomainError } from "../lib/errors";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

/**
 * One episode by its own id. `episodes.episode_id` is a primary key across the whole catalog, so an
 * episode needs no channel to be named — and the reading view, which is addressed `/read/:episodeId`,
 * has only the id on a cold load. The channel-scoped twin under `/channels/:id/episodes/:episodeId`
 * stays for callers that already know the channel and want a mismatch to be a 404.
 */
export const episodeRoutes = new Hono<AppEnv>().get(
  "/:episodeId",
  describeRoute({
    tags: ["episodes"],
    summary: "Get an episode by id",
    description:
      "The episode with its summary, related titles filtered to the caller's eligible channels, and `processing`. An eligible caller — an active follower of an approved channel — also receives `read`. A pure read: it records nothing (docs/PRD.md §4.4).",
    responses: {
      200: jsonResponse(EpisodeResponseSchema, "The episode."),
      ...errorResponses({ notFound: true }),
    },
  }),
  validate("param", EpisodeIdParamsSchema),
  async (c) => {
    const { episodeId } = c.req.valid("param");
    const eligible = new Set(
      (await c.var.registry.listEligibleChannels(c.var.identity.email)).map(
        (channel) => channel.channelId,
      ),
    );
    const record = await c.var.registry.getEpisodeById(episodeId, [
      ...eligible,
    ]);
    if (!record) throw new DomainError("NOT_FOUND", "episode not found");
    const read =
      eligible.has(record.channelId) && record.summary !== null
        ? (await c.var.user.readEpisodeIds([episodeId])).length > 0
        : undefined;
    return c.json<EpisodeResponse>({ episode: toEpisode(record, { read }) });
  },
);
