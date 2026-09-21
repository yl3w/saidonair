import type { ErrorResponse } from "@media-digest/shared";
import { createMiddleware } from "hono/factory";
import { getRegistry } from "../do/registry";
import type { RegistryUser } from "../do/registry/types";
import { getUserDO } from "../do/user";
import type { AppEnv, Env, PublicEnv } from "../env";
import { makeAuth } from "../lib/auth";

/**
 * Authentication (docs/PRD.md §2, rewritten 2026-09-20). Two middlewares over one resolution: a
 * route either requires a caller or merely accepts one, and which it is, is a decision made once
 * where the route is registered (`index.ts`).
 *
 * Until A7 the identity was `X-User-Email`, a string the caller chose — so anyone who knew the
 * address could read anyone's chats and receipts. That is what this replaced, and why PRD §8's
 * second criterion is true now rather than merely unattempted.
 */

/**
 * The bearer token resolved to a Registry identity, or null: no token, or one this API does not
 * accept. `requireIdentity` answers 401 to both, `optionalIdentity` answers the anonymous view to
 * both — a caller learns nothing from which it was, and a reader whose session quietly expired
 * should meet a public page rather than a refusal (docs/specs/route-visibility.md §4.1).
 *
 * No try/catch, deliberately. A caller's garbage already resolves to null — `me.test.ts` covers no
 * header, a token that was never minted, and a header that is not a bearer token at all — so a
 * throw here is the auth store failing, not the caller misbehaving, and that deserves a 500 rather
 * than a quiet "not signed in" on a route that would then serve a degraded body.
 */
async function resolveIdentity(
  env: Env,
  headers: Headers,
): Promise<RegistryUser | null> {
  const session = await makeAuth(env).api.getSession({ headers });
  if (!session) return null;
  return getRegistry(env).ensureIdentity(
    session.user.id,
    session.user.email ?? null,
  );
}

/**
 * Everything but the five public reads. Resolves the session, exposes `identity`, `registry` and
 * the caller's own per-user DO stub `user`, and refuses without one. A missing or invalid token
 * reaches neither Durable Object.
 */
export const requireIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await resolveIdentity(c.env, c.req.raw.headers);
  if (!identity) {
    return c.json<ErrorResponse>(
      {
        error: "sign in to use this API",
        code: "UNAUTHENTICATED",
      },
      401,
    );
  }

  c.set("identity", identity);
  c.set("registry", getRegistry(c.env));
  c.set("user", getUserDO(c.env, identity.userId));
  await next();
});

/**
 * The five public reads (docs/specs/route-visibility.md §4.1). With a valid token it does exactly
 * what `requireIdentity` does; with no token, or one this API does not accept, it continues anyway
 * with `registry` alone and `c.var.identity` undefined.
 *
 * **It never answers 401.** A route that mounts this has decided that anonymity is allowed, and the
 * handler's job is to answer less rather than to refuse.
 */
export const optionalIdentity = createMiddleware<PublicEnv>(async (c, next) => {
  c.set("registry", getRegistry(c.env));
  const identity = await resolveIdentity(c.env, c.req.raw.headers);
  if (identity) {
    c.set("identity", identity);
    c.set("user", getUserDO(c.env, identity.userId));
  }
  await next();
});
