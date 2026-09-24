# API reference and browser test client

**Status:** Current v1 guide, refreshed 2026-09-23 against the source.
**History:** The original API-reference implementation and its
[plan](api-reference-plan.md) were completed in September 2026. That plan records
the earlier email-header contract and is a historical implementation record.
Subsequent authentication, route-visibility, and public-reading phases changed
the running contract. The [PRD](../PRD.md) owns goals and context; the
[feature documents](../features/v1/README.md) own implemented behavior.

## 1. Summary

The API generates OpenAPI 3.1 at `GET /openapi.json` from its Hono route
descriptions and shared Zod schemas. `GET /docs` serves a Scalar browser client.
Both are public. The generated document and the registered routes are the current
endpoint contract; this guide explains the cross-cutting rules and where to find
each owner. It does not maintain another route or response-shape inventory.

## 2. Decisions and authority

- API resources follow product entities rather than roles. Owner operations remain
  under those entities and are protected by owner middleware.
- HTTP request and response shapes are declared in
  [shared schemas](../../packages/shared/src/index.ts). API routes validate
  requests against them; the web imports the types.
- Each route's `describeRoute` call owns its tag, success schema, errors, and
  security override. [OpenAPI generation](../../apps/api/src/lib/openapi.ts)
  supplies the fixed document information and shared response helpers.
- [Identity and access](../features/v1/identity-and-access.md) owns sessions and
  permission rules; [Public browsing](../features/v1/public-browsing-and-sharing.md)
  owns anonymous visibility. Other [feature pages](../features/v1/README.md)
  own the behavior of their routes.

The 2026-09-12 decision to trust `X-User-Email` and accept owner actions from any
caller was superseded by the Auth and route-visibility phases. The header is not
an identity mechanism in v1.

## 3. Resource contract

[Route registration](../../apps/api/src/index.ts) controls which middleware
applies. The API exposes health, session, catalog, channel, episode, follow,
digest, chat, and preference resources. The registered operations are pinned by
[OpenAPI tests](../../apps/api/test/openapi.test.ts); the live generated document
is available at `/openapi.json`. `GET /docs` renders it.

### 3.3 Route ownership

| Resource | Owning feature |
|---|---|
| `/session/*`, `/me`, `/auth/*` | [Identity and access](../features/v1/identity-and-access.md) |
| `/catalog`, channel management and follower lists | [Owner curation](../features/v1/owner-curation-and-catalog-health.md) |
| Channel browse, detail, and requests | [Channel catalog](../features/v1/channel-catalog-and-requests.md) and [public browsing](../features/v1/public-browsing-and-sharing.md) |
| Discovery runs and episode attempts | [Discovery](../features/v1/episode-discovery.md) and [processing](../features/v1/episode-processing-and-recovery.md) |
| Summaries and episode reads | [Publication](../features/v1/summary-generation-and-publication.md) and [reading](../features/v1/summary-reading-experience.md) |
| `/follows`, `/digest`, read receipts | [Eligibility](../features/v1/follows-and-content-eligibility.md) and [personal digest](../features/v1/personal-digest-queue-and-history.md) |
| `/chats`, chat messages, `/preferences` | [Chat](../features/v1/chat-and-grounded-answers.md) and [reader preferences](../features/v1/reader-preferences.md) |

`/auth/*` is owned by better-auth and deliberately hidden from the generated API
document. `/openapi.json` and `/docs` are also hidden from that document. The
remaining registered operations are compared with the generated document in
`openapi.test.ts`.

## 4. Identity and visibility

The declared OpenAPI security scheme is HTTP bearer named `session`. A browser
begins sign-in by navigating to `GET /session/start`, receives a one-time handoff
code, and exchanges it through `POST /session/exchange`. Subsequent protected
requests send `Authorization: Bearer <token>`. A missing or rejected session on a
protected route answers `401 UNAUTHENTICATED`. There is no email-header fallback.

`/health`, the three `/session/*` operations, and five content reads are public.
Those five reads are `GET /channels`, `GET /channels/{id}`,
`GET /channels/{id}/episodes`,
`GET /channels/{id}/episodes/{episodeId}`, and `GET /episodes/{episodeId}`.
An absent, malformed, or rejected token on them yields the anonymous
representation. `management`, `processing`, and personal read state are omitted;
the public response is not a full signed-in response. The five operations have
`security: []` and no `401` response in the generated document. The session
operations and health also have `security: []`.

