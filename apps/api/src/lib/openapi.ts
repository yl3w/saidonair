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
import { USER_EMAIL_HEADER } from "../middleware/user";

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
 * or the input invalid. Owner-only operations add 403; lookups add 404; state rules add 409 with
 * the rule spelled out.
 */
export function errorResponses(
  options: { owner?: boolean; notFound?: boolean; conflict?: string } = {},
): Responses {
  const responses: Responses = {
    400: jsonResponse(
      ErrorResponseSchema,
      "`X-User-Email` missing or malformed, or invalid input (`INVALID_INPUT`).",
    ),
  };
  if (options.owner) {
    responses[403] = jsonResponse(
      ErrorResponseSchema,
      "The caller is not the owner (`NOT_OWNER`).",
    );
  }
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
  return responses;
}

const documentation: GenerateSpecOptions["documentation"] = {
  openapi: "3.1.0",
  info: {
    title: "Media Digest API",
    version: pkg.version,
    description: [
      "A personal, multi-user tool with an owner-managed catalog of YouTube channels. Each episode",
      "is summarized once and shared; follows, read receipts, and chats are per user.",
      "",
      "**Identity, not authentication.** Every request except `/health`, `/openapi.json`, and `/docs`",
      "carries `X-User-Email`. Unknown emails are registered on first use. The owner is whoever holds",
      "the `owner` role; owner-only operations answer 403 to everyone else.",
      "",
      "**Entities, not roles.** The owner receives the same representations as everyone plus a",
      "`management` block on channels, and `?scope=all` widens a collection to everything the system holds.",
    ].join("\n"),
  },
  tags: [
    { name: "health", description: "Liveness. Public." },
    { name: "me", description: "Who the caller is." },
    {
      name: "catalog",
      description: "The shared catalog's aggregate state (owner).",
    },
    {
      name: "channels",
      description:
        "Catalog channels: everyone reads the requested and approved ones; the owner reads every status and reviews them.",
    },
    {
      name: "episodes",
      description:
        "Episodes of a channel. Followers and the owner receive the shared summaries.",
    },
    {
      name: "ingestion-runs",
      description: "Per-channel ingestion history (owner).",
    },
    { name: "follows", description: "The caller's follows." },
    {
      name: "digest",
      description:
        "The caller's digest of new summaries from eligible follows.",
    },
  ],
  components: {
    securitySchemes: {
      userEmail: {
        type: "apiKey",
        in: "header",
        name: USER_EMAIL_HEADER,
        description:
          "The caller's email. Trimmed and lowercased; unknown emails are registered as `user`. This identifies, it does not authenticate.",
      },
    },
  },
  security: [{ userEmail: [] }],
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
