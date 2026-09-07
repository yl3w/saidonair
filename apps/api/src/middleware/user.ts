import type { ErrorResponse } from "@media-digest/shared";
import { createMiddleware } from "hono/factory";
import { getRegistry } from "../do/registry";
import { getUserDO } from "../do/user";
import type { AppEnv } from "../env";
import { normalizeEmail } from "../lib/email";

export const USER_EMAIL_HEADER = "X-User-Email";

/**
 * Identity, not authentication (AGENTS.md → Identity model). Normalizes X-User-Email,
 * auto-registers it in the Registry, and exposes `identity`, `registry`, and the caller's
 * own per-user DO stub `user` on the context.
 */
export const requireIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const email = normalizeEmail(c.req.header(USER_EMAIL_HEADER));
  if (!email) {
    return c.json<ErrorResponse>(
      { error: `${USER_EMAIL_HEADER} header is missing or malformed` },
      400,
    );
  }
  const registry = getRegistry(c.env);
  c.set("identity", await registry.ensureUser(email));
  c.set("registry", registry);
  c.set("user", getUserDO(c.env, email));
  await next();
});
