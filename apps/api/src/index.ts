import type { HealthResponse } from "@media-digest/shared";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { onError } from "./middleware/errors";
import { requireIdentity } from "./middleware/user";
import { catalogRoutes } from "./routes/catalog";
import { channelRoutes } from "./routes/channels";
import { meRoutes } from "./routes/me";

// Durable Object classes must be exported from the Worker entry.
export { RegistryDO } from "./do/registry";
export { UserDO } from "./do/user";

const app = new Hono<AppEnv>();

app.onError(onError);

// Public. Registered before the identity middleware on purpose: Hono runs handlers in
// registration order, so /health never touches the Registry.
app.get("/health", (context) =>
  context.json<HealthResponse>({ service: "api", status: "ok" }),
);

// Everything below requires X-User-Email. Routes are named after entities; owner-only
// operations carry `requireOwner` themselves (AGENTS.md → API shape).
app.use("*", requireIdentity);
app.route("/me", meRoutes);
app.route("/catalog", catalogRoutes);
app.route("/channels", channelRoutes);

export default app;
