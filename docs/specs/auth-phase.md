# Feature spec — The Auth phase: verified identity, one-time handoff, owner authorization

**Status:** written 2026-09-20, awaiting owner approval. The **Auth phase**, unnumbered, between M5 and M6
(owner decision 2026-09-20).
**PRD:** §1 (external services), §2 (users and ownership — reversed), §3 (architecture, stack), §5.1 (Registry
schema), §5.4 (migration governance), §7 (the first screen, the route table), §8, §9, §10.
**Depends on:** everything M1–M5 built, and nothing in M6. M6 is a sweep of §8 and this phase adds criteria to
that sweep rather than consuming it.
**Supersedes:** two standing decisions, both explicitly. PRD §2's *"No authentication is added, and none should
be: no login, sessions, JWTs, or Cloudflare Access"*, and the 2026-09-12 ruling that **the API enforces no
authorization** (§9, §2, `AGENTS.md` → Identity plumbing). Both were owner decisions; both are reversed here by
owner decision 2026-09-20. The unnumbered position follows the Design phase precedent (§10, decided 2026-09-14):
every `M6` reference across `docs/specs/` keeps its meaning and nothing is renumbered.

## 1. Summary

`X-User-Email` is self-asserted. Any caller who knows the API's address can send anyone else's email and read that
person's chats, messages, preferences, and read receipts out of their User DO. PRD §8's second criterion — *"users
cannot inspect another user's chats, messages, preferences, or read receipts"* — is currently true only because
nobody has tried. This phase makes it true.

Three changes, in this order:

1. **A verified session replaces the header.** `better-auth` runs inside the existing Hono Worker over its own
   Cloudflare D1 database, with Google and Meta as the sign-in providers. `requireIdentity` keeps its exact
   contract and changes one thing: where the identity comes from.
2. **The User DO is keyed by user id, not email.** The Registry's primary key becomes `user_id`; email demotes to
   a nullable, unique attribute. This is the only moment it is cheap — nothing is deployed.
3. **The API starts refusing.** Owner routes return 403 to non-owners, instead of trusting the web not to render
   the button.

The domain data model is otherwise untouched: episodes, summaries and vectors carry no user dimension and never
learn about any of this, and both crons and the Workflow call internal code rather than HTTP, so they never see a
session at all.

## 2. Why this shape

### 2.1 What authentication actually buys

Not "users expect a login". The concrete hole: the private half of the product — every chat, every read receipt,
every preference — sits in a Durable Object addressed by a string the caller chooses. `middleware/user.ts` is
honest about this in its own docstring ("Identity, not authentication"), and PRD §2 defended it on the grounds
that nothing about the product needed more. That defence held while the catalog was the interesting surface. It
stopped holding when M4 put conversations in the User DO.

The second thing it buys is that **the owner check stops being a rendering decision**. Today `Guard ownerOnly`
in `session.tsx` decides what to draw, and `AGENTS.md` records that the web is the only gate. Any caller can
approve a channel, decline one, pause it, retry an episode or skip it, with any email they like. Authentication
alone does not close that — a stranger with a valid Google account still has a valid session — which is why
authorization is in this phase and not a later one.

### 2.2 Why the re-key belongs here or nowhere

Keying the User DO by email is load-bearing in five places in `migrations/registry/0001_init.sql` and about 125
references across `apps/api/src` and `packages/shared`. Rewriting it costs one edit to `0001_init.sql` — migration
governance has been open since 2026-09-12 (§5.4), so applied migrations may be edited in place — plus a
`/clean-local` wipe. **Nothing is deployed**: staging and production Workers exist in `wrangler.jsonc` but were
never stood up, and `media-rag-staging` and `media-rag` were never created. So the entire data cost of the re-key
today is one local wipe. After the first real deployment it is a migration, a re-key of live Durable Objects, and
a coordinated cutover.

The providers chosen make it more than a tidiness argument:

- **Meta can return an account with no email at all** — phone-only signup, revoked consent, or an address Meta has
  marked invalid. better-auth documents `mapProfileToUser` as the hook for exactly this. Keyed by email, that
  person cannot be admitted. Keyed by user id, they are an ordinary user who happens to have no email.
- **Apple emits the email only on the first authorization** and offers no user-info endpoint to fetch it later. A
  returning Apple user whose email was never captured is, under email keying, a different person.
- A Google account can change its address. Under email keying that silently orphans every chat and receipt the
  person had.

### 2.3 Why a one-time code and not the token

The OAuth callback lands on the **API** origin as a top-level navigation; better-auth sets its session cookie
there, first-party. The web app is on another origin and can never read that cookie. Something must carry the
session across the boundary, and in a redirect the only vehicle is the URL.

Putting the session token in the fragment works — fragments are never sent to a server, never in a `Referer` — but
what sits there is the long-lived credential, readable by anything that runs before our `replaceState`, and
resident in session history. A leak has no blast radius: it is a live session for its full lifetime.

So the fragment carries a **single-use code with a sixty-second life**, which the web exchanges for the token over
`POST`. The long-lived credential exists only in a response body. This is not a clever trick; it is the reason
OAuth has an authorization code at all, applied to our own boundary. It costs one route and one round trip on
sign-in only, and needs no new table — better-auth's `verification` table is already
`identifier / value / expiresAt`.

**The honest limit:** both designs end with the token in `localStorage`, where XSS can read it. The code closes
the redirect leak, not the storage one. Only a first-party `HttpOnly` cookie closes that, and that needs one
origin. The owner chose bearer over two origins on 2026-09-20 with this named.

### 2.4 Why the callback is not the web app

Asked and answered 2026-09-20. Pointing the provider's `redirect_uri` at the web origin looks like it would save
the handoff. It does not, because the callback decides where the **browser lands**, not where the **session is
created** — and the session can only be created by the party holding the client secret and the database, which is
the API. The web would receive `?code=&state=`, be able to do nothing with it, and have to forward it to
better-auth's callback anyway: one redirect more than the current design, ending at the identical cookie on the
identical origin. better-auth stores `state` and the PKCE verifier server-side when sign-in starts, so the web
holds none of what validating that callback requires.

The variant that would genuinely collapse the flow — a PKCE public client exchanging the code in the browser — is
disqualified twice: Meta's token exchange wants the app secret, and it means hand-rolling OAuth instead of using
better-auth's social flow, which is more custom code in the part of the system that can least afford it.

There is also a reason to prefer the API independent of any of that. `redirect_uri` is a registered security anchor
at the provider. Aimed at the static-asset origin it delivers an authorization code to a host with no server-side
state to check it against, to be forwarded by client-side JavaScript — so any open redirect or XSS on the web
origin has a live code passing through it. The host the `redirect_uri` names should be the host that can validate
what arrives.

What removes the handoff is one origin, not a different callback. That is §8.

## 3. Decisions this spec makes

All owner decisions of 2026-09-20 unless stated.

1. **Authentication and authorization together.** Sessions replace the header, and owner routes return 403.
   Reverses the 2026-09-12 no-authorization ruling.
2. **Consumer OAuth only. No passwords, ever.** No password store, no reset mail, no email vendor, and
   `lib/email.ts` keeps its one job of normalizing.
3. **Google and Meta in this phase; Apple deferred to its own chunk.** Apple supports neither `localhost` nor
   non-HTTPS, and `CLAUDE.md` makes `wrangler dev` the gate for runtime behavior; staging's web origin is still an
   unfilled `TODO(owner)` in `wrangler.jsonc`. Apple is sequenced behind the thing that makes testing it possible,
   not dropped.
4. **The User DO and the Registry are keyed by a `user_id` the Registry generates** — `crypto.randomUUID()`, the
   same way this repo already mints run, attempt, generation, chat and message ids. better-auth's `user.id` is
   stored beside it as `auth_user_id TEXT UNIQUE`, nullable until that person first signs in.
   **This reverses the call made earlier on 2026-09-20** to use better-auth's id directly, which was declined as
   YAGNI on the assumption that we would never mint an id of our own. The phasing decided later the same day
   mints one in A2 regardless, so the comparison flipped: keeping it costs one column and one lookup inside an
   RPC already being made, while replacing it costs a data migration and a second wipe — and the domain's primary
   key would have come from a library's id space.
