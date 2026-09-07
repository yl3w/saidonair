import type { HealthResponse } from "@media-digest/shared";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (context) =>
  context.json<HealthResponse>({ service: "api", status: "ok" }),
);

export default app;
