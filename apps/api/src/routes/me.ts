import { type MeResponse, MeResponseSchema } from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";

/** Who the caller is, as the Registry sees them. The web UI uses `role` to show owner controls. */
export const meRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["me"],
    summary: "Who the caller is",
    description:
      "The caller's normalized email and role. The web UI shows owner controls when `role` is `owner`; authorization still happens per operation.",
    responses: {
      200: jsonResponse(MeResponseSchema, "The caller's identity."),
      ...errorResponses(),
    },
  }),
  (c) => {
    const { userId, email, role } = c.var.identity;
    return c.json<MeResponse>({ userId, email, role });
  },
);
