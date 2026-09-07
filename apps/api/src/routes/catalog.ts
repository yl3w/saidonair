import type { CatalogResponse } from "@media-digest/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireOwner } from "../middleware/owner";

/** The catalog as an entity: its aggregate state, for the owner's attention card and health strip. */
export const catalogRoutes = new Hono<AppEnv>().get(
  "/",
  requireOwner,
  async (c) => {
    const catalog = await c.var.registry.getCatalogSummary(
      c.var.identity.email,
    );
    return c.json<CatalogResponse>({ catalog });
  },
);
