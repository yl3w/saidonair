import {
  type ErrorResponse,
  SessionExchangeBodySchema,
  type SessionExchangeResponse,
  SessionExchangeResponseSchema,
  SessionStartQuerySchema,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { configuredProviders, makeAuth } from "../lib/auth";
import {
  DEFAULT_WEB_ORIGINS,
  isAllowedOrigin,
  parseOrigins,
} from "../lib/cors";
import { consumeCode, mintCode } from "../lib/handoff";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

/**
 * The three routes that carry a session from this origin to the web's (docs/specs/auth-phase.md
 * §4.5). All three are public: they are how a caller obtains a token, so none can require one.
 *
 * `better-auth` owns `/auth/*`; these are ours, under `/session/` so nothing we add can ever
 * collide with a path the library introduces later.
 */
export const sessionRoutes = new Hono<AppEnv>()
  .get(
    "/start",
    describeRoute({
      tags: ["session"],
      summary: "Begin a sign-in",
      description:
        "Starts the provider flow and redirects to it. This must be a top-level navigation rather than a fetch: better-auth sets a `SameSite=Lax` state cookie here, and a cookie set cross-site is refused, so a sign-in begun from the web's own origin works locally and fails deployed (A4, 2026-09-20).",
      security: [],
      responses: {
        302: { description: "To the provider's consent screen." },
        ...errorResponses(),
      },
    }),
    validate("query", SessionStartQuerySchema),
    async (c) => {
      const { provider, next } = c.req.valid("query");
      if (!allowed(c, next)) return refuse(c, "next is not an allowed origin");
      if (!configuredProviders(c.env).includes(provider)) {
        return refuse(c, `${provider} is not configured in this environment`);
      }

      const auth = makeAuth(c.env);
      const callbackURL = `/session/handoff?next=${encodeURIComponent(next)}`;
      const started = await auth.handler(
        new Request(`${base(c)}/auth/sign-in/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, callbackURL }),
        }),
      );
      // Defensive: a provider that answers badly is this API's 400, never an unhandled 500.
      const body = started.ok
        ? ((await started.json().catch(() => ({}))) as { url?: string })
        : {};
      if (!body.url) return refuse(c, `${provider} did not start a sign-in`);
      // The state cookie the callback will check rides on this redirect, first-party to this API.
      const redirect = new Response(null, {
        status: 302,
        headers: { Location: body.url },
      });
      for (const cookie of started.headers.getSetCookie()) {
        redirect.headers.append("Set-Cookie", cookie);
      }
      return redirect;
    },
  )
  .get(
    "/handoff",
    describeRoute({
      tags: ["session"],
      summary: "Hand the session to the web",
      description:
        "Where the provider callback lands the reader. Reads the session cookie better-auth has just set — same origin, so it is sent — mints a single-use code good for sixty seconds, and redirects to the web with it in the URL fragment, which is never sent to a server and never appears in a `Referer`.",
      security: [],
      responses: {
        302: { description: "To the web, with `#code=…`." },
        ...errorResponses(),
      },
    }),
    async (c) => {
      const next = c.req.query("next") ?? "";
      if (!allowed(c, next)) return refuse(c, "next is not an allowed origin");

      const session = await makeAuth(c.env).api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) return unauthenticated(c);

      const code = await mintCode(
        c.env.AUTH_DB,
        session.session.token,
        Date.now(),
      );
      return c.redirect(`${next}#code=${code}`, 302);
    },
  )
  .post(
    "/exchange",
    describeRoute({
      tags: ["session"],
      summary: "Exchange a code for the session",
      description:
        "Spends the code and answers the session token, which is returned here and nowhere else. A code works once; an expired, unknown or already-spent one is the same `401`, so nothing can be learned by trying.",
      security: [],
      responses: {
        200: jsonResponse(SessionExchangeResponseSchema, "The session."),
        ...errorResponses(),
      },
    }),
    validate("json", SessionExchangeBodySchema),
    async (c) => {
      const token = await consumeCode(
        c.env.AUTH_DB,
        c.req.valid("json").code,
        Date.now(),
      );
      if (!token) return unauthenticated(c);

      const session = await makeAuth(c.env).api.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      });
      if (!session) return unauthenticated(c);

      return c.json<SessionExchangeResponse>({
        token,
        expiresAt: new Date(session.session.expiresAt).getTime(),
        userId: session.user.id,
        email: session.user.email ?? null,
      });
    },
  );

/** Where this Worker answers, which the provider redirect and the callback are built from. */
function base(c: { env: { API_BASE_URL?: string }; req: { url: string } }) {
  return c.env.API_BASE_URL ?? new URL(c.req.url).origin;
}

/**
 * The open-redirect guard. A handoff sends a credential-bearing URL somewhere, so where it may be
 * sent is the same list CORS admits — read through the same parser, never a second copy.
 */
function allowed(c: { env: { WEB_ORIGINS?: string } }, next: string): boolean {
  let origin: string;
  try {
    origin = new URL(next).origin;
  } catch {
    return false;
  }
  return isAllowedOrigin(
    origin,
    parseOrigins(c.env.WEB_ORIGINS ?? DEFAULT_WEB_ORIGINS),
  );
}

function refuse(c: Context<AppEnv>, error: string) {
  return c.json<ErrorResponse, 400>({ error, code: "INVALID_INPUT" }, 400);
}

/** One answer for expired, unknown and already-spent, so nothing is learned by trying. */
function unauthenticated(c: Context<AppEnv>) {
  return c.json<ErrorResponse, 401>(
    { error: "the code is expired, unknown, or already used" },
    401,
  );
}
