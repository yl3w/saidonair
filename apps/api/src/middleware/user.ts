import type { ErrorResponse } from "@media-digest/shared";
import { createMiddleware } from "hono/factory";
import { getRegistry } from "../do/registry";
import { getUserDO } from "../do/user";
import type { AppEnv } from "../env";
import { makeAuth } from "../lib/auth";

/**
 * Authentication (docs/PRD.md §2, rewritten 2026-09-20). Resolves the bearer token to a
 * better-auth session, resolves that session to a Registry identity, and exposes `identity`,
 * `registry`, and the caller's own per-user DO stub `user` on the context.
 *
 * Until this chunk the identity was `X-User-Email`, a string the caller chose — so anyone who knew
 * the address could read anyone's chats and receipts. That is what this replaces, and why PRD §8's
 * second criterion is true now rather than merely unattempted.
 *
 * A missing or invalid token never reaches either Durable Object.
 */
export const requireIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const session = await makeAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json<ErrorResponse>(
      {
        error: "sign in to use this API",
        code: "UNAUTHENTICATED",
      },
      401,
    );
  }

  const registry = getRegistry(c.env);
  const identity = await registry.ensureIdentity(
    session.user.id,
    session.user.email ?? null,
  );
  c.set("identity", identity);
  c.set("registry", registry);
  c.set("user", getUserDO(c.env, identity.userId));
  await next();
});
