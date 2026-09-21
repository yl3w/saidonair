# Implementation plan — Route visibility

**Implements:** `docs/specs/route-visibility.md` under `AGENTS.md`.
**Written:** 2026-09-21, against `main` at `0b5006c`.
**Status:** **COMPLETE 2026-09-21.** Step 1 `dea8705`, steps 2–3 `0550f95`, step 4 `4ad7e4a`, step 5 this commit.
417 tests. The API half was exercised under `wrangler dev` against the real local catalog, anonymous and signed in;
the browser click-through is the owner's. The spec's own open questions were settled in review on 2026-09-21
(below).
**Shape:** five steps, each one or more commits when the owner asks, each ending with `pnpm check` green **and the
product running**. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

**The ordering rule:** the behaviour change lands in step 4 and nowhere else. Steps 1–3 are either closed surface
(1) or pure preparation that leaves every response byte-identical (2, 3). If step 4 has to be reverted, steps 1–3
stand on their own.

## What the owner settled on 2026-09-21

Five questions were put in review of this plan; the answers are binding and two of them change the spec.

| Question | Answer |
|---|---|
| Which channel statuses may a signed-out caller see? | **All three.** `?scope=all` answers the same signed out as signed in, and `reviewNote` — the owner's written decline reason, a top-level `Channel` field — is world-readable. The cost was named and accepted. |
| Are a withdrawn channel's summaries public? | **Yes.** A signed-out landing page — channel → episodes → summaries — is a future iteration, and these routes are its API. No status filter on any episode read. |
| Order of `GET /channels` | Lapsed with the deferral below; see plan decision 1. |
| Where does the web absorb the optional fields? | **Defensive access at each site** (§ step 2.5), because the landing page will genuinely receive responses without either field. |
| Is there an inversion with PRD §4.1's "the reader screens hide them"? | **No — withdrawn in review.** That hiding lives entirely in eligibility (`lib/eligibility.ts`), so it removes a declined channel's summaries from Queue, History and the calendar and stops its read receipts. `Source.tsx` loads `api.listEpisodes` with no status check and hides only the Follow button (`Source.tsx:339`), so a signed-in reader can already open every one of those summaries. Signed-out is parity, not a reversal. |

## Definition of complete

Spec §6, all eleven criteria, plus two this plan adds because they are ways the change could break something that
works today and neither is visible in the spec's list:

12. `GET /channels/feed` still answers the feed for a signed-in caller and `401` for an anonymous one — it is not
    swallowed by the public `GET /channels/{id}` registered above it (Risks 1).
13. A malformed or garbage `Authorization` header on a public route is the anonymous view, not a `500` (Risks 3).

## Owner actions (agents propose, never run — `AGENTS.md` → One-time setup)

**None.** No dependency, no migration, no secret, no Cloudflare resource. `/clean-local` is **not** needed: nothing
in this plan touches a migration or DO state.

One owner-visible moment: the `wrangler dev` walkthrough at the end of step 4 (CLAUDE.md — Workers runtime
behaviour is not proven by `vitest` alone).

---

### Step 1 — The two moves to owner  (size: S)

**First because it is independent of everything else, closes surface rather than opening it, and is the half of the
spec that can ship alone.** Nothing here depends on `optionalIdentity`.

**Files:** `routes/catalog.ts`, `routes/channels.ts`, `middleware/owner.ts`, `test/authorization.test.ts`,
`test/openapi.test.ts`.

- 1.1 `GET /catalog` gains `requireOwner` and `errorResponses({ owner: true })`. Its description ends "the web
  shows it on the Owner screens; the API answers any caller" — the second clause is now false and goes.
- 1.2 `GET /channels/{id}/followers` gains the same two. `FollowersResponseSchema` is untouched: the owner still
  receives addresses (spec §4.4).
- 1.3 `middleware/owner.ts`'s doc comment closes with "Reading is deliberately untouched. Every caller still sees
  the whole catalog, every channel's management facts and every follower list — that is §7's design, not an
  oversight." That paragraph is now wrong in two of its three clauses. Rewrite it to name the two reads and why
  each is operational rather than reader-facing (spec §2.1), and to say that the *rest* of reading is not merely
  untouched but about to widen.