5. **Email survives as a nullable unique attribute** *in the Registry*. SQLite permits many NULLs under a UNIQUE
   index and only one row per non-null email, so the schema itself enforces one-person-one-email and still admits
   the Meta account that has none. **Amended after A0:** better-auth's own `user.email` is `not null unique` and
   cannot do this, so it holds a synthesized `…@no-email.invalid` placeholder for those accounts while the
   Registry holds null. §4.2 carries the reasoning.
6. **Accounts sharing a verified email link into one identity** (better-auth trusted-provider linking). The
   Registry's UNIQUE email is the belt-and-braces check that it worked.
7. **The session reaches the web as a one-time code in a URL fragment, exchanged for a bearer token.**
8. **The auth store is D1, separate from both Durable Objects.** ~~The wiring — `kysely` + `kysely-d1` written by
   us, or the `better-auth-cloudflare` wrapper — is decided by the A0 spike.~~ **Settled by A0, 2026-09-20:
   neither.** better-auth 1.7.5 takes the D1 binding directly, so the phase adds exactly one dependency. **A custom better-auth
   adapter over the Registry DO was raised and declined on 2026-09-20**, after an earlier objection to it was
   withdrawn as overstated: `requireIdentity` already round-trips to the Registry on every request, so a session
   lookup there would have been free, and it would have removed the binding entirely. It was declined anyway
   because it trades a documented, maintained adapter for one this repo would own. **A0's question is therefore
   not widened** — it decides the D1 wiring, not the store. Hand-rolling OAuth on Registry sessions was raised in
   the same conversation and declined with it: the flow is not the hard part, the accumulating provider quirks
   are, and those are what the library absorbs.
9. **The web uses no better-auth client library.** Sign-in is a navigation, the exchange is one `fetch`, and
   sign-out is one more; `createAuthClient` would add a dependency to `apps/web` to save perhaps thirty lines.
   `apps/web`'s dependency list is unchanged by this phase.
10. **No session-minting route exists in the Worker, in any environment.** Tests write rows into local D1 directly.
   This is a deliberate departure from the env-selected-fake precedent (`AGENTS.md` → Testing): an auth bypass that
   exists only behind a flag is still an auth bypass that shipped.

## 4. Contract

### 4.1 The auth store

A D1 database per environment, following the naming rule of §3 (`x` / `x-staging` / `x-dev`):
`media-digest-auth`, `media-digest-auth-staging`, `media-digest-auth-dev`, bound as `AUTH_DB`. Wrangler does not
inherit bindings into environments, so it is repeated in all three and `test/wrangler-config.test.ts` fails when
they drift — as it already does for every other binding.

It holds better-auth's four tables: `user`, `session`, `account`, `verification`. No domain table is added to it
and no auth table is added to either Durable Object. The two stores meet in exactly one place: `global_users.user_id`
holds the same value as better-auth's `user.id`, with no foreign key across the boundary because there cannot be one.

**Amended by the A0 spike, 2026-09-20, against better-auth 1.7.5.** The spike overturned this section's premise:

- **The D1 binding is passed directly** — `database: env.AUTH_DB`. `@better-auth/core`'s option union carries its
  own `D1Database` interface ("A Cloudflare D1-compatible database"). **There is no Kysely, no `kysely-d1`, and no
  `better-auth-cloudflare`**, so the choice A0 was convened to make does not exist and the dependency proposal is
  one package.
- **The binding exists only inside a request**, so the `auth` instance is still constructed per request rather
  than at module scope. Hono's per-request `c.env` makes this ordinary, and `getSession()` against a per-request
  instance measured 4–6 ms.