Nine operations require the owner. They are approve, decline, pause, resume,
start a discovery run, retry, skip, `GET /catalog`, and
`GET /channels/{id}/followers`. A signed-in non-owner receives
`403 FORBIDDEN` without an owner write. The exact operation list and its
OpenAPI `403` entries are pinned by [authorization](../../apps/api/test/authorization.test.ts)
and [OpenAPI](../../apps/api/test/openapi.test.ts) tests. Public channel reads
remain open regardless of this owner boundary.

## 5. Shared schemas and representation

The [shared package](../../packages/shared/src/index.ts) defines every HTTP
request and response shape, including the bearer-era error codes and optional
fields on anonymous content reads. `hono-openapi` draws component schemas from
those declarations. The [channel](../../apps/api/src/lib/channel-view.ts) and
[episode](../../apps/api/src/lib/episode-view.ts) projections choose what the
caller may see. The [API reference page](../../apps/api/src/routes/docs.ts) uses
the generated document; it does not keep a separate schema copy.

### 5.11 Removed members

The 2026-09-12 restart removed earlier request entities, per-run episode outcomes,
and stored episode waiting codes. Later phases replaced email-header identity with
session security, added `UNAUTHENTICATED` and `FORBIDDEN`, and made channel
`management`, episode `processing`, and personal `read` fields conditional on a
session. Refer to the shared schema and the route-visibility tests for the exact
current types; historical type sketches in the original plan do not describe v1.

## 6. Validation and errors

[Validation](../../apps/api/src/lib/validation.ts) reports the first Zod issue as
`400 INVALID_INPUT` with its field path. [Error middleware](../../apps/api/src/middleware/errors.ts)
maps domain codes to HTTP: `UNAUTHENTICATED` → 401, `FORBIDDEN` → 403,
`INVALID_INPUT` → 400, `NOT_FOUND` → 404, `INVALID_STATE` → 409, and
`UPSTREAM_UNAVAILABLE` → 502. Malformed JSON is a 400. A no-body action can
accept an empty request without JSON content type. The
[validation tests](../../apps/api/test/validation.test.ts) pin representative
cases, including the distinction between missing session and invalid input.

## 7. The `/docs` page

[Scalar configuration](../../apps/api/src/routes/docs.ts) pins a jsDelivr CDN
version, disables Scalar's request proxy, and points the browser client at
`/openapi.json`. The generated document declares the `session` bearer scheme.

Scalar selects the `session` bearer scheme and does not persist its token across
page reloads. The generated document's introduction describes the public reads,
session requirement, and owner-only boundary. The OpenAPI tests verify the
generated document and served HTML configuration; they do not prove that a
signed-in try-it request succeeds in a browser.

## 8. Relationship to implementation plans

The [original API-reference plan](api-reference-plan.md) records the route and
schema restart of 2026-09-12. The [Auth phase](auth-phase.md) and
[route-visibility phase](route-visibility.md) record later changes. Plans are
historical evidence, and any older curl command using `X-User-Email` should be
translated to the current session flow above.

## 9. Out of scope

This guide does not replace the generated OpenAPI response shapes, runtime
integration tests, the feature documents, or live browser verification of Scalar
sign-in. New route details belong with the owning feature and the route schema.

## 10. Verification

[OpenAPI tests](../../apps/api/test/openapi.test.ts) compare the generated paths
to registered routes, assert the `session` bearer scheme and exact owner-only
`403` set, and check that success bodies reference shared component schemas.
[Route tests](../../apps/api/test/) cover specific responses. Workers fakes and
Node-rendered web tests do not verify deployed resources or the live OAuth flow.
Follow the [repository check](../../AGENTS.md#commands) before finishing a change.

## 11. Maintenance

When a route changes, update its shared schema, handler, OpenAPI description, and
owning feature document together. Recheck route visibility, authentication, and
owner authorization in the generated document. If an old plan contradicts the
running implementation, leave it as history and link readers to this guide.
