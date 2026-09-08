import {
  type CatalogResponse,
  CatalogResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { requireOwner } from "../middleware/owner";

/** The catalog as an entity: its aggregate state, for the owner's attention card and health strip. */
export const catalogRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["catalog"],
    summary: "Catalog health (owner)",
    description:
      "Channels by state, stuck pending channels, episodes processed and tracked, active runs, pending requests, and the last successful ingestion.",
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
    const catalog = await c.var.registry.getCatalogSummary(
      c.var.identity.email,
    );
    return c.json<CatalogResponse>({ catalog });
  },
);
