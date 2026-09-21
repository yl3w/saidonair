import {
  EpisodeIdParamsSchema,
  type EpisodeResponse,
  EpisodeResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { PublicEnv } from "../env";
import { eligibleChannelIds } from "../lib/eligibility";
import { toEpisode } from "../lib/episode-view";
import { DomainError } from "../lib/errors";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";
import { optionalIdentity } from "../middleware/user";

/**
 * One episode by its own id. `episodes.episode_id` is a primary key across the whole catalog, so an
 * episode needs no channel to be named — and the reading view, which is addressed `/read/:episodeId`,
 * has only the id on a cold load. The channel-scoped twin under `/channels/:id/episodes/:episodeId`
 * stays for callers that already know the channel and want a mismatch to be a 404.
 *
 * **Public** since 2026-09-21, and registered above `requireIdentity` for it: the summaries are the
 * product and can be read before joining (docs/specs/route-visibility.md §3, decision 4). The whole
 * router is one route, so it needs no split — unlike `/channels`.
 */
export const episodeRoutes = new Hono<PublicEnv>()
  .use("*", optionalIdentity)
  .get(
    "/:episodeId",
    describeRoute({
      tags: ["episodes"],
      summary: "Get an episode by id",
      description:
        "The episode with its summary. A pure read: it records nothing (docs/PRD.md §4.4). **Public**: a caller with a session also receives `processing` and related titles filtered to their eligible channels, and an eligible caller — an active follower of an approved channel — also receives `read`. An anonymous caller receives the summary with `processing` absent, `related` empty and no `read`.",
      security: [],
      responses: {
        200: jsonResponse(EpisodeResponseSchema, "The episode."),
        ...errorResponses({ public: true, notFound: true }),
      },
    }),
    validate("param", EpisodeIdParamsSchema),
    async (c) => {
      const { episodeId } = c.req.valid("param");
      const identity = c.var.identity;
      const eligible = await eligibleChannelIds(c.var.registry, identity);
      const record = await c.var.registry.getEpisodeById(episodeId, [
        ...eligible,
      ]);
      if (!record) throw new DomainError("NOT_FOUND", "episode not found");
      // `c.var.user` exists exactly when `identity` does; an anonymous caller is eligible for
      // nothing, so this is undefined without the User DO ever being addressed.
      const read =
        c.var.user && eligible.has(record.channelId) && record.summary !== null
          ? (await c.var.user.readEpisodeIds([episodeId])).length > 0
          : undefined;
      return c.json<EpisodeResponse>({
        episode: toEpisode(record, {
          read,
          processing: identity !== undefined,
        }),
      });
    },
  );