- **Transactions need no workaround.** `transaction` defaults to `false` in 1.7.5, and a live Google sign-in in
  A0 completed cleanly on D1 with no explicit flag — issue #4732 does not reproduce on this version.
- **The better-auth CLI cannot reach D1.** Schema SQL is generated once against Node's built-in `DatabaseSync`
  (also in the option union) and applied with `wrangler d1 execute --file` — which is already how this repo
  treats migrations. The generated schema is `user`, `session`, `account` and `verification`, plus indexes on
  `session.userId`, `account.userId` and `verification.identifier`.
- **Timestamps are stored as ISO 8601 strings**, not epoch milliseconds. A7's test helper must match.

`nodejs_compat` is required for better-auth's `AsyncLocalStorage` and is already set in `wrangler.jsonc`.

### 4.2 Providers

`google` and `facebook`, each a client id and secret held as per-environment secrets
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`), plus
`BETTER_AUTH_SECRET`. Both permit `http://localhost` redirect URIs, so both are exercisable under `wrangler dev`.
`trustedOrigins` is derived from the same `WEB_ORIGINS` value `lib/cors.ts` already parses — one source, parsed
once, never two lists to drift.

**A provider that returns no email, amended after A0.** better-auth's core schema declares `user.email` as
`text not null unique`, so it cannot store a user without one — the spike found this, and it contradicted what
this spec first said. The resolution (owner decision 2026-09-20): `mapProfileToUser` synthesizes
`{providerId}:{accountId}@no-email.invalid` to satisfy the constraint, while `global_users.email` stays **null**.
The Registry remains the source of truth for whether this product knows a person's address; better-auth's value is
plumbing. `.invalid` is RFC 2606's reserved TLD, so the placeholder can never collide with a real address or be
delivered to. That better-auth's `user.email` is then sometimes a fiction is inert here, because decision 2 means
nothing ever sends email.

### 4.3 Identity: the Registry re-key

Five sites in `migrations/registry/0001_init.sql`, edited in place:

| Today | Becomes |
|---|---|
| `global_users.email TEXT PRIMARY KEY` | `user_id TEXT PRIMARY KEY` (a `crypto.randomUUID()`), `email TEXT UNIQUE` (nullable), `auth_user_id TEXT UNIQUE` (nullable) |
| `channel_followers.user_email` (in the composite PK, one index, one FK) | `user_id` |
| `channels.reviewed_by_email` + its CHECK | `reviewed_by_user_id` |
| `episodes.skipped_by_email` + its CHECK | `skipped_by_user_id` |
| `episode_ingestion_attempts.requested_by_email` + its CHECK | `requested_by_user_id` |

`getUserDO(env, userId)` names the object by user id. The User DO's docstring currently says "The email is implicit
in the object's name and is never stored or logged here"; after this it is literally true, and the object holding
every chat and read receipt carries no address in its name.

The Owner screens show who reviewed or skipped something, so `lib/channel-view.ts` and `lib/episode-view.ts`
resolve the email through `global_users` rather than reading it off the row.

Precedent for the sweep itself: `videoId` → `episodeId` everywhere including SQLite columns, owner decision
2026-09-15, commit `5d67893`.

### 4.4 Owner seeding survives

An earlier draft had seeding invert — no row to promote until the owner signed in — because better-auth would have
owned the id. Generating our own removes that: `seedOwner` keeps running at DO start, minting a `user_id` for
`OWNER_EMAIL` with `role = 'owner'` and `auth_user_id` null, exactly as it inserts-or-promotes today. When that
person first signs in, the email match attaches `auth_user_id` to the row already there.

Promote-never-demote is unchanged, so changing `OWNER_EMAIL` still adds an owner rather than replacing one, and a
fresh deployment has an owner from the first request rather than from the first sign-in.

### 4.5 The handoff

better-auth owns `/auth/*` entirely (`basePath: "/auth"`), registered before any catch-all as its Hono integration
requires. Our two routes live under `/session/` so that nothing we add can ever collide with a path better-auth
introduces later.

