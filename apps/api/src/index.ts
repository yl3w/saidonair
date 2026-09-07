import type { HealthResponse } from "@media-digest/shared";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { onError } from "./middleware/errors";
import { requireIdentity } from "./middleware/user";
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

// Everything below requires X-User-Email.
app.use("*", requireIdentity);
app.route("/me", meRoutes);

export default app;
