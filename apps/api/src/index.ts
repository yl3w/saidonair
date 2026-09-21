import {
  type HealthResponse,
  HealthResponseSchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv, Env } from "./env";
import { makeAuth } from "./lib/auth";
import { corsMiddleware } from "./lib/cors";
import { runScheduled } from "./lib/ingestion";
import { jsonResponse, openApiDocument } from "./lib/openapi";
import { onError } from "./middleware/errors";
import { requireIdentity } from "./middleware/user";
import { catalogRoutes } from "./routes/catalog";
import { channelRoutes } from "./routes/channels";
import { chatRoutes } from "./routes/chats";
import { digestRoutes } from "./routes/digest";
import { docsPage } from "./routes/docs";
import { episodeRoutes } from "./routes/episodes";
import { followRoutes } from "./routes/follows";
import { meRoutes } from "./routes/me";
import { preferenceRoutes } from "./routes/preferences";
import { sessionRoutes } from "./routes/session";

// Durable Object and Workflow classes must be exported from the Worker entry.
export { RegistryDO } from "./do/registry";
export { UserDO } from "./do/user";
export { IngestWorkflow } from "./workflows/ingest";

export const app = new Hono<AppEnv>();

app.onError(onError);

// Browser clients on another origin (the Pages web app, Vite locally). First, so a preflight never
// reaches the identity middleware. Allowed origins come from WEB_ORIGINS (lib/cors.ts).
app.use("*", corsMiddleware);

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

// The browser test client (routes/docs.ts): this API's one HTML response, the owner's exception of
// 2026-09-07 to "JSON everywhere".
app.get("/docs", describeRoute({ hide: true }), docsPage);

// better-auth owns /auth/* entirely (lib/auth.ts, basePath "/auth"). Public, and registered before
// the identity middleware for the same reason /health is: signing in cannot require being signed
// in. Hidden from the API document — these routes are the library's, described by its own docs, and
// openapi.test.ts asserts this one exclusion rather than letting it drift (docs/specs/auth-phase.md
// §4.7). Nothing consumes the session yet; chunk A7 is where it becomes the identity.
app.all("/auth/*", describeRoute({ hide: true }), (context) =>
  makeAuth(context.env).handler(context.req.raw),
);

// Ours, beside better-auth's: begin a sign-in, hand the session to the web, exchange the code for
// it. Public for the same reason — obtaining a token cannot require one (docs/specs/auth-phase.md
// §4.5). Nothing consumes the session yet; A7 is where it becomes the identity.
app.route("/session", sessionRoutes);

// Everything below requires X-User-Email. Routes are named after entities, and none checks a
// role: the API enforces no authorization (docs/PRD.md §9).
app.use("*", requireIdentity);
app.route("/me", meRoutes);
app.route("/catalog", catalogRoutes);
app.route("/channels", channelRoutes);
app.route("/episodes", episodeRoutes);
app.route("/follows", followRoutes);
app.route("/digest", digestRoutes);
app.route("/chats", chatRoutes);
app.route("/preferences", preferenceRoutes);

/**
 * The Worker: HTTP through Hono, and the cron triggers of `env.production` (`wrangler.jsonc`)
 * dispatched by expression in `lib/ingestion.ts`. Locally `wrangler dev --test-scheduled` exposes
 * `GET /__scheduled?cron=<expression>` to fire one.
 */
const worker: ExportedHandler<Env> = {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await runScheduled(controller.cron, env);
  },
};

export default worker;
