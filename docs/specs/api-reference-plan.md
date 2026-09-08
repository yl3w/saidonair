# Implementation plan — API reference and browser test client

**Implements:** `docs/specs/api-reference.md` (the spec) under the rules in `AGENTS.md`.
**Written:** 2026-09-07, against commit `82a4557`.
**Status:** complete 2026-09-07, five commits on `feat/api-reference`, `pnpm check` green after each (21 test files,
100 tests at the end). Plan decisions were marked **plan decision** and none were vetoed. Two edge-case changes worth
knowing from Step 2: an empty `?limit=` or `?since=` is now a 400 (it used to read as absent), and `null` for an optional
body field is now a 400 (it used to read as absent). Neither the web app nor any test sends those.
**Shape:** five steps, each one commit, each ending with `pnpm check` green. Steps 1 and 2 change no HTTP behaviour
except the error mapping in 2.3. Step 3 adds `/openapi.json`. Step 4 adds `/docs`. Step 5 is documentation. After
any step the branch can be merged and left alone.

## Definition of complete

Spec §9, all seven criteria. In short: `GET /openapi.json` and `GET /docs` are public and correct, every registered
route is described, every existing test passes with the same 400 contract, one parse assertion per response schema,
`pnpm check` green, the web bundle has no Zod, the `wrangler dev` walkthrough is recorded here, `AGENTS.md` updated.

### Step 1 — Dependencies and shared schemas  (size: M)

**Files:** `packages/shared/package.json`, `packages/shared/src/index.ts`, `apps/api/package.json`, `pnpm-lock.yaml`.

- `pnpm add zod@^4.4.3 --filter @media-digest/shared --filter @media-digest/api`;
  `pnpm add hono-openapi@^1.3.2 @scalar/hono-api-reference@^0.12.1 --filter @media-digest/api`. All three in one step
  so the lockfile changes once. `zod` resolves to the 4.4.3 already present.
- Rewrite `packages/shared/src/index.ts` per spec §5: every `type X` becomes `XSchema` plus `type X = z.infer<…>`,
  same section order, same names, JSDoc moved into `.describe()` / `.meta({ ref, description })`. Body, query, and
  param schemas are added here too (`CreateChannelBodySchema`, `ScopeQuerySchema`, `LimitQuerySchema`,
  `SinceQuerySchema`, `ChannelIdParamSchema`, `RequestIdParamSchema`), since the web app will want the body types
  and the API needs the values.
- **Plan decision:** value suffix `Schema`, bare type name for the type (`ChannelSchema` / `Channel`) rather than
  one identifier for both. Grep-able, and no reader has to know TypeScript merges the namespaces.
- **Plan decision:** `ErrorResponseSchema.code` stays `z.string().optional()`; the domain codes are documented in the
  description, not as an enum, because Registry errors that cross RPC recover their code from a message prefix.

**Tests:** none new. **Done when:** `pnpm check` passes with `apps/api` and `apps/web` untouched, proving the inferred
types are drop-in. `pnpm build` then `grep -ril zod apps/web/dist` finds nothing.

### Step 2 — Validation through the schemas  (size: M)

**Files:** `apps/api/src/lib/validation.ts` (new), `apps/api/src/middleware/errors.ts`, `apps/api/src/routes/channels.ts`,
`apps/api/src/routes/channel-requests.ts`, `apps/api/src/routes/digest.ts`, `apps/api/src/routes/follows.ts`,
`apps/api/src/lib/body.ts` (deleted), tests.

- 2.1 `lib/validation.ts`: `validate(target, schema)` wraps `hono-openapi`'s `validator` with the one hook from spec
  §6. Message format: `"<field path> <issue message>"`, e.g. `channelId is required`, from the first issue.
