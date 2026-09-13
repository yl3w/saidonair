import {
  type CatalogResponse,
  CatalogResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";

/** The catalog as an entity: its aggregate state, for the attention card and health strip. */
export const catalogRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["catalog"],
    summary: "Catalog health",
    description:
      "Channels by state, episodes by state, active runs, and the last successful ingestion. The web shows it on the Owner screens; the API answers any caller.",
    responses: {
      200: jsonResponse(
        CatalogResponseSchema,
        "The catalog's aggregate state.",
      ),
      ...errorResponses(),
    },
  }),
  async (c) => {
    const catalog = await c.var.registry.getCatalogSummary();
    return c.json<CatalogResponse>({ catalog });
  },
);