- 1.4 `openapi.test.ts`: `OWNER_ONLY` grows from seven entries to nine. The set is listed rather than counted on
  purpose, so this is the deliberate edit it is meant to be.
- 1.5 `authorization.test.ts`: the third case, "leaves reading open to everyone, which is the design and not an
  oversight", currently asserts `200` for ALICE on all five of `/catalog`, `/channels`, `/channels/{id}`,
  `/channels/{id}/followers`, `/channels/{id}/runs`. Split it: the two that moved answer `403 FORBIDDEN` for
  ALICE and `200` for OWNER, the other three stay `200`, and the owner's follower list still carries addresses.
  The existing "writes nothing" `state()` assertion covers criterion 9 for free — both are reads.

**Criteria:** 7, 8, 9.

**The web needs no change, and this was verified rather than assumed:** `Settings.tsx:73` already loads the
catalog under `{ enabled: isOwner }`, `Nav.tsx:37` gates the attention count on `role === "owner"`, and Curate and
CurateChannel — the only callers of `getFollowers` — sit behind `Guard ownerOnly`. Nothing a non-owner can reach
calls either route.

---

### Step 2 — Two shapes, one schema  (size: M)

**No behaviour change: every response is byte-identical when this step ends.** It only makes the *type* admit an
absence, and teaches the projections to produce one on demand. Doing it separately means step 4 changes routing
and nothing else.

**Files:** `packages/shared/src/index.ts`, `lib/channel-view.ts`, `lib/episode-view.ts`, `routes/channels.ts`,
`routes/episodes.ts`, `routes/digest.ts`, `routes/follows.ts`, ~15 sites in `apps/web/src`.

- 2.1 `packages/shared`: `management: ChannelManagementSchema.optional()` and
  `processing: EpisodeProcessingSchema.optional()`. Six sentences in that file promise every caller receives them
  — the doc comments and `.meta({ description })` on `ChannelManagementSchema`, `ChannelSchema` and
  `EpisodeSchema`. Each is replaced by the rule of spec §4.3: **present with a session, omitted without one**, and
  which routes can omit them.
- 2.2 `ChannelView` gains `management: boolean`, **required**. Required rather than defaulting, so every call site
  states the decision and a new route cannot inherit "include it" by silence.
- 2.3 `EpisodeView` gains `processing: boolean`, also required; `toEpisode(record, view = {})`'s default parameter
  goes with it, for the same reason.
- 2.4 Every existing call site passes `true`: `toChannel` ×3 (`channels.ts:96`, `channels.ts:768`,
  `follows.ts:212`) and `toEpisode` ×9 (`channels.ts` ×7, `episodes.ts:48`, `digest.ts:114`).
- 2.5 **The web, defensively.** ~15 sites, in three shapes:
  - a value passed to something that already takes `null` — `runtimeCopy(episode.processing?.durationSec ?? null)`
    at `Reading.tsx:278` and `SummaryRow.tsx:74`; `MetaLine` already drops nulls, so the runtime simply does not
    appear;
  - a branch with a fallback already written — `CatalogTable.tsx:166` has its em-dash, `Reading.tsx:213` guards
    the Ask affordance on `vectorizedAt`, `AttentionList.tsx:235–248` reports a failure;
  - a block with nothing to render — `CurateChannel.tsx:237` (`const m = c.management`) becomes an early return,
    so the management header is absent rather than drawn full of dashes.

  `AttentionList.tsx:43,49` and `RequestQueue.tsx:104–105` already optional-chain and narrow correctly; they need
  nothing. **No visual change for any signed-in reader**, and the fallbacks are what the signed-out landing page
  will render.

**Criteria:** none directly; this is what makes 2, 3 and 5 expressible.

---

### Step 3 — `optionalIdentity`  (size: S)

**Nothing mounts it. No behaviour change.** Spec §4.1.