```
web /                →  POST api/auth/sign-in/social {provider, callbackURL}   one fetch
                     ←  200 {"url":"https://accounts.google.com/...","redirect":true}
                     →  location.href = url                            top-level navigation
                     →  Google / Meta                          consent
                     →  GET  api/auth/callback/google          better-auth sets its cookie, first-party to the API
                     →  302  api/session/handoff               same origin, so the cookie is readable
                            mint code: single use, 60s, stored in better-auth's `verification` table
                     →  302  web/auth/callback#code=…          fragment: never sent to a server, never in a Referer
   web reads location.hash, history.replaceState immediately
                     →  POST api/session/exchange { code }     fetch, cross-origin, no cookies
                     ←  { token, expiresAt }                   response body only
   thereafter:          Authorization: Bearer <token>
```

**A0 established one thing and got another half wrong; A4 corrected it.** The sign-in entry is **not** a
navigable link: `POST /auth/sign-in/social` answers JSON and there is no `GET` equivalent. And the PKCE
`code_verifier` does live in the `verification` table, keyed by the state parameter.

**But starting a sign-in also sets a cookie**, which A0 missed because its probe page was same-origin with the
spike Worker and therefore could not fail:

```
Set-Cookie: better-auth.state=…; Max-Age=300; Path=/; HttpOnly; SameSite=Lax
```

The callback validates the returned `state` against that cookie, not against the table alone — a URL carrying a
perfectly valid, unexpired state fails `state_mismatch` without it (observed 2026-09-20).

**This is load-bearing for two origins.** A `fetch` from the web to the API would receive that `Set-Cookie`
cross-site, where `SameSite=Lax` without `Secure` is rejected and Safari and Firefox block third-party cookie
writes outright — so a sign-in begun by `fetch` works on localhost and fails deployed. **The fix: every
cookie-touching step happens as a top-level navigation on the API origin.** A5 therefore adds
`GET /session/start?provider=…`, which initiates sign-in server-side and `302`s to the provider, and A6's button
becomes a plain link to it rather than a `fetch`. The bearer-over-two-origins design survives; what does not
survive is starting the flow from the web's own origin.

**Confirmed by A0 end to end.** A real Google sign-in completed on D1 — `POST /auth/sign-in/social` → `302` from
`/auth/callback/google` → `user`, `account` and `session` rows written, no `unable_to_create_user`, no explicit
transaction flag. The callback **does** set a first-party session cookie on the API origin: `getSession()` resolved
it from the browser in 13 ms, and the session it returned carries the same `session.token` value the bearer plugin
accepts. So the handoff can read the cookie, take the session, and mint a code bound to that token.

- `GET /session/handoff` validates its redirect target against the parsed `WEB_ORIGINS` list — the open-redirect
  guard is not optional and reuses `isAllowedOrigin` rather than reimplementing it.
- `POST /session/exchange` consumes the code atomically, delete-then-return, so a replay gets nothing. An expired,
  unknown, or already-consumed code is one indistinguishable `401 UNAUTHENTICATED`.

### 4.6 `requireIdentity` and `requireOwner`

`requireIdentity` keeps its signature and its three context variables (`identity`, `registry`, `user`). It reads
`Authorization: Bearer`, resolves the session through better-auth, and calls
`registry.ensureUser(authUserId, email)`, which resolves in one order and only one: **by `auth_user_id` if it is
already attached; otherwise by `email`, attaching it; otherwise a new row.** That middle branch is what links a
seeded owner, or anyone created before A7, to the account they later sign in with.
A missing or invalid token is `401 UNAUTHENTICATED`, a new code in the shared error union; the old
`400 INVALID_INPUT` for a malformed header disappears with the header.

`requireOwner` runs after it, on the owner routes only — approve, decline, pause, resume, channel `start`, episode
retry, episode skip — and returns `403 FORBIDDEN`, also new to the union. `GET /me` is unchanged and still returns
the role, because the web still needs it to decide what to render; the difference is that rendering is no longer
the only thing between a stranger and the catalog.

