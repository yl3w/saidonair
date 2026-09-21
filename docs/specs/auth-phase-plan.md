# Implementation plan — The Auth phase

**Implements:** `docs/specs/auth-phase.md` under `AGENTS.md`. The phase is unnumbered and sits between M5 and M6
(PRD §10), so it consumes nothing M6 owns and adds criteria to the sweep M6 will run.
**Written:** 2026-09-20, against `main` at `c675e5d`.
**Status:** approved 2026-09-20. **A0, A1, A2–A3, A4, A5 and A6 complete** the same day — the Registry re-key landed in
seven commits with its own spec and plan (`auth-2-registry-rekey.md`), 395 tests, and a `wrangler dev` walkthrough
on a real channel. **A6 is complete too**: the web signs in and holds a token while the API still reads the header. **Next is A7, the swap** — the irreversible one. Nothing is installed in the repo yet: A0 ran entirely in a
scratch directory, and A4 is where `better-auth` actually enters the tree.
**Shape:** nine chunks, A0–A9. A0 is a throwaway spike whose output is a decision and the hard rule 1 dependency
proposal. Each later chunk is one or more commits when the owner asks, with `pnpm check` green. Decisions this plan
makes are marked **plan decision** and stand unless vetoed.

**The ordering rule, and the only one:** every chunk ends with the product running. Check it against the last
column of spec §4.9 before moving a step between chunks.

## Definition of complete

Spec §7, all twenty-five criteria, with A9 carrying 4-for-Apple only.

## Owner actions (agents propose, never run — `AGENTS.md` → One-time setup)

| When | Action |
|---|---|
| ~~A0~~ | ~~`wrangler d1 create`~~ — not needed: `wrangler dev` makes a local D1 on disk |
| A0 end | Approve the dependency under hard rule 1 — **one package, `better-auth`** |
| A0 | Google Cloud OAuth client for the spike, redirect `http://localhost:8787/auth/callback/google` |
| A4 | `wrangler d1 create media-digest-auth{,-staging,-dev}` |
| A4 | Google Cloud OAuth client + Meta app; `wrangler secret put` × 5 × 3 environments |
| A2–A3 | Run `/clean-local` when asked — **only if `pnpm dev` ran during the chunk** (see its plan, step 9) |
| A9 | Apple Developer Program, Services ID, `.p8`; stand up the deployed staging web origin |

---

### A0 — Spike: better-auth on workerd  (size: M, throwaway)

**First, because it is the only chunk that can invalidate the rest, and it depends on nothing.** Precedent: the
DO-free spike Worker on `spike/transcript-remote` that settled DownSub (`docs/specs/transcript-spike-results.md`).

**Files:** none kept. A scratch Worker on a `spike/auth` branch, never merged.

- 0.1 Scratch Worker: Hono, `nodejs_compat`, one D1 binding, `app.all("/auth/*", (c) => auth.handler(c.req.raw))`.
- 0.2 Wiring A — `kysely` + `kysely-d1`, the auth instance built per request from `c.env`.
- 0.3 Wiring B — `better-auth-cloudflare`.
- 0.4 One **real Google sign-in** end to end under `wrangler dev` against each wiring.

**The six questions this spike exists to answer.** A wiring that cannot answer all six loses:

