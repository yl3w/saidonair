import { ErrorResponseSchema } from "@media-digest/shared";
import type { Hono } from "hono";
import {
  type DescribeRouteOptions,
  type GenerateSpecOptions,
  generateSpecs,
  resolver,
} from "hono-openapi";
import type { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import type { AppEnv } from "../env";

/**
 * The OpenAPI document's fixed parts and the helpers route files use in `describeRoute`, so every
 * operation reads the same way in `/docs`: one entity tag, a success body from the shared schema,
 * and the error responses the handler can actually produce, all in the `ErrorResponse` shape.
 */

type Responses = NonNullable<DescribeRouteOptions["responses"]>;

/** A JSON success (or error) response entry from a shared schema. */
export function jsonResponse(
  schema: z.ZodType,
  description: string,
): Responses[string] {
  return {
    description,
    content: { "application/json": { schema: resolver(schema) } },
  };
}

/**
 * The error responses an operation can produce. 400 is always possible: the header may be missing
 * or the input invalid. Lookups add 404; state rules add 409 with the rule spelled out; operations
 * that call YouTube add 502. There is no 403: the API enforces no authorization (docs/PRD.md §9).
 */
export function errorResponses(
  options: { notFound?: boolean; conflict?: string; upstream?: boolean } = {},
): Responses {
  const responses: Responses = {
    400: jsonResponse(ErrorResponseSchema, "Invalid input (`INVALID_INPUT`)."),
  };
  if (options.notFound) {
    responses[404] = jsonResponse(
      ErrorResponseSchema,
      "No such resource, or one the caller may not see (`NOT_FOUND`).",
    );
  }
  if (options.conflict) {
    responses[409] = jsonResponse(
      ErrorResponseSchema,
      `${options.conflict} (\`INVALID_STATE\`).`,
    );
  }
  if (options.upstream) {
    responses[502] = jsonResponse(
      ErrorResponseSchema,
      "YouTube did not answer usably (`UPSTREAM_UNAVAILABLE`).",
    );
  }
  return responses;
}

const documentation: GenerateSpecOptions["documentation"] = {
  openapi: "3.1.0",
  info: {
    title: "Said on Air API",
    version: pkg.version,
    description: [
      "Said on Air is a personal tool for a small, trusted set of users: what was said on the air, in",
      "text, with the minute it was said. One shared catalog of YouTube channels, added by anyone and",
      "approved by the owner; each episode is transcribed, summarized, and vectorized once and shared,",
      "while follows, read receipts, and chats stay per user.",
      "",
      "**Identity, not authentication.** Every request except `/health`, `/openapi.json`, and `/docs`",
      "carries the session token as `Authorization: Bearer`. An unknown account is registered on first sign-in.",
      "`GET /me` reports the caller's role so the web can decide what to offer; the API itself enforces",
      "no authorization and accepts every operation from any identity.",
      "",
      "**Entities, not roles.** Resources are the system's nouns: channels, episodes, runs, follows, the",
      "digest, the catalog. `?scope=all` widens a collection to everything the system holds, and a",
      "channel's `management` block carries the fields the owner screens show.",
    ].join("\n"),
  },
  tags: [
    { name: "health", description: "Liveness. Public." },
    {
      name: "session",
      description:
        "Signing in and carrying the session to the web. Public: these are how a caller obtains a token, so none of them can require one.",
    },
    { name: "me", description: "Who the caller is." },
    {
      name: "catalog",
      description: "The shared catalog's aggregate state.",
    },
    {
      name: "channels",
      description:
        "Catalog channels: the requested and approved ones by default, every status with `?scope=all`, and the review, pause, and resume actions.",
    },
    {
      name: "episodes",
      description:
        "Episodes of a channel with their shared summaries and processing detail, and the retry and skip actions.",
    },
    {
      name: "runs",
      description:
        "A channel's RSS discovery runs: when its feed was checked and what was found.",
    },
    { name: "follows", description: "The caller's follows." },
    {
      name: "digest",
      description:
        "The caller's digest of new summaries from eligible follows.",
    },
    {
      name: "chats",
      description:
        "The caller's own conversations. Every question searches the channels they currently follow, or the one episode it was scoped to.",
    },
    {
      name: "preferences",
      description: "The caller's own rules for chat answers.",
    },
  ],
  components: {
    securitySchemes: {
      session: {
        type: "http",
        scheme: "bearer",
        description:
          "The session token from `POST /session/exchange`, after signing in through `GET /session/start`. Obtained once and sent on every request; there is no other way in.",
      },
    },
  },
  security: [{ session: [] }],
};

/**
 * The document is generated from the app's routes, which do not change at runtime, so one isolate
 * computes it once. hono-openapi's default 400 entry is off: the validator hook answers in this
 * API's `ErrorResponse` shape, which `errorResponses()` documents instead.
 */
let cached: ReturnType<typeof generateSpecs> | undefined;
export function openApiDocument(app: Hono<AppEnv>) {
  cached ??= generateSpecs(app, {
    documentation,
    defaultValidationErrorResponse: false,
  });
  return cached;
}