### 4.7 CORS and the API document

`allowHeaders` gains `Authorization` and loses `X-User-Email`. Credentials stay off — the bearer design never sends
a cookie cross-origin, so PRD §2's "no credentials are involved" survives intact.

`GET /openapi.json` gains a bearer security scheme, and every route carries `401`; owner routes also carry `403`.
better-auth's `/auth/*` is one Hono catch-all rather than a set of described routes, so `openapi.test.ts` gains a
single named exclusion for it. PRD §8 promises the document "lists exactly the registered routes" — the exclusion
is written into that criterion rather than left to be discovered.

### 4.8 Web

`account.ts` is deleted entirely: no stored email, no recent-emails list, no "Who is this for?". `/` becomes a
sign-in screen with two provider buttons; `/auth/callback` reads the fragment, exchanges the code, stores the
token, and routes on. `api.ts` sends `Authorization` from the bound token instead of `X-User-Email`, and a `401`
anywhere clears the token and returns to `/`. `session.tsx` keeps its shape — `Guard`, `useSession`, the
bind-before-render rule — and changes what it binds. Sign-out calls better-auth and drops the token.

The Account screen shows the email from `/me`, which may now be absent; `lib/copy.ts` gains the one line for that
case.

### 4.9 Chunks

Nine, and the ordering rule is one property: **every chunk ends with the product running.** The owner's phasing of
2026-09-20 supplies the two moves that make that possible. The re-key is decoupled from better-auth, so a schema
rewrite and a new dependency on a new binding never share a blast radius — if something breaks after A3, it is the
re-key, because the identity source has not moved. And the web is prepared *before* the swap rather than after, so
there is never a state where `requireIdentity` has stopped accepting the header and no sign-in screen exists yet.
The cost of that second move is one redundant header sent by the web for the length of A6, which the API ignores.

| | Chunk | Ends with the product… |
|---|---|---|
| A0 | **Spike** (throwaway). `kysely` + `kysely-d1` versus `better-auth-cloudflare`, the D1 transaction workaround, one real Google sign-in on a scratch Worker. Output is a decision and the hard-rule-1 dependency proposal, not kept code. **First, because it is the only chunk that can invalidate the rest**, and it depends on nothing. Precedent: the DO-free spike Worker on `spike/transcript-remote` that settled DownSub. | unchanged |
| A1 | **The authorizing document edit.** PRD §2's prohibition reversed, the §10 Auth phase line, and `AGENTS.md` → Identity plumbing losing "Never add login, sessions, JWTs, or Cloudflare Access." Small on purpose: everything after it is permitted rather than contradicting the PRD. | unchanged |
| A2–A3 ✓ | **The Registry re-key** (complete 2026-09-20), with its own spec and plan (`auth-2-registry-rekey.md`, owner instruction 2026-09-20): nine S/M steps converting one identity-bearing table at a time — schema column, module and callers together — because `email` stays `UNIQUE` so every foreign key survives the primary key moving. Ends in a full `wrangler dev` walkthrough on the old identity, the gate that proves the re-key is innocent. | working, header identity |
| A4 ✓ | **better-auth stood up** (complete 2026-09-20; Meta deferred for credentials, Google verified end to end). D1 ×3 environments, mounted at `/auth/*`, Google and Meta configured, schema applied, `trustedOrigins` from `WEB_ORIGINS`. Sign-in works end to end and writes rows. Nothing consumes it. | working, sign-in creates rows |
| A5 | **The handoff.** `/session/handoff`, `/session/exchange`, the one-time code in better-auth's `verification` table, the open-redirect guard reusing `isAllowedOrigin`. Reviewed alone because it is the custom security code. | working, tokens issued but unused |
| A6 | **Web.** Sign-in screen at `/`, `/auth/callback`, token stored and bound, 401 handling, sign-out, `account.ts` deleted. Still sends `X-User-Email`, which the API still honours. | working |
| A7 | **The swap.** `requireIdentity` reads the bearer token and resolves through better-auth; `ensureUser` attaches `auth_user_id` by email; `X-User-Email` deleted from the Worker, the web, the CORS list and the tests; tests mint sessions in local D1. The irreversible one. | working, on sessions |
| A8 | **Authorization.** `requireOwner`, `403 FORBIDDEN`, `401 UNAUTHENTICATED`, the OpenAPI security scheme and its one declared exclusion, and the two §8 criteria that finally get tests. | working, gated |
| A9 | **Apple.** Gated on a deployed staging origin with HTTPS. | working |

