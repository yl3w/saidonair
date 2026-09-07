import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { DomainError } from "../lib/errors";

export function isOwner(c: Context<AppEnv>): boolean {
  return c.var.identity.role === "owner";
}

/**
 * Throws `NOT_OWNER` (403) unless the caller is the owner and returns their email for the Registry
 * call. A convenience for an early, clear refusal: every owner-only Registry method re-checks the
 * role itself, so this is never the only guard. Used inline where one handler serves both roles
 * (`?scope=all`) and as `requireOwner` on owner-only routes.
 */
export function assertOwner(c: Context<AppEnv>): string {
  if (!isOwner(c)) throw new DomainError("NOT_OWNER", "owner only");
  return c.var.identity.email;
}

export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  assertOwner(c);
  await next();
});