**Files:** `env.ts`, `middleware/user.ts`, `lib/eligibility.ts`, and the four call sites of `eligibleChannelIds`.

- 3.1 `env.ts` gains `PublicEnv` beside `AppEnv`: the same bindings, with `identity` and `user` optional and
  `registry` still required. `AppEnv` is **untouched**, so none of the ~30 guarded handlers that read
  `c.var.identity.userId` changes, and none of them can be made anonymous by accident either — a public handler
  has to be written against the weaker type on purpose.
- 3.2 `middleware/user.ts`: the session→identity resolution becomes one private function; `requireIdentity` keeps
  today's behaviour exactly (`401` on no session, neither DO touched), and `optionalIdentity` sets `registry`
  always, `identity` and `user` only when a session resolves. It never answers `401`. **The resolution call is
  wrapped**: a rejected token and a malformed one are both the anonymous view, because the spec's reason for
  treating a stale token as anonymous ("a reader whose session quietly expired being told a public page is
  forbidden") applies just as much to a `500`.
- 3.3 `lib/eligibility.ts`: `eligibleChannelIds` takes the registry stub and `RegistryUser | undefined` instead of
  the context, and answers the empty set for `undefined`. **An anonymous caller is eligible for nothing** — one
  sentence, in the file that already exists to be the one implementation of that rule, and it is what makes
  `related: []` fall out rather than being special-cased. Call sites: `channels.ts:418,463,740`, `chats.ts:125`;
  `episodes.ts:36` stops inlining its own copy.

**Criteria:** none directly; 6 and 13 become testable at step 4.

---

### Step 4 — The five public reads  (size: L)

**The behaviour change, all of it, in one step.**

**Files:** `routes/channels.ts`, `routes/episodes.ts`, `index.ts`, `lib/openapi.ts`, `test/openapi.test.ts`, a new
`test/visibility.test.ts`.

- 4.1 `routes/channels.ts` exports **three** routers instead of one. Nothing moves between files; the handlers are
  the ones already there.
  - `channelFeedRoutes` — `GET /channels/feed` alone, mounting `requireIdentity` on the route itself. It is not
    public (spec decision 6: the one catalog route that makes an outbound request per call). It exists as its own
    export **only** so it can be registered ahead of the public `/{id}` — see Risks 1.
  - `channelPublicRoutes` — `GET /`, `GET /{id}`, `GET /{id}/episodes`, `GET /{id}/episodes/{episodeId}`, typed
    `Hono<PublicEnv>` and mounting `optionalIdentity`.
  - `channelRoutes` — everything else, typed `Hono<AppEnv>`, unchanged.
- 4.2 `index.ts` registers, with a comment that says why the order is what it is:

  ```
  CORS → /health, /openapi.json, /docs → /auth/*, /session/*
       → channelFeedRoutes  (guarded per-route; first so /{id} cannot swallow /feed)
       → channelPublicRoutes, episodeRoutes  (optionalIdentity)
       → requireIdentity
       → /me, /catalog, /channels (the rest), /follows, /digest, /chats, /preferences
  ```

- 4.3 The five handlers learn anonymity. Each already has the shape; what changes is that the caller's half is
  skipped rather than computed:
  - `GET /channels` — no `activeChannelIds` call, `following: false` for every row, `management: false`.
    `followerCount` is computed as today: a fact about the channel, not about any reader. `?scope=all` is
    honoured signed out, per the owner's decision.
  - `GET /channels/{id}` — the same through `fullChannel`, which takes the identity as an argument instead of
    reading it off the context.
  - the three episode reads — `eligible` is the empty set, so `relatedScope: []` already yields `related: []`
    (`do/registry/episodes.ts:814` skips the title lookup when the scope is empty), `read` is never computed, the
    User DO is never addressed, and `processing: false`. `waitReason`, `status`, `skipReason` and the summary are
    untouched: `waitReason` is already the reader-safe projection (PRD §4.2 rule 11).
- 4.4 `lib/openapi.ts`: `errorResponses` gains `public?: boolean`, which omits the `401` entry; `400` stays. The
  five operations pass it and carry `security: []`.
- 4.5 `openapi.test.ts`: `PUBLIC` becomes **method-qualified** and grows from four to nine. It cannot stay keyed
  by path — `/channels` now holds a public `GET` and a guarded `POST`, and a path-keyed set would demand
  `security: []` on the `POST` too. Criterion 10.
- 4.6 New `test/visibility.test.ts` — criteria 1–6, every case sending **no** `Authorization` header, plus one
  sending a garbage one (criterion 6 and 13). This is the file the spec's §4.2 warning is about: a test that
  always sends a token proves nothing here.
- 4.7 **The guard sweep**, criterion 11, and the regression the split could cause. Both read `app.routes` the way
  `openapi.test.ts` already does, so neither is a list anybody maintains:
  - every registered route that is not public and not hidden, called with no token, answers `401` — `requireIdentity`
    runs before validation, so any method and any placeholder param is enough;
  - `GET /channels/feed` answers the feed with a token and `401` without one (criterion 12).

**`wrangler dev` walkthrough** (CLAUDE.md), against a real approved channel with at least one summary:
`curl` each of the five with no header and confirm the four omissions; `curl` one with the web's own token and
confirm all four return; `curl /channels/feed?channelId=…` both ways; `curl /catalog` as a non-owner and confirm
`403`. Then click through the web signed in as the owner — Queue, a summary, Sources, a channel, Curate — and
confirm nothing moved.

**Criteria:** 1, 2, 3, 4, 5, 6, 10, 11, 12, 13.

---

### Step 5 — The documents  (size: S) — done

Spec §8, and the spec's own status.

- `docs/PRD.md` §7 target contract — the opening paragraph ("All endpoints except …") gains the five; the
  sentence **"the API returns the same representation to every identity"** is replaced by §4.3's table; the "Who"
  column changes on seven rows (`/catalog` and `/channels/{id}/followers` to owner, the five to public).
- `docs/PRD.md` §8 second criterion — the follower-list carve-out is withdrawn, leaving "users cannot inspect
  another user's chats, messages, preferences, or read receipts" with no exception. Struck through rather than
  deleted, as §8's other reversals are.
- `docs/PRD.md` §8 — criteria 1–13 join the section M6 will sweep.
- `docs/PRD.md` §9 — one entry: what the route-by-route review decided, that it reversed §7's one-representation
  rule and §2's follower exception, and the five answers of 2026-09-21 above, including that `reviewNote` is
  world-readable by decision.
- `docs/PRD.md` §7 Screens — the Sources and Reading entries note that their data is public while the screens are
  not, and point at the landing page as the iteration that will spend it.
- `AGENTS.md` → Identity plumbing — `optionalIdentity` beside `requireIdentity` and `requireOwner`, with the rule
  that a rejected *or malformed* token on a public route is anonymous rather than refused, and the registration
  order of `index.ts` with the `/channels/feed` hazard named. This is the section that stops the next agent
  re-deriving Risks 1 the hard way.
- `docs/specs/route-visibility.md` — status to implemented, with the commits; §7's TODO(owner) updated: the
  public-web question is **answered in principle** (a landing page is coming) and open in detail.

---

## Risks

1. **`GET /channels/feed` is swallowed by the public `GET /channels/{id}`.** The highest-probability way this
   change breaks something that works today, and it would not be caught by any existing test. `ChannelParamsSchema`
   validates `id` as `z.string().min(1)`, so `feed` passes validation and reaches `requireChannel`, which answers
   `404 channel not found`. **Probed against the installed Hono, not assumed:** with a public `/channels/:id`
   registered first, `GET /channels/feed` returned the `/:id` handler's answer; with the feed route registered
   ahead of it, both routes answered correctly and the guard still ran on everything else. Mitigated by 4.1/4.2
   and tested by 4.7.
2. **A route silently loses its guard.** Splitting a router and re-registering it is exactly the edit that drops
   something above the middleware by mistake. Mitigated by the sweep in 4.7, which enumerates `app.routes` rather
   than a list a human keeps.
3. **`getSession` on a malformed token.** `requireIdentity` today turns any falsy result into `401`; if the call
   *throws* on a garbage header, a public route would answer `500` where the spec says anonymous. Handled in 3.2
   and asserted in 4.6.
4. **`c.var.user` on a public route.** An anonymous request must never address a User DO. `PublicEnv` makes it a
   type error rather than a runtime one.
5. **An omitted field reads as missing data.** Spec §5 names this: a bug where `management` is absent for a
   signed-in caller looks like an empty column, not an error. Criterion 5 is the test that would catch it, and
   step 2.5's fallbacks are deliberately the existing "—" and "never" copy rather than anything new, so a real
   absence looks like the thing it is.
6. **The summaries become scrapeable, and nothing is rate limited.** Accepted in spec §5, named not closed. Worth
   restating when the landing page is specced, since that is what will make the URLs findable.

## What this leaves open

1. **The landing page** — the only item with a forcing function. Until a signed-out visitor can reach a screen, all
   of step 4 is correct, tested and invisible. It inherits three decisions the API already allows but does not make:
   which statuses it presents, whether a withdrawn channel is browsable there, and what a visitor sees where a reader
   sees `management`/`processing` (step 2.5's fallbacks already answer the last one).
2. **The `?status=` filter** and the ordering question that lapsed with it (plan decision 1).
3. **Rate limiting and caching** for the public reads — named in spec §5, not closed. The exposure is read bandwidth
   rather than spend: nothing paid is reachable anonymously, since `/channels/feed`, retry and chat all still need a
   session and `/catalog`, the only route that touched the transcript provider, is now the owner's.
4. **CORS** (plan decision 3), which the landing page will force.
5. **`AttentionList.tsx:45,48`** (plan decision 2), and **`CurateChannel.tsx`'s Followers section** — the owner
   decided on 2026-09-21 to always list the addresses whatever the channel's status, deferred until this plan was
   finished. Both carry `TODO(owner):` markers.
6. **The browser click-through** of the five screens that render `management` or `processing`.

## Plan decisions

1. **The `?status=` filter is deferred, and `?scope=all` stays exactly as it is.** It was proposed to make the
   anonymous rule an intersection — "the statuses you asked for, intersected with the statuses you may see" — and
   the owner's decision that a signed-out caller sees all three removed the thing to intersect. What remains is a
   real but unrelated API improvement (the review queue in one read; `all` stops being a magic word). Deferring
   keeps this change purely additive: **no existing caller's response changes shape at all.** It also lapses the
   ordering decision, since `GET /channels` keeps two statements and therefore two orders — title for the default
   scope, `created_at DESC` for `all`. Revisit both with the landing page, which will want its own sort anyway.
2. **A `TODO(owner)` goes on `AttentionList.tsx:45,48`.** Those two lists — failed, never-started — are `.filter()`
   with no sort, so they render in whatever order the API returned. That is inherited, not chosen, and it is the
   one thing the ordering conversation turned up that outlives the deferral.
3. **CORS is untouched.** The five routes stay behind the `WEB_ORIGINS` allowlist, so they are public to `curl`
   and not to another origin's JavaScript. Nothing needs cross-origin reads until the landing page exists, and
   opening it then is one line in `lib/cors.ts`. Public means "no session required", not "embeddable anywhere".
4. **Three routers for `/channels`, not a per-route guard.** The alternative — registering the whole router above
   `requireIdentity` and mounting the guard on each of the other fifteen routes — makes forgetting one the default
   failure mode. Three registrations in one place, with the sweep test behind them, keeps "guarded unless
   deliberately not" as the rule.
5. **`management` and `processing` are required booleans on the view types**, not optional ones. Twelve call sites
   have to state the decision; none can inherit it.
6. **`PublicEnv` beside `AppEnv`, rather than making `identity` optional everywhere.** The latter would touch ~30
   guarded handlers to say something none of them means.