- 2.2 Routes: replace each `readJsonObject`/`requireString`/`optionalString`/`optionalPositiveInt`/`optionalIntQuery`/
  `parseScope`/`parseSince` use with `validate(...)` middleware and `c.req.valid(...)`. `extractChannelId` and the
  "Copy channel ID" message stay in the handler, as does every Registry-side check. `visibleChannel` reads the param
  from `c.req.valid("param")` and drops the `?? ""` fallback.
- 2.3 `middleware/errors.ts`: handle `HTTPException` before the generic branch. Status 400 becomes
  `{ error: "body must be JSON", code: "INVALID_INPUT" }`; other statuses pass through with their message.
- 2.4 Delete `lib/body.ts`. If anything outside routes imports it, stop and note it; nothing should.

**Tests:** all existing route tests pass unchanged. Add to `routes-channels.test.ts`: a `POST /channels` with
`Content-Type: application/json` and body `not json` returns 400 with `code: "INVALID_INPUT"`; a `POST` with
`{ nope: 1 }` returns 400 whose `error` names `channelId`. Add to `routes-channel-requests.test.ts`: `approve` with no
body and no content type still succeeds (the `{}` path). Extend `me.test.ts` only if the header 400 changes; it should not.

**Done when:** `pnpm check` green; `curl` under `wrangler dev` reproduces the three 400 cases above.

### Step 3 — Route descriptions and `GET /openapi.json`  (size: M)

**Files:** `apps/api/src/lib/openapi.ts` (new), every file in `apps/api/src/routes/`, `apps/api/src/index.ts`,
`apps/api/test/openapi.test.ts` (new), one parse assertion in each existing route test file.

- 3.1 `lib/openapi.ts`: small helpers so route files stay thin: `jsonResponse(schema, description)` for a success
  entry, `errorResponses({ owner, notFound, conflict })` producing the 400/403/404/409 entries with
  `ErrorResponseSchema`, and `documentation` (info, tags, `securitySchemes.userEmail`, global `security`).
  **Plan decision:** `defaultValidationErrorResponse: false` in the handler options, so the document shows our
  `{ error, code }` 400 and never `hono-openapi`'s default `{ success, error, data }` shape, which the hook replaces.
- 3.2 Add `describeRoute({ tags, summary, description, responses })` to every handler, wording from spec §3.
  Order per handler: `describeRoute`, `requireOwner` where present, `validate(...)`, handler.
- 3.3 `index.ts`: register `GET /openapi.json` before `requireIdentity`, next to `/health`, with
  `describeRoute({ hide: true })` and `openAPIRouteHandler(app, { documentation, defaultValidationErrorResponse: false })`.
  **Plan decision:** memoize the generated document per isolate in `lib/openapi.ts`; the routes do not change at
  runtime. `/health` gets `describeRoute({ security: [], … })` so it is documented as public.
- 3.4 Version: `info.version` read from `apps/api/package.json` through an `import … with { type: "json" }` under
  `resolveJsonModule`. If wrangler's bundler rejects the import attribute, fall back to a constant with a comment.

**Tests:** `openapi.test.ts` (spec §9.1): fetch `/openapi.json` with no header; assert 200, `openapi` starts `3.1`;
collect `app.routes` filtered to real methods and paths not in the public set, translate `:id` to `{id}`, and assert
each method+path exists in `paths` with a `200` or `201` response; assert `components.securitySchemes.userEmail` is an
`apiKey` in header `X-User-Email`; assert the listed component schemas exist. Parse assertions: in each route test,
after one successful call per response type, `XSchema.parse(json)` must not throw (`ChannelsResponse`,
`ChannelResponse`, `EpisodesResponse`, `IngestionRunsResponse`, `FollowsResponse`, `FollowResponse`,
`DigestResponse`, `ChannelRequestsResponse`, `ChannelRequestResponse`, `ApproveChannelRequestResponse`,
`CatalogResponse`, `MeResponse`).

**Done when:** `pnpm check` green; under `wrangler dev`, `curl -s localhost:8787/openapi.json | head` shows the document
and a bad body on `POST /channels` still returns the Step 2 shape.