## 5. The consequences the owner accepted

- **The bearer token lives in `localStorage` and XSS can read it.** The one-time code closes the redirect leak, not
  the storage one. Accepted as the price of two origins; the exit is a single origin, which PRD §3 would have to
  change to adopt.
- **Apple cannot ship in this phase.** It needs HTTPS and a deployed staging origin that does not yet exist.
- **A user with no email is a real, supported case, and better-auth is lied to about it.** The Registry holds
  null; better-auth holds `{providerId}:{accountId}@no-email.invalid` because its schema forbids null. The reader
  sees their provider name on the Account screen and nothing else, and `OWNER_EMAIL` can never match them, which
  is correct. The placeholder is unmailable by construction and nothing in this product sends email anyway.
- **Apple's one-shot email is a live hazard for A7.** The first authorization either persists it or it is gone
  until the user revokes the app in their Apple ID settings. A7's plan must treat that callback as irreversible.
- **Every local Durable Object is wiped — once, at A2.** Chats, read receipts, preferences, the catalog, every
  episode and every summary in dev. The vectors survive unless `/clean-local --include-vectors` is asked for.
  A7 needs no second wipe: it attaches `auth_user_id` to rows that already exist rather than re-keying them.
- **`global_users` carries a column that is null for everyone until A7.** `auth_user_id` is dead weight for four
  chunks. That is the price of the phasing, and it is the right price: it is what lets A2 land and be walked
  through while better-auth does not yet exist.

## 6. Hard rules

**Hard rule 1 (dependencies).** This phase proposes `better-auth`, plus either (`kysely` + `kysely-d1`) or
`better-auth-cloudflare`. The A0 spike decides which, and the proposal is put to the owner at its end. Nothing is
installed before that.

**Hard rule 2 (third-party APIs).** The rule today permits YouTube's public RSS feed, Cloudflare services, and
DownSub. It must be amended to permit the OAuth token and profile endpoints of **Google** and **Meta**, and of
**Apple** when A7 lands. Nothing else is added: no analytics, no email vendor, no third-party script in the page —
the providers are reached server-side over the redirect flow only.

**Hard rule 3 (Vectorize namespaces).** Unchanged in force, reworded: "user emails are never namespaces" becomes
"user identifiers are never namespaces". The guard in `lib/vectorize.ts` is not touched.

**Hard rule 4 (destructive commands).** The re-key needs a `/clean-local` run, which is the one sanctioned
exception and only when the owner asks in so many words.

## 7. Acceptance criteria

1. A request with no `Authorization` header is `401`, on every route but `/openapi.json`, `/docs`, `/auth/*`
   and `/session/*` — the exchange route is how a caller obtains a token and cannot require one.
2. A request with a forged or expired bearer token is `401`, and reaches neither Durable Object.
3. `X-User-Email` is not read anywhere; sending it changes nothing.
4. A completed Google sign-in ends with the web holding a token and `/me` returning that person.
5. The same for Meta.
6. A Meta profile with no email creates a Registry row with `email` **null** — and a better-auth row carrying a
   `…@no-email.invalid` placeholder — and that person can follow, read, and chat.
7. Two providers returning the same verified email resolve to one `user_id` and therefore one User DO.
8. The Registry rejects a second `global_users` row with an existing non-null email, and admits any number with
   null.
