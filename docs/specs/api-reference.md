# Feature spec — API reference and browser test client

**Written:** 2026-09-07, against commit `82a4557`.
**Status:** implemented 2026-09-07 on branch `feat/api-reference`, dependencies in §4 approved by the owner the same
day. `pnpm check` green (21 test files, 100 tests). The `curl` leg of §9.6 is recorded in the plan; the browser leg is
the owner's to run.
**Owner decisions already made (2026-09-07):** code-first (the document is generated from the code, never
hand-written), and the test client is served by the API itself as the one exception to "JSON everywhere, no API HTML".

## 1. Summary

The API gets a machine-readable description of itself and a page to exercise it from a browser:

- `GET /openapi.json` — an OpenAPI 3.1 document generated at request time from the route definitions and their
  validation schemas. Public, JSON.
- `GET /docs` — Scalar's API Reference, which renders that document and includes a "try it" client. Public, HTML.
  This is the only non-JSON response the API serves.

Request and response shapes move from hand-written TypeScript types to Zod schemas in `packages/shared`; the types
are inferred from the schemas and keep their names, so `apps/web` and the route handlers compile unchanged. Request
validation moves from the hand-rolled helpers in `lib/body.ts` to the same schemas, so what the document says the API
accepts is what the API checks.

## 2. Decisions this spec makes

| The ask | Decision | Why |
|---|---|---|
| "Document the API spec" | **Generate it from code** with `hono-openapi`: each handler carries `describeRoute` (responses, summary, tags) and `validator` (body, query, params) middleware built on Zod schemas. | A hand-written document drifts the day a field changes. The handlers already return `c.json<SomeResponse>()`, so tying the schemas to those same types makes the compiler the drift guard. |
| Where the schemas live | **`packages/shared`**, as `XSchema` values with `export type X = z.infer<typeof XSchema>` beside each. Every existing type name survives. | Shared is already "API request/response shapes". The web app imports types only (`verbatimModuleSyntax` forces `import type`), so Zod never enters the web bundle and the web's approved dependency list is untouched. |
| "Available via the browser" | **Served by the API at `/docs`.** Owner-granted exception to "JSON everywhere, no API HTML", limited to this one route. | Same origin as the API, so the client needs no CORS, and it deploys with the Worker it documents. |
| "Browser based test client" | **Scalar API Reference** via `@scalar/hono-api-reference`. The page loads Scalar's script from jsDelivr **pinned to one version**, with Scalar's proxy disabled. | Scalar has the best try-it client of the self-hostable options and is what Hono's own docs pair with `hono-openapi`. Pinning avoids surprise upgrades. With the proxy off, request data goes only to this API. |
| Third-party script | Accepted for this developer page. The alternative, self-hosting the 3.5 MB bundle through Workers Static Assets with a copy step, is recorded in §8 and can replace the CDN later without touching anything else. | Hard rule 2 governs what the Worker calls. The browser loading a pinned, open-source script for a dev tool is a smaller footprint than a new asset pipeline. |
| Identity in the document | `X-User-Email` is declared as an `apiKey`-in-header **security scheme** named `userEmail`, applied globally. `/health`, `/openapi.json`, `/docs` declare `security: []`. | Scalar renders security schemes as an auth field and sends the header on every try-it call. It is still not authentication. |
| Validation errors | **Unchanged contract:** 400 `{ error, code: "INVALID_INPUT" }` with a message naming the field. A single hook turns schema issues into `DomainError`; malformed JSON is mapped to the same shape. | The web app's `ApiError` and every existing test rely on that shape. |
| Chat, preferences (M4) | Not documented until they exist. **Rule:** a route without `describeRoute` fails the coverage test, so M4 cannot ship undocumented routes. | Same reason the route table in `AGENTS.md` exists. |

## 3. Contract

| Method and path | Who | Response | Notes |
|---|---|---|---|
| `GET /openapi.json` | anyone, no header | `application/json`, OpenAPI 3.1 | `info.title` "Media Digest API"; `info.version` from `apps/api/package.json`; `components.securitySchemes.userEmail`; every entity route from `AGENTS.md` → API shape with its methods; component schemas named after the shared types. Generated per isolate and memoized. Excluded from its own `paths`. |
| `GET /docs` | anyone, no header | `text/html` | Scalar page. Configuration in §7. Hidden from the document. |

Document conventions, so every route reads the same way in Scalar:

