import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "../env";

/**
 * The browser test client, and this API's one HTML response: the owner's exception to "JSON
 * everywhere", 2026-09-07 (docs/specs/api-reference.md §2). Scalar renders `/openapi.json` with a
 * try-it panel whose auth field sends the session as a bearer token. The script comes from jsDelivr pinned to one
 * version and Scalar's request proxy is off, so nothing leaves the browser except calls to this API.
 */

/** Pinned so nothing upgrades under us. Bump deliberately, after a look at Scalar's release notes. */
export const SCALAR_CDN =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0";

export const docsPage = Scalar<AppEnv>({
  url: "/openapi.json",
  cdn: SCALAR_CDN,
  // Empty on purpose: the default would route try-it requests through proxy.scalar.com.
  proxyUrl: "",
  pageTitle: "Said on Air API",
  // The email is an identity, not a secret; keeping it across reloads is the point.
  persistAuth: true,
  hideClientButton: true,
  authentication: { preferredSecurityScheme: "userEmail" },
});
