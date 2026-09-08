import {
  type HealthResponse,
  HealthResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "./env";
import { jsonResponse, openApiDocument } from "./lib/openapi";
import { onError } from "./middleware/errors";
import { requireIdentity } from "./middleware/user";
import { catalogRoutes } from "./routes/catalog";
import { channelRequestRoutes } from "./routes/channel-requests";
import { channelRoutes } from "./routes/channels";
import { digestRoutes } from "./routes/digest";
import { followRoutes } from "./routes/follows";
import { meRoutes } from "./routes/me";

// Durable Object classes must be exported from the Worker entry.
export { RegistryDO } from "./do/registry";
export { UserDO } from "./do/user";

const app = new Hono<AppEnv>();

app.onError(onError);

// Public. Registered before the identity middleware on purpose: Hono runs handlers in
// registration order, so these never touch the Registry.
app.get(
  "/health",
  describeRoute({
    tags: ["health"],
    summary: "Liveness",
    description: "Answers without touching any storage.",
    security: [],
    responses: {
      200: jsonResponse(HealthResponseSchema, "The service is up."),
    },
  }),
  (context) => context.json<HealthResponse>({ service: "api", status: "ok" }),
);

// The API describes itself from its route definitions (docs/specs/api-reference.md). Hidden from
// its own document; generated once per isolate.
app.get("/openapi.json", describeRoute({ hide: true }), async (context) =>
  context.json(await openApiDocument(app)),
);

// Everything below requires X-User-Email. Routes are named after entities; owner-only
// operations carry `requireOwner` themselves (AGENTS.md → API shape).
app.use("*", requireIdentity);
app.route("/me", meRoutes);
app.route("/catalog", catalogRoutes);
app.route("/channels", channelRoutes);
app.route("/channel-requests", channelRequestRoutes);
app.route("/follows", followRoutes);
app.route("/digest", digestRoutes);

export default app;