- **Tags** are the entities: `me`, `catalog`, `channels`, `episodes`, `ingestion-runs`, `follows`, `digest`,
  `channel-requests`. One tag per operation.
- **Summary** is the purpose column of the `AGENTS.md` route table, shortened to one line. **Description** carries
  the who/what nuance (owner-only, `?scope=all`, follower-dependent fields, read receipts).
- **Responses:** the success status with its shared schema; `400` for every operation (missing header or invalid
  input); `403` on owner-only operations; `404` and `409` where the handler throws them. All error responses use
  `ErrorResponseSchema`; the `POST /channel-requests` 409 uses `ChannelAlreadyAvailableResponseSchema`.
- **Path parameters** are documented by `validator("param", …)`, query strings by `validator("query", …)`, bodies by
  `validator("json", …)`. Nothing is declared twice.
- Component names equal type names (`Channel`, `Episode`, `ChannelRequest`, …) through Zod 4's `.meta({ ref })`.

## 4. Dependencies (need explicit approval, AGENTS.md hard rule 1)

| Package | Version | Workspace | Kind | Why |
|---|---|---|---|---|
| `zod` | `^4.4.3` | `packages/shared`, `apps/api` | runtime | Schemas and inferred types. 4.4.3 is already in the lockfile through `@cloudflare/vitest-pool-workers`, so no new resolution. Zod 4 emits JSON Schema natively; no converter package. |
| `hono-openapi` | `^1.3.2` | `apps/api` | runtime | `describeRoute`, `validator`, `resolver`, `openAPIRouteHandler`. Peer `hono ^4.11.2` (we have 4.13.7). Brings `@hono/standard-validator` and two small Standard Schema converters. |
| `@scalar/hono-api-reference` | `^0.12.1` | `apps/api` | runtime | Renders the `/docs` HTML. Peer `hono ^4.12.5`. One dependency (`@scalar/client-side-rendering`). |

Nothing is added to `apps/web`. No dev-only tooling is added. `@hono/standard-validator` is not depended on
directly; `hono-openapi` re-exports the validator we use.

## 5. Schema conventions in `packages/shared`

- One module, `src/index.ts`, keeps the current section order. Each former `type X = {…}` becomes
  `export const XSchema = z.object({…}).meta({ ref: "X", description })` followed by
  `export type X = z.infer<typeof XSchema>`. JSDoc comments become `.describe()` on fields or the `description` in
  `.meta()`, so they appear in Scalar.
- Enum types become `z.enum([...])`; `EpisodeSummary` becomes `z.discriminatedUnion("format", [...])`;
  `T | null` becomes `.nullable()`; optional fields `.optional()`.
- Body schemas encode the current `lib/body.ts` rules: `channelId: z.string().trim().min(1)`;
  `title`/`explanation`: `z.string().trim().min(1).optional()` (empty string is treated as absent, as today);
  `initialImportCount: z.number().int().positive().optional()`.
- Query schemas: `scope: z.enum(["all"]).optional()`; `limit: z.coerce.number().int()` (range checks stay in the
  callee, as today); `since`: a string that `Date.parse` accepts, documented as `date-time`.
- Param schemas: `id` / `channelId` are non-empty strings; id *format* stays the Registry's check, so the 400 for
  `/channels/not-an-id` is unchanged.
- Registry- and User-DO-internal types in `do/*/types.ts` stay as they are. The projections in `lib/channel-view.ts`
  and `lib/episode-view.ts` are unchanged; they already return the shared types.

## 6. Validation and error mapping in `apps/api`

- `lib/validation.ts` exports `validate(target, schema)`: `hono-openapi`'s `validator` with one hook that, on
  failure, throws `DomainError("INVALID_INPUT", "<field> <issue message>")` using the first issue. Routes use
  `c.req.valid("json" | "query" | "param")` and lose their manual parsing.
- `middleware/errors.ts` additionally handles Hono's `HTTPException`: status 400 becomes
  `{ error: "body must be JSON", code: "INVALID_INPUT" }`; any other status passes through with its message. Today a
  malformed JSON body would surface as 500 once the validator is in place, so this is required, not optional.
- No-body actions (`approve`, `reject`): Hono's JSON validator reads `{}` when the request has no JSON content type
  (verified in the installed `hono` 4.13.7 source), so callers that send no body keep working. A JSON content type
  with an empty or malformed body is a 400 `INVALID_INPUT`.
