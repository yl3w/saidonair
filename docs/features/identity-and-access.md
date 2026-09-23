# Identity and access

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and actors

Visitors can browse public content. A verified session adds a reader's follows,
digest, receipts, chats, and account preferences. The owner role adds catalog
management. The browser's role controls presentation; API middleware enforces
permission independently.

## Current flow

1. `/sign-in` renders a **Continue with Google** link. It navigates to
   `GET /session/start?provider=google&next=...`; it does not start OAuth with a
   cross-origin fetch.
2. The API validates the destination origin and provider credentials, then uses
   `better-auth` to start the provider redirect flow. `/auth/*` belongs to that
   library. The API supports configured Google and Facebook providers.
3. `GET /session/handoff` reads the authenticated session and writes a single-use
   code into the auth D1 database's verification table. The code expires after
   60 seconds and travels to the web callback in a URL fragment.
4. `/auth/callback` reads and removes the fragment and query, then exchanges the
   code through `POST /session/exchange`. Consumption uses one delete-and-return
   database statement, so a code cannot succeed twice.
5. The browser stores the returned token and email in
   `localStorage["media-digest:session"]`. The tab binds that token to its API
   client and resolves its current identity/role through `GET /me`.
6. The callback returns to the validated internal destination carried through
   sign-in, defaulting to `/queue`.

Existing tabs retain their own bound session; there is no storage-event account
synchronization. Switch account attempts `POST /auth/sign-out`, clears local
session state regardless of that request's result, and navigates to `/`.

## Rules and failure cases

- Protected routes return `401 UNAUTHENTICATED` when session resolution yields no
  identity. Public content reads use optional identity: absent, rejected, or
  malformed credentials produce the anonymous representation. Auth-store failures
  are errors, not silently converted to anonymity.
- Identity resolution first matches `auth_user_id`, then attaches an unlinked
  row with the same email, otherwise creates a new `user_id`. User Durable Objects
  are addressed by that generated ID.
- Owner seeding promotes the configured email and does not demote existing owners
  if that configuration later changes.
- Nine operations require the owner: approve, decline, pause, resume, start a
  discovery run, retry an episode, skip an episode, read catalog health, and list
  a channel's followers. A signed-in non-owner receives `403 FORBIDDEN`.
- `Guard` sends signed-out readers to `/sign-in?next=...`; non-owners visiting
  Curate go to `/queue?note=owner-only`. A failed `/me` request has a retry state;
  a 400/401 from that initial resolution clears the stored session.

## Implementation map

| Responsibility | Source |
|---|---|
| Provider setup and credential availability | [auth.ts](../../apps/api/src/lib/auth.ts) |
| Redirects and exchange | [session routes](../../apps/api/src/routes/session.ts), [handoff.ts](../../apps/api/src/lib/handoff.ts) |
| Identity and role enforcement | [user middleware](../../apps/api/src/middleware/user.ts), [owner middleware](../../apps/api/src/middleware/owner.ts) |
| Registry identity linking and owner seed | [users store](../../apps/api/src/do/registry/users.ts) |
| Browser lifecycle and guards | [session.tsx](../../apps/web/src/session.tsx), [session store](../../apps/web/src/session-store.ts) |
| Sign-in and callback UI | [SignIn](../../apps/web/src/screens/SignIn.tsx), [AuthCallback](../../apps/web/src/screens/AuthCallback.tsx), [safeNextPath](../../apps/web/src/lib/next-path.ts) |

## Tests and limitations

[Session-route tests](../../apps/api/test/routes-session.test.ts),
[identity tests](../../apps/api/test/me.test.ts),
[authorization tests](../../apps/api/test/authorization.test.ts), and
[isolation tests](../../apps/api/test/isolation.test.ts) cover handoff, identity,
role checks, and private storage boundaries. They do not establish live provider
configuration or a deployed OAuth round trip.

The sign-in UI is hardcoded to Google; server support for Facebook does not add a
button. Sign-out's server revocation is best effort. The no-email provider adapter
synthesizes an `@no-email.invalid` address, and middleware forwards the auth email
to the Registry without stripping that placeholder; nullable Registry fields do
not by themselves prove an addressless account remains null end to end.

## PRD differences

[PRD §1, §2, and §7](../../docs/PRD.md) contain both earlier identity assumptions
and later decisions. Authentication is implemented despite its remaining in the
non-goals list. The screen does not dynamically render one button per configured
provider. The callback preserves a safe destination rather than always choosing
Queue. Descriptions of owner actions as merely UI restrictions are superseded by
the middleware described above.
