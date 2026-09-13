import {
  type CatalogResponse,
  CatalogResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { transcriptProviderHealth } from "../lib/transcripts/status";

/**
 * The catalog as an entity: its aggregate state, for the attention card and health strip, plus
 * the transcript provider's health. The two are read side by side; the provider can only ever
 * answer `unreachable`, never fail the route.
 */
export const catalogRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["catalog"],
    summary: "Catalog health",
    description:
      "Channels by state, episodes by state, active runs, the last successful ingestion, and the transcript provider's remaining credits and key status (cached for five minutes). The web shows it on the Owner screens; the API answers any caller.",
    responses: {
      200: jsonResponse(
        CatalogResponseSchema,
        "The catalog's aggregate state.",
      ),
      ...errorResponses(),
    },
  }),
  async (c) => {
    const [summary, transcripts] = await Promise.all([
      c.var.registry.getCatalogSummary(),
      transcriptProviderHealth(c.env),
    ]);
    return c.json<CatalogResponse>({
      catalog: { ...summary, transcripts },
    });
  },
);