- `lib/body.ts` is deleted. `middleware/user.ts` keeps its own 400 for the missing header; the document lists it
  under every operation's 400.

## 7. The `/docs` page

Scalar configuration, all explicit:

| Option | Value | Why |
|---|---|---|
| `url` | `/openapi.json` | Same origin. |
| `cdn` | `https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0` | Pinned; bump deliberately. |
| `proxyUrl` | `""` | No request leaves the browser except to this API. |
| `pageTitle` | `Media Digest API` | |
| `persistAuth` | `true` | The email survives reloads. It is an identity, not a secret. |
| `hideClientButton` | `true` | The try-it panel is enough; the standalone client adds nothing here. |
| `authentication.preferredSecurityScheme` | `userEmail` | The auth field is open on first load. |

Telemetry: Scalar's open-source build sends nothing unless an analytics plugin is loaded; none is.

## 8. Out of scope and follow-ups

- **CORS for `apps/web`.** Flagged while writing this spec: the API sent no CORS headers, so the Preact app on its own
  origin could not call it from a browser. Landed the same day, right after this feature, as `lib/cors.ts` with the
  `WEB_ORIGINS` var (AGENTS.md → Identity model). The test client itself is same-origin and never needed it.
- **Self-hosting Scalar.** If the pinned CDN script is ever unwanted: add `@scalar/api-reference` as a dev
  dependency of `apps/api`, copy `dist/browser/standalone.js` into an `assets` directory before `dev`/`deploy`, add
  `assets` to `wrangler.jsonc`, and point `cdn` at that path. The pinned pool references assets options, so tests should
  load it; verify.
- Runtime response validation, a typed `hc` client, and documenting M4 routes before they exist.

## 9. Acceptance criteria

1. `GET /openapi.json` without a header returns 200 JSON whose `openapi` starts with `3.1`, and for every route the
   Hono app registers other than `/health`, `/openapi.json`, `/docs`, and middleware, `paths[path][method]` exists
   with a success response and the shared component schema. `components.securitySchemes.userEmail` describes the
   header. Component schemas include at least `Channel`, `Episode`, `Follow`, `ChannelRequest`, `Catalog`,
   `IngestionRun`. (Zod extracts the schemas a body refers to and keeps the body's own root inline, so the
   response envelopes and `ErrorResponse` are inline, not components.)
2. `GET /docs` without a header returns 200 `text/html` containing the pinned CDN URL and `/openapi.json`.
3. Every existing test passes unchanged. Validation failures return `{ error, code: "INVALID_INPUT" }` with 400,
   including a body that is not JSON.
4. Existing route tests parse one response per shared response schema with `XSchema.parse`, proving the documented
   shapes match what the Worker returns.
5. `pnpm check` is green; `pnpm build` produces an `apps/web/dist` with no Zod code in it.
6. Under `wrangler dev`: `/docs` renders in a browser, the email field sends `X-User-Email`, `GET /me` shows the role,
   and `POST /channel-requests` with an `@handle` shows the "Copy channel ID" 400. The browser leg is the owner's; the
   agent verifies with `curl` that both routes respond as specified.
7. `AGENTS.md` carries the edits in §10.

## 10. `AGENTS.md` edits carrying the decisions

- **Stack table.** Add a row: Validation and API document — Zod 4 schemas in `packages/shared`, `hono-openapi`,
  Scalar at `/docs`.
- **Repo layout.** `packages/shared`: "Zod schemas for every API request/response shape and the types inferred from
  them". API: add `lib/validation.ts`, `lib/openapi.ts`, `routes/docs.ts`; remove `lib/body.ts`.
- **API shape.** Replace "JSON everywhere, no API HTML." with: JSON everywhere except `GET /docs`, the Scalar test
  client (owner exception, 2026-09-07). Add `GET /openapi.json` and `GET /docs` to the public routes beside `/health`.
  Add the rule that every route carries `describeRoute` and validates with the shared schemas; the coverage test
  enforces it.
- **Web UI.** Note that `apps/web` imports types only from `packages/shared`; Zod must not appear in its bundle.
- **Code style.** "Validate all external input at the boundary" gains: request input through `lib/validation.ts`
  and the shared schemas; RSS XML and AI JSON stay hand-validated.
- **Testing.** Add the coverage test and the one-parse-per-schema rule to the required coverage list.
