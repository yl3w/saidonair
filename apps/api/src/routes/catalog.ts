import {
  type CatalogResponse,
  CatalogResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { transcriptProviderHealth } from "../lib/transcripts/status";
import { requireOwner } from "../middleware/owner";

/**
 * The catalog as an entity: its aggregate state, for the attention card and health strip, plus
 * the transcript provider's health. The two are read side by side; the provider can only ever
 * answer `unreachable`, never fail the route.
 *
 * **The owner's**, since 2026-09-21 (docs/specs/route-visibility.md §3). This is an operations
 * dashboard — what needs the owner, and a third party's billing state about the owner's account —
 * and only the owner's Settings screen renders it.
 */
export const catalogRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["catalog"],
    summary: "Catalog health",
    description:
      "Channels by state, episodes by state, active runs, the last successful ingestion, and the transcript provider's remaining credits and key status (cached for five minutes). The owner's: the `attention` block and the provider's credit balance are operational, and the web shows them on the owner's Settings screen.",
    responses: {
      200: jsonResponse(
        CatalogResponseSchema,
        "The catalog's aggregate state.",
      ),
      ...errorResponses({ owner: true }),
    },
  }),
  requireOwner,
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
