import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { USER_EMAIL_HEADER } from "../middleware/user";

/**
 * Browser clients live on another origin: the Pages web app, or Vite locally. Which origins may
 * call the API comes from `WEB_ORIGINS` (wrangler.jsonc `vars`, overridable in `.dev.vars`), a
 * comma-separated list where `scheme://*.host` matches any subdomain, for Pages previews. There are
 * no cookies and no authentication, so this is hygiene rather than a guard (docs/PRD.md §2).
 */

/** What an unset `WEB_ORIGINS` means: the local Vite dev server, both spellings. */
export const DEFAULT_WEB_ORIGINS =
  "http://localhost:5173,http://127.0.0.1:5173";

/** Splits the configured list; trims, drops empties and trailing slashes. */
export function parseOrigins(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry.length > 0);
}

export function isAllowedOrigin(
  origin: string,
  allowed: readonly string[],
): boolean {
  if (origin.length === 0) return false;
  return allowed.some(
    (entry) => entry === origin || matchesWildcard(origin, entry),
  );
}

/** `https://*.example.pages.dev` matches `https://abc.example.pages.dev`, not the bare host or another scheme. */
function matchesWildcard(origin: string, entry: string): boolean {
  const marker = entry.indexOf("://*.");
  if (marker === -1) return false;
  const scheme = entry.slice(0, marker + 3);
  const suffix = entry.slice(marker + 4);
  if (!origin.startsWith(scheme) || !origin.endsWith(suffix)) return false;
  const label = origin.slice(scheme.length, origin.length - suffix.length);
  return label.length > 0 && !/[/:]/.test(label);
}

/** Registered first so preflights never reach the identity middleware. Bindings arrive per request. */
export const corsMiddleware: MiddlewareHandler<AppEnv> =
  createMiddleware<AppEnv>((c, next) => {
    const allowed = parseOrigins(c.env.WEB_ORIGINS ?? DEFAULT_WEB_ORIGINS);
    return cors({
      origin: (origin) => (isAllowedOrigin(origin, allowed) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", USER_EMAIL_HEADER],
      maxAge: 86_400,
    })(c, next);
  });
