import type { ErrorResponse } from "@media-digest/shared";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

/**
 * Authorization, after `requireIdentity` has established who is asking (docs/PRD.md §2, rewritten
 * 2026-09-20). It guards the catalog operations only: approve, decline, pause, resume, Start,
 * episode retry, episode skip.
 *
 * Until this chunk the API enforced none of this and the web's rendering was the only gate (owner
 * decision 2026-09-12, reversed). Authentication alone did not close it: a stranger with a valid
 * Google account has a valid session, and could approve channels with it. Knowing who someone is
 * and deciding what they may do are different questions, and this answers the second.
 *
 * Reading is deliberately untouched. Every caller still sees the whole catalog, every channel's
 * management facts and every follower list — that is §7's design, not an oversight.
 */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.identity.role !== "owner") {
    return c.json<ErrorResponse>(
      {
        error: "only the owner may manage the catalog",
        code: "FORBIDDEN",
      },
      403,
    );
  }
  await next();
});