### Step 4 — `GET /docs`  (size: S)

**Files:** `apps/api/src/routes/docs.ts` (new), `apps/api/src/index.ts`, `apps/api/test/openapi.test.ts`.

- `routes/docs.ts` exports the `Scalar({...})` handler with exactly the spec §7 configuration and a comment naming
  the exception and its date. `index.ts` registers `GET /docs` before `requireIdentity`, hidden from the document.
- **Plan decision:** the CDN version is a named constant beside the handler with a one-line "bump deliberately" note,
  the same pattern as the iOS client constants in the transcript contract.

**Tests:** `GET /docs` with no header returns 200, `content-type` starts `text/html`, body contains the pinned CDN URL
and `/openapi.json` (spec §9.2).

**Walkthrough (recorded below when done):** `pnpm dev`; `curl -si localhost:8787/docs | head -20`. Browser leg, owner:
open `http://127.0.0.1:8787/docs`, enter an email in the auth field, run `GET /me`, `GET /channels`, and
`POST /channel-requests` with `@veritasium`; confirm the network tab shows requests to `127.0.0.1:8787` only.

### Step 5 — Documentation  (size: S)

**Files:** `AGENTS.md`, `docs/specs/api-reference.md`, this file.

- Apply spec §10 to `AGENTS.md`, one bullet at a time, keeping the surrounding text.
- Set the spec and plan status to complete with the date; paste the walkthrough transcript below.

**Done when:** `pnpm check` green (docs only, but the gate runs before every finish).

## Walkthrough record

`pnpm dev` (wrangler dev on 127.0.0.1:8787, the developer's `.dev.vars`), 2026-09-07, with `curl`:

| Request | Result |
|---|---|
| `GET /health` (no header) | 200 `{"service":"api","status":"ok"}` |
| `GET /docs` (no header) | 200 `text/html; charset=UTF-8`, `<title>Media Digest API</title>`, one `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0">`, zero occurrences of `proxy.scalar.com` |
| `GET /openapi.json` (no header) | 200 `application/json`, 57 495 bytes, `openapi: 3.1.0`, 16 paths (`/catalog`, `/channel-requests`, `/channel-requests/{id}/approve`, `/channel-requests/{id}/reject`, `/channels`, `/channels/{id}`, `/channels/{id}/episodes`, `/channels/{id}/ingestion-runs`, `/channels/{id}/requests`, `/channels/{id}/restore`, `/channels/{id}/retry`, `/digest`, `/follows`, `/follows/{channelId}`, `/health`, `/me`), 24 component schemas, global `security: [{ userEmail: [] }]`, `/health` with `security: []`, `/docs` and `/openapi.json` absent, `POST /channels` responses 201/400/403/409 |
| `POST /channel-requests` `{"channelId":"@veritasium"}` | 400 `INVALID_INPUT: not a channel id or /channel/UC… URL; paste the channel id: … Copy channel ID` |
| `POST /channel-requests`, body `not json` | 400 `INVALID_INPUT: body must be JSON` |
| `POST /channel-requests` `{}` | 400 `INVALID_INPUT: channelId Invalid input: expected string, received undefined` |
| `GET /channels?scope=bogus` | 400 `INVALID_INPUT: scope Invalid input: expected "all"` |
| `GET /digest?since=yesterday` | 400 `INVALID_INPUT: since must be an ISO 8601 timestamp` |
| `GET /me` (no header) | 400 `X-User-Email header is missing or malformed` |

Owner-only routes answered 403 `NOT_OWNER` to the probe email before validation ran, because the local `.dev.vars`
owner is not the test email and `requireOwner` precedes `validate`, as planned.

**Browser leg (owner):** open `http://127.0.0.1:8787/docs`, enter an email in the auth field, run `GET /me`,
`GET /channels`, and `POST /channel-requests` with `@veritasium`; the network tab should show requests to
`127.0.0.1:8787` only.