9. A handoff code works exactly once; a replay is `401`.
10. A handoff code older than sixty seconds is `401`.
11. `/session/handoff` refuses a redirect target outside `WEB_ORIGINS`.
12. The session token never appears in a URL, a `Referer`, or a redirect location.
13. A caller cannot read another user's chats, messages, preferences, or read receipts — **PRD §8's second
    criterion, tested for the first time**.
14. Owner routes return `403` for a non-owner: approve, decline, pause, resume, start, retry, skip.
15. A non-owner's `403` writes nothing — no channel row, no run, no attempt.
16. `seedOwner` still promotes `OWNER_EMAIL` at Registry DO start, minting a `user_id` with `auth_user_id` null,
    and never demotes anyone — so that row is the owner from the first request, not from the first sign-in. The
    first sign-in with `OWNER_EMAIL` then attaches `auth_user_id` to **that existing row**: no second owner, and
    the role survives.
17. `GET /me` returns `userId`, `email` (nullable), and `role`.
18. Migrations run idempotently on a fresh Registry DO with the re-keyed schema, and every CHECK still rejects what
    it rejected before.
19. `GET /openapi.json` lists exactly the registered routes with `/auth/*` as its single declared exclusion, and
    every response parses against the shared schemas.
20. No test reaches the network; no route in any environment mints a session.
21. Two users following one channel still produce one shared episode, summary, and vector set with independent read
    receipts — **PRD §8's first criterion, which the M6 audit found untested**.
22. `global_users.user_id` is generated by the Registry and is never a value any caller supplied.
23. The Registry admits at most one row per non-null `auth_user_id`, and any number with null.
24. **A3's gate:** with the re-key complete and `X-User-Email` still in force, the full product works under
    `wrangler dev` — add a channel, approve, discover, ingest, read, mark read, ask, and every Curate screen.
    This is the proof the re-key is innocent, and it runs before better-auth exists.
25. **A6's gate:** a reader can sign in, hold a token, and use the product — while the API is still reading the
    header. Neither half of the swap is load-bearing yet.

## 8. Out of scope

Apple (A7, gated). Passwords, magic links, and any email vendor. Passkeys. Session revocation UI and device lists.
Multi-owner administration beyond the existing promote-never-demote. Rate limiting. Account deletion — which the
product still does not offer for chats either (§9, 2026-09-17). A single-origin deployment, which would remove the
handoff entirely and is the named exit from the `localStorage` exposure, but changes PRD §3.

## 9. `AGENTS.md` and PRD alignment

This spec does **not** claim the PRD needs no edit. It needs eight, and they do not land together: **A1 makes the
one authorizing edit** — §2's prohibition reversed and the §10 line — and **each later chunk edits the sections it
falsifies as its own first commit**. §5.1 goes with A2, §7 with A6, §2's authorization paragraph with A8. Docs stay
adjacent to the work, which is the failure mode this repo keeps producing.

- **§1** — external services gains Google and Meta OAuth.
- **§2** — rewritten. "No authentication is added, and none should be" is reversed; the identity paragraph becomes
  verified sessions and user-id keying; the no-authorization paragraph becomes owner routes return 403; the CORS
  paragraph keeps "no credentials" and gains `Authorization`.
- **§3** — the architecture diagram's `Hono Worker + X-User-Email` becomes the session; the stack table gains D1 and
  better-auth.
- **§5.1** — the five re-keyed columns and the nullable unique email.
- **§5.4** — records this in-place edit of `0001_init.sql`, after the 2026-09-13 one its header already carries.
- **§7** — `/` becomes sign-in rather than "Who is this for?"; `/auth/callback` joins the route table.
- **§8** — criteria 1, 2 and 13–25 above fold into the section M6 will sweep.
- **§9** — one entry per decision in §3 of this spec, in the owner's own words, including the two reversals stated
  as reversals.
- **§10** — the Auth phase line between M5 and M6, unnumbered.

`AGENTS.md` needs four: hard rule 1 (the new dependencies once approved), hard rule 2 (Google and Meta), hard rule
3's wording, and the **Identity plumbing** section rewritten — including the removal of its own line,
"Never add login, sessions, JWTs, or Cloudflare Access."
