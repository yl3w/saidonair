import {
  type DigestResponse,
  DigestResponseSchema,
  SinceQuerySchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { toEpisode } from "../lib/episode-view";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Show last 7 days" is the widest view; there is no paging beyond it in this slice. */
const MAX_WINDOW_MS = 7 * DAY_MS;

/**
 * The caller's digest: available episodes with summaries from eligible follows, newest first.
 * A pure read: it records nothing (docs/PRD.md §4.4, changed 2026-09-14), and `read` reports the
 * receipt each row already carries.
 */
export const digestRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["digest"],
    summary: "The caller's digest",
    description:
      "Available episodes with summaries from eligible follows (active follows on approved channels), newest first by `summaryAvailableAt`. The window defaults to the last 24 hours and is clamped to 7 days. A pure read: no receipt is recorded, and `read` reports the one each row already carries.",
    responses: {
      200: jsonResponse(
        DigestResponseSchema,
        "Episodes in the window, and the window start actually used.",
      ),
      ...errorResponses(),
    },
  }),
  validate("query", SinceQuerySchema),
  async (c) => {
    const now = Date.now();
    const requested = c.req.valid("query").since;
    const since = Math.max(
      requested === undefined ? now - DAY_MS : Date.parse(requested),
      now - MAX_WINDOW_MS,
    );

    const eligible = await c.var.registry.listEligibleChannels(
      c.var.identity.email,
    );
    if (eligible.length === 0) {
      return c.json<DigestResponse>({ since, episodes: [] });
    }

    const records = await c.var.registry.listDigest(
      eligible.map((channel) => channel.channelId),
      since,
    );
    const read =
      records.length === 0
        ? new Set<string>()
        : new Set(
            await c.var.user.readVideoIds(
              records.map((record) => record.videoId),
            ),
          );

    return c.json<DigestResponse>({
      since,
      episodes: records.map((record) =>
        toEpisode(record, { read: read.has(record.videoId) }),
      ),
    });
  },
);
