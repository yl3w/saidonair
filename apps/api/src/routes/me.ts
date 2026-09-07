import type { MeResponse } from "@media-digest/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";

/** Who the caller is, as the Registry sees them. The web UI uses `role` to show owner controls. */
export const meRoutes = new Hono<AppEnv>().get("/", (c) => {
  const { email, role } = c.var.identity;
  return c.json<MeResponse>({ email, role });
});