1. Which wiring, and why.
2. Does `transaction: false` actually clear the social-sign-in `unable_to_create_user` failure on D1
   (better-auth issue #4732), or does it need more?
3. **The exact sign-in entry URL** for a top-level navigation without the client library. Spec §4.5 deliberately
   left this as "the provider sign-in URL better-auth exposes"; A6 cannot be written until it is a literal string.
4. **Is the bearer token the same value as the `session` row's token?** A7's test helper mints sessions by
   inserting rows, which only works if it is.
5. **Can the `verification` table hold the handoff codes**, or does A5 need its own table?
6. Does `auth.api.getSession()` work against a per-request instance, and what does it cost per call?

**Answers, 2026-09-20, against better-auth 1.7.5.** Five of six settled before a Google client existed, including
both blockers:

1. **Neither wiring.** 1.7.5 takes the D1 binding directly — `database: env.AUTH_DB`. `kysely`, `kysely-d1` and
   `better-auth-cloudflare` are all unnecessary and `better-auth-cloudflare` was never installed: the comparison
   dissolved rather than resolved.
2. **No workaround needed.** A live Google sign-in completed on D1 — `POST /auth/sign-in/social` `200`, callback
   `302`, `user`/`account`/`session` written, zero errors. Issue #4732 does not reproduce on 1.7.5.
3. **Not a navigable link.** `POST /auth/sign-in/social` answers `200` and `{"url":…,"redirect":true}`; the web
   fetches, then assigns `location.href`. A6 amended.
4. **Yes** — a hand-inserted `session` row's raw `token` resolves as a Bearer through `getSession()`, in 6 ms.
   A7's helper works. Timestamps are ISO 8601 strings.
5. **Yes** — `verification` is `id, identifier, value, expiresAt, createdAt, updatedAt`. A5 needs no table.
6. **Yes** — per-request instance, 4–6 ms.

**Two findings nobody asked for.** The OAuth `state` and PKCE `code_verifier` live in the `verification` table
keyed by the state parameter, **not in a cookie**, so starting a sign-in works cross-origin — the step most likely
to have broken the two-origin design does not. And **better-auth's `user.email` is `not null unique`**, which
contradicted decision 5; resolved the same day by synthesizing a `…@no-email.invalid` placeholder while the
Registry holds null (spec §4.2).

**A third unasked finding:** the callback sets a first-party session cookie on the API origin, and the session it
resolves carries the same `session.token` the bearer plugin accepts — so A5's handoff can read the cookie and mint
a code bound to that token. That was the last assumption in the design standing without evidence.

**Status: A0 COMPLETE, 2026-09-20.** Six of six answered, three findings nobody asked for, one dependency proposed
instead of three, and two chunks amended before they were written. Spec §4.1, §4.2 and §4.5 carry the answers.
**No code from this chunk survives.**

---

### A1 — The authorizing document edit  (size: S)

Small on purpose. Everything after this is permitted by the PRD rather than contradicting it.

**Files:** `docs/PRD.md`, `AGENTS.md`.

- 1.1 PRD §2: replace *"No authentication is added, and none should be: no login, sessions, JWTs, or Cloudflare
  Access"* with the reversal, naming `docs/specs/auth-phase.md`. Leave §2's authorization paragraph alone — A8
  owns it, and it is still true until then.
- 1.2 PRD §9: one entry, 2026-09-20, in the owner's words, stating it as a reversal of a decision and why.
- 1.3 PRD §10: the `Auth phase` line between M5 and M6, unnumbered, citing the Design phase precedent.
- 1.4 `AGENTS.md` → Identity plumbing: delete *"Never add login, sessions, JWTs, or Cloudflare Access."* and point
  the section at the spec. Leave the `X-User-Email` description — it is accurate until A7.

**Done when:** `pnpm check` green, one commit.

**Complete 2026-09-20.** Five edit sites, not the four this chunk listed. The sweep for *other* statements that the
reversal falsified — which is the whole point of doing documents first — found three the plan had not named: the
preamble's "Next is M6", §2's closing "This does not introduce authentication", and `AGENTS.md`'s Identity plumbing
summary line, "email header, no authentication". Each would have outlived its work exactly the way the four
documents in `m6-section-8-sweep` did.

---

### A2–A3 — The Registry re-key  (own spec and plan)

**Withdrawn as two chunks and delivered as one, owner instruction 2026-09-20:**
`docs/specs/auth-2-registry-rekey.md` and `-plan.md`, nine steps, every one S or M. A4–A9 keep their labels, so
nothing downstream is renumbered.

**Why the split was wrong.** A2 moved the schema while callers still passed email; A3 moved the callers. A2's own
step 2.4 recorded a **plan decision** that `followers.ts` and the three audit writers would resolve email →
`user_id` internally in A2 and take `user_id` in A3 — resolution code written, reviewed, tested and deleted one
chunk later. The better seam is **by table**, and one property of the schema makes it available: `email` stays
`UNIQUE` on `global_users`, and SQLite foreign keys may reference any unique column, so every
`REFERENCES global_users (email)` survives the primary key moving. Each table therefore converts on its own —
column, module and callers together, once — with `pnpm check` green after each.

**Also: no `/clean-local` inside the chunk.** Tests use in-memory storage and local dev storage was wiped on
2026-09-20; one wipe is owed at the end only if `pnpm dev` ran in between.

**Ends with the product** working, on header identity, fully re-keyed. **Complete 2026-09-20.**

---

### A4 — better-auth stood up, consumed by nothing  (size: M)

**Files:** `apps/api/package.json`, `apps/api/wrangler.jsonc`, `apps/api/src/lib/auth.ts` (new),
`apps/api/src/index.ts`, `apps/api/src/bindings.d.ts`, `apps/api/migrations/auth/0001_better_auth.sql` (new),
`apps/api/test/wrangler-config.test.ts`, `apps/api/test/openapi.test.ts`.

- 4.1 Install `better-auth` — **one package**. A0 found 1.7.5 takes the D1 binding directly, so `kysely`,
  `kysely-d1` and `better-auth-cloudflare` are all unnecessary.
- 4.2 `wrangler.jsonc`: `AUTH_DB` bound to `media-digest-auth` / `-staging` / `-dev`, repeated in all three
  environments because wrangler does not inherit bindings. `wrangler-config.test.ts` gains it, and will fail when
  they drift — as it already does for every other binding.
- 4.3 `lib/auth.ts`: one exported factory taking `Env` and returning the better-auth instance, built **per
  request** because the D1 binding does not exist at module scope. `database: env.AUTH_DB`, directly. Transactions
  default to `false` in 1.7.5, so no explicit flag unless A0's live sign-in showed otherwise. `trustedOrigins` parsed from
  `WEB_ORIGINS` with the same `parseOrigins` `lib/cors.ts` uses — one source, never two lists to drift.
  `socialProviders`: `google` and `facebook`. `mapProfileToUser` admits a profile with no email as `email: null`.
  **Account linking on a verified email** (spec decision 6): both providers listed as trusted, so the same person
  arriving via Google and via Meta resolves to one better-auth user and therefore one `user_id` and one User DO.
  The Registry's `email TEXT UNIQUE` is the belt-and-braces check that it worked, and criterion 7 asserts it.
- 4.4 `index.ts`: `app.all("/auth/*", …)` registered before any catch-all, as better-auth's Hono integration
  requires.
- 4.5 `migrations/auth/0001_better_auth.sql`: the schema better-auth's CLI generates. The CLI cannot reach a D1
  binding, so it is pointed at Node's built-in `DatabaseSync` through a generation-only config, exactly as A0 did;
  the emitted SQL is `user`, `session`, `account`, `verification` plus three indexes, applied with
  `wrangler d1 execute --file`. Timestamps are ISO 8601 strings.
- 4.6 `openapi.test.ts`: `/auth/*` added as the one declared exclusion, with the reason in a comment — PRD §8
  promises the document lists exactly the registered routes, so the exclusion is written into the criterion rather
  than discovered later.
- 4.7 Docs this chunk falsifies, as its first commit (spec §9): PRD §1's external-services list and `AGENTS.md`
  hard rule 2 extended to **Google's and Meta's OAuth token and profile endpoints** — server-side, over the
  redirect flow, and nothing else; no analytics, no email vendor, no third-party script in the page. PRD §3's
  stack table gains D1 and better-auth.
- 4.8 Manual verification under `wrangler dev`: sign in with Google, then with Meta, and confirm `user`, `session`
  and `account` rows exist. Nothing else in the product has changed.

**Tests:** spec §7 criteria 19, and 4 and 5 manually — an end-to-end social sign-in cannot be tested offline, which
is why the walkthrough carries it.
**Done when:** `pnpm check` green and both sign-ins verified.

---

### A5 — The handoff  (size: M)

The custom security code, reviewed alone because that is what it is.

**Files:** `apps/api/src/routes/session.ts` (new), `apps/api/src/lib/handoff.ts` (new),
`apps/api/src/index.ts`, `packages/shared/src/index.ts`, `apps/api/test/routes-session.test.ts` (new).

- 5.1 `lib/handoff.ts`: `mintCode(auth, sessionToken, now)` and `consumeCode(auth, code, now)`, over better-auth's
  `verification` table if A0 question 5 said yes, or a table of our own if it said no. Sixty-second life.
  `consumeCode` deletes and returns in one statement so a replay gets nothing.
- 5.1a **`GET /session/start?provider=…`** — added by A4's finding, not in the original plan. It calls
  better-auth's sign-in server-side and `302`s to the provider, carrying the `better-auth.state` cookie. It
  exists because that cookie must be set by a **top-level navigation on the API origin**: set cross-site from a
  `fetch` it is `SameSite=Lax` without `Secure`, which browsers reject, so a sign-in begun from the web's own
  origin works on localhost and fails deployed with `state_mismatch`. Validates `provider` against the
  configured set.
- 5.2 `GET /session/handoff`: reads the first-party session cookie better-auth has just set — same origin, so it is
  sent — mints a code, and `302`s to the web. **The redirect target is validated with `isAllowedOrigin` against
  the parsed `WEB_ORIGINS`.** An unlisted target is `400 INVALID_INPUT` and no code is minted.
- 5.3 `POST /session/exchange`: consumes the code and answers `{ token, expiresAt, userId, email }`. **Plan
  decision:** it returns the email too, because A6 still needs it for the header it is still sending, and A7 wants
  it for the Account screen. An expired, unknown or already-consumed code is one indistinguishable `401`.
- 5.4 Zod schemas in `packages/shared`, `describeRoute` on both routes, `openapi.test.ts` list updated.
- 5.5 Tests: a code works once; a replay is 401; sixty-one seconds is 401; an unknown code is 401; a handoff to an
  origin outside `WEB_ORIGINS` is refused and mints nothing; no response body or redirect location anywhere in the
  suite contains a session token.

**Tests:** spec §7 criteria 9, 10, 11, 12.
**Done when:** `pnpm check` green.

**Complete 2026-09-20**, and walked end to end in a browser against the real Worker:
`/session/start` → Google → `/auth/callback/google` → `/session/handoff` → the web with
`#code=7417bf4e…`; `POST /session/exchange` answered the session; the same code replayed answered
`401`; and the token it returned resolved through `Authorization: Bearer` to the signed-in account.
Every claim in §4.5 observed rather than argued — the state cookie survived because the flow began
as a top-level navigation, and what crossed origins was a code, not a credential.

**A constraint this handed to A6.** The first attempt appeared to fail: the reader landed on the
queue with no code. It had worked — `apps/web/src/main.tsx` handles an unknown route with
`route("/queue", true)`, a `replaceState` that discards the fragment along with the path. So
**`/auth/callback` must read `location.hash` before any routing runs**, or the fallback eats the
code. Repeating the sign-in against a static file Vite serves directly proved the redirect had been
right all along.

---

### A6 — Web prepared, still on the old header  (size: L)

The chunk that removes the broken intermediate. The web can sign in and holds a token; the API has not moved.

**Files:** `apps/web/src/screens/SignIn.tsx` (new), `apps/web/src/screens/AuthCallback.tsx` (new),
`apps/web/src/session.tsx`, `apps/web/src/api.ts`, `apps/web/src/main.tsx`, `apps/web/src/account.ts` (deleted),
`apps/web/src/screens/Account.tsx`, `apps/web/src/components/Avatar.tsx`, `apps/web/src/lib/copy.ts`,
`docs/design.md`, `docs/PRD.md` §7.

- 6.1 `SignIn.tsx` replaces the "Who is this for?" screen at `/`: one button per configured provider.
  **Corrected by A4:** each button is a **plain link** to `GET <API>/session/start?provider=…` — a top-level
  navigation, no `fetch`, no credentials. A0's fetch-then-`location.href` shape sets the state cookie cross-site,
  which works on localhost and fails deployed. **Google only until Meta has credentials** (owner decision
  2026-09-20): the provider is configured in `lib/auth.ts` and its button ships when an App ID exists.
- 6.2 `AuthCallback.tsx` at `/auth/callback`: read `location.hash`, **`history.replaceState` before anything
  else**, `POST /session/exchange`, store the token, route to `/queue`. **A5 proved the hazard is real**: the
  router's unknown-route fallback (`main.tsx`, `route("/queue", true)`) discards the fragment, so the route must
  exist and must read the hash before any routing runs — a sign-in that silently lands on the queue with no code
  is this, not a broken handoff.
- 6.3 `api.ts`: sends `Authorization: Bearer` **and** `X-User-Email`, the email taken from the exchange response.
  The API ignores the former for now. This redundancy is the whole cost of the phasing and it lasts one chunk.
- 6.4 `session.tsx`: keeps `Guard`, `useSession`, `useReadySession` and the bind-before-render rule; binds the
  token and the email together so a tab can still only send what it displays. `signOut` calls better-auth and
  drops the token.
- 6.5 `account.ts` deleted: no stored email, no recent-emails list.
- 6.6 `Account.tsx` and `Avatar.tsx` read the email from `/me`, which may be null; `copy.ts` gains the line for a
  reader with no email address.
- 6.7 PRD §7 and `docs/design.md`: `/` is sign-in, `/auth/callback` joins the route table.

**Known transitional limitation, stated rather than discovered:** a Meta account with no email cannot use the
product during A6, because the header it must still send has nothing to carry. A7 removes the limitation with the
header. The A6 walkthrough uses Google.

**Tests:** the web is typecheck and lint only (`AGENTS.md` → Web UI code). Spec §7 criterion 25 is the walkthrough.
**Done when:** `pnpm check` green and a reader can sign in, land on the queue, and use the product.

**Complete 2026-09-20.** The owner signed in through the front door and the product worked — criterion 25, and
the state it leaves behind is the one this chunk was for: the web holds a token, the API still reads the header,
and neither half of the swap is load-bearing yet.

**It failed once first, and the cause is worth keeping.** The screen showed *"Couldn't load your account:
NetworkError when attempting to fetch resource"*. That was CORS: A6 had begun sending `Authorization` while
`lib/cors.ts` still allowed only `Content-Type` and `X-User-Email`, so the browser refused the request before
making it. **This plan put that line in A7**, with the rest of the header swap; it belongs with the first request
that sends the header. The symptom names nothing useful — no mention of CORS in the console, and an empty Worker
log, because the request never arrived — so the preflight's `Access-Control-Allow-Headers` is the first thing to
check when a request dies before arrival. `cors.test.ts` now asks for `authorization` so the list cannot lose it
again.

---

### A7 — The swap  (size: L)

The irreversible one.

**Files:** `apps/api/src/middleware/user.ts`, `apps/api/src/lib/cors.ts`, `apps/api/src/do/registry/users.ts`,
`packages/shared/src/index.ts`, `apps/web/src/api.ts`, `apps/api/test/helpers.ts`, `apps/api/test/cors.test.ts`,
`apps/api/test/me.test.ts`, and every route test.

- 7.1 `middleware/user.ts`: read `Authorization: Bearer`, resolve the session through better-auth, call
  `ensureUser(authUserId, email)`. Missing or invalid is `401 UNAUTHENTICATED` and reaches neither Durable Object.
- 7.2 `users.ts` `ensureUser` resolves **in one order and only one**: by `auth_user_id` if attached; else by
  `email`, attaching it; else insert. The middle branch is what links the seeded owner, and anyone created before
  A7, to the account they later sign in with.
- 7.3 `packages/shared`: `ErrorCodeSchema` gains `UNAUTHENTICATED`; its description loses "including a missing or
  malformed `X-User-Email`".
- 7.4 `X-User-Email` deleted everywhere: the middleware constant, `lib/cors.ts` `allowHeaders` (which **already
  gained `Authorization` in A6** — it had to, since that is the chunk that began sending it), `apps/web/src/api.ts`
  where it rides beside the bearer token, and every test helper.
- 7.5 `helpers.ts`: a test identity is minted by inserting `user` and `session` rows into local D1 and returning
  `session.token` — **A0 proved the bearer token is that column's raw value**. Timestamps are ISO 8601 strings. **No route in any environment mints a session** — a bypass behind a flag is still a bypass that
  shipped, and this is the deliberate departure from the env-selected-fake precedent recorded in spec §3.
- 7.6 Every route test moves from a header to a bearer token.
- 7.7 PRD §3's architecture diagram: `Hono Worker + X-User-Email` becomes the verified session.
- 7.8 Walkthrough: sign in, use the product, and confirm a Meta account with no email now works.

**Tests:** spec §7 criteria 1, 2, 3, 6, 7, 13, 17, 20.
**Done when:** `pnpm check` green and the walkthrough recorded.

---

### A8 — Authorization  (size: M)

**Files:** `apps/api/src/middleware/owner.ts` (new), `apps/api/src/routes/channels.ts`,
`apps/api/src/routes/episodes.ts`, `packages/shared/src/index.ts`, `apps/api/src/lib/openapi.ts`,
`apps/api/test/routes-channels.test.ts`, `apps/api/test/openapi.test.ts`,
`apps/api/test/authorization.test.ts` (new), `apps/api/test/isolation.test.ts` (new), `docs/PRD.md`.

- 8.1 `middleware/owner.ts`: `requireOwner`, after `requireIdentity`, reading `c.var.identity.role`.
- 8.2 Applied to seven routes and no others: approve, decline, pause, resume, channel `start`, episode retry,
  episode skip.
- 8.3 `ErrorCodeSchema` gains `FORBIDDEN`; `lib/openapi.ts` gains the bearer security scheme; every route
  documents `401`, and the seven document `403`.
- 8.4 `authorization.test.ts`: each of the seven returns 403 for a non-owner **and writes nothing** — no channel
  row, no run, no attempt. The write assertion is the point; a 403 that has already mutated is the bug worth
  catching.
- 8.5 `isolation.test.ts`: two identities, and the second cannot read the first's chats, messages, preferences or
  read receipts — **PRD §8's second criterion, tested for the first time** — plus two followers of one channel
  producing one shared episode, summary and vector set with independent receipts, which is §8's first line and
  what the M6 audit found untested.
- 8.6 PRD §2's authorization paragraph rewritten, §9 gains the reversal entry, §8 absorbs criteria 1, 2 and 13–25.

**Tests:** spec §7 criteria 14, 15, 19, 21.
**Done when:** `pnpm check` green.

---

### A9 — Apple  (size: M, gated)

**Blocked until a deployed staging web origin exists with HTTPS.** Apple supports neither `localhost` nor
non-HTTPS, and `CLAUDE.md` makes `wrangler dev` the gate for runtime behavior — so this is the one chunk whose
verification happens on staging. `wrangler.jsonc`'s `WEB_ORIGINS` for staging is an unfilled `TODO(owner)` today.

**Files:** `apps/api/src/lib/auth.ts`, `apps/api/wrangler.jsonc`, `apps/web/src/screens/SignIn.tsx`,
`docs/PRD.md` §1, `AGENTS.md` hard rule 2.

- 9.1 Owner: Apple Developer Program, a Services ID, a `.p8` key; secrets per environment. better-auth generates
  the client-secret JWT in config from the key material, so there is no expiring string to rotate by hand.
- 9.2 `lib/auth.ts` gains the `apple` provider.
- 9.3 **Treat the first callback as irreversible.** Apple emits the email only on first authorization and offers no
  user-info endpoint to fetch it later; if that callback fails to persist it, it is gone until the user revokes the
  app in their Apple ID settings. `mapProfileToUser` must persist on the first pass and tolerate its absence on
  every later one.
- 9.4 A third button on `SignIn.tsx`.
- 9.5 Hard rule 2 and PRD §1 extended to Apple.
- 9.6 Walkthrough on deployed staging, not locally.

**Done when:** `pnpm check` green and a real Apple sign-in verified on staging.

---

## Walkthrough record

Filled as each gate runs, the way every plan since M3 carries one.

| Chunk | Date | What was exercised | Result |
|---|---|---|---|
| A3 | | full product on the old identity | |
| A4 | | Google and Meta sign-in creating rows | |
| A6 | | sign in, land on the queue, use the product | |
| A7 | | the swap, incl. a Meta account with no email | |
| A9 | | Apple, on deployed staging | |

## Record

Decisions made while implementing, by theme, added as they happen — the pattern
`docs/specs/design-phase-plan.md` established.
