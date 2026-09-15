import {
  type PreferencesResponse,
  PreferencesResponseSchema,
  UpdatePreferencesBodySchema,
} from "@media-digest/shared";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "../env";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

/**
 * The caller's own chat preferences (docs/PRD.md §4.5): rules that reach chat answers only, never a
 * shared summary. They live in the caller's User DO, so a preference is private by construction and
 * no route needs to say so. How a reader's own column is set — type, size, theme — is not here: that
 * is a fact about a browser, kept in that browser (docs/specs/design-phase.md §4.7).
 */
export const preferenceRoutes = new Hono<AppEnv>()
  .get(
    "/",
    describeRoute({
      tags: ["preferences"],
      summary: "The caller's chat preferences",
      description:
        "`systemRules` is empty and `updatedAt` null until they are first saved.",
      responses: {
        200: jsonResponse(PreferencesResponseSchema, "The preferences."),
        ...errorResponses(),
      },
    }),
    async (c) =>
      c.json<PreferencesResponse>({
        preferences: await c.var.user.getPreferences(),
      }),
  )

  .put(
    "/",
    describeRoute({
      tags: ["preferences"],
      summary: "Replace the caller's chat preferences",
      description:
        "`systemRules` is trimmed; an empty string clears the rules. At most 4000 characters, because they are pasted into every chat prompt verbatim.",
      responses: {
        200: jsonResponse(PreferencesResponseSchema, "The saved preferences."),
        ...errorResponses(),
      },
    }),
    validate("json", UpdatePreferencesBodySchema),
    async (c) =>
      c.json<PreferencesResponse>({
        preferences: await c.var.user.setPreferences(
          c.req.valid("json").systemRules,
        ),
      }),
  );
