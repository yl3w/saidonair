# Feature spec — Route visibility: a public catalog, and two reads that are the owner's

**Written:** 2026-09-21, against `main` at `5d9f234`.
**Status:** **IMPLEMENTED 2026-09-21** in five steps (`dea8705`, `0550f95`, `4ad7e4a`, + this), 417 tests, exercised
under `wrangler dev` against the real local catalog. The plan is `route-visibility-plan.md`; five questions it left
open were settled in review and are recorded there and in PRD §9. **Not part of the Auth phase**, which owns authentication (A7) and
the owner's write operations (A8); this is the read side, and it is a product decision about what the world can
see rather than a continuation of either.
**PRD:** §2 (who may do what), §7 (the screens and the target contract — **reversed here**), §8 (whose second
criterion carries the privacy exception this withdraws), §9.
**Depends on:** the Auth phase through A8. A caller either has a verified session or does not, and that
distinction is what this spec spends.

## 1. Summary

Every route behind identity was reviewed one at a time with the owner on 2026-09-21. Twenty-four stay as they
are. **Seven move**, in both directions:

| Route | From | To |
|---|---|---|
| `GET /catalog` | any identity | **owner** |
| `GET /channels/{id}/followers` | any identity | **owner** |
| `GET /channels` | any identity | **public**, richer when signed in |
| `GET /channels/{id}` | any identity | **public**, richer when signed in |
| `GET /channels/{id}/episodes` | any identity | **public** |
| `GET /channels/{id}/episodes/{episodeId}` | any identity | **public** |
| `GET /episodes/{episodeId}` | any identity | **public** |

The two moves to owner are one middleware each. The five to public are the work: they introduce a visibility the
codebase does not have — **public, but richer when signed in** — and they reverse a standing promise in §7.

## 2. Why this shape

### 2.1 What the review found

The two moves to owner close things that were open for reasons that no longer hold.

**`GET /catalog`** is an operations dashboard: counts by status, an `attention` block naming what needs the owner,
and the transcript provider's health including **`remainingCredits`** — a third party's billing state about the
owner's account, served to anyone signed in. Only the owner's Settings screen renders it.

**`GET /channels/{id}/followers`** hands one reader another reader's **email address**. PRD **§8's second
criterion** names this the one deliberate exception to privacy — in the same sentence that promises users cannot
inspect each other's data — and that carve-out was written on 2026-09-10, when identity was a self-asserted
header and "private" meant almost nothing. Authentication changed what a reader may reasonably expect: a list of
who reads what is not something they would expect a stranger to browse. §8's second criterion — which A8 finally
tested — says a caller cannot inspect another user's data, and this was the standing exception to it.

The five moves to public are the opposite kind of decision: the catalog and the summaries become readable without
signing in, so the product can be seen before it is joined.

### 2.2 The three visibilities, and why the middle one is new

| | Session | Answers |
|---|---|---|
| **public** | none needed | the same to everyone, or **less** to an anonymous caller |
| **any identity** | required | scoped to the caller by construction |
| **owner** | required, and `role = 'owner'` | `403` otherwise |

"Public" here does not mean "the same to everyone". Four fields on the five public routes exist only because
somebody is asking, and an anonymous caller must simply not receive them. That is the new thing: **a response
whose shape depends on whether a session was presented**, which the codebase has never done and §7 currently
forbids.

### 2.3 The sentence this reverses

PRD §7: *"the API returns the same representation to every identity."* It is load-bearing — it is the reason the
`management` block was safe to send to every caller, and the reason the Owner screens are described as the web's
rendering rather than the API's. After this spec it is false for five routes, and the replacement rule has to be
stated as precisely as the one it replaces (§4.3).

### 2.4 The thing this does not do by itself

**Nothing a reader can see changes until the web changes too.** Every web screen sits behind the session guard,
so a public `GET /channels` is latent capability: correct, tested, and invisible. It becomes a feature when the
web gains a screen a signed-out visitor can reach, or when a link to one is shared. That is a separate decision
and this spec does not make it — see §7.

## 3. Decisions this spec makes

All from the route-by-route review of 2026-09-21 unless stated.

1. **`GET /catalog` is the owner's.** Its `attention` block and the provider's credit balance are operational.
2. **`GET /channels/{id}/followers` is the owner's**, and §8's privacy exception is withdrawn with it. The
   criterion then says what it always meant: a caller cannot inspect another user's data, with no carve-out.
3. **The channel list and detail are public**, and carry `management` **whenever there is a session** — any
   identity, not only the owner. An anonymous caller does not receive it.
4. **The three episode reads are public.** The summaries are the product, and they can be read before joining.
5. **`processing` follows the same rule as `management`**: present with a session, omitted without one. It
   carries attempt outcomes, failure detail and provider codes, which are operational rather than reader-facing.
   *(Assumed by the spec author from decision 3's reasoning and confirmed by the owner in review.)*
6. **Everything else stays**, including `GET /channels/feed` at any identity — it is the one catalog route that
   makes an outbound request per call, so public would make it an unmetered proxy to YouTube's feed endpoint.
7. **No rate limiting is added.** It is named as a gap rather than closed (§5).

## 4. Contract

### 4.1 `optionalIdentity`

A second middleware beside `requireIdentity`, in `apps/api/src/middleware/user.ts`:

- With a valid bearer token it does exactly what `requireIdentity` does — resolves the session, calls
  `ensureIdentity`, and sets `identity`, `registry` and `user` on the context.
- **With no token, or one the API does not accept, it continues anyway**, setting `registry` alone.
  `c.var.identity` is `undefined`.
- It never answers `401`. A route that mounts it has decided that anonymity is allowed.

A rejected token and an absent one are treated alike: a caller presenting a stale token to a public route gets
the anonymous view rather than an error, because the alternative is a reader whose session quietly expired being
told a public page is forbidden.

### 4.2 Where each route mounts

`index.ts` registers in order: CORS, the public routes, `/auth/*` and `/session/*`, then `requireIdentity`, then
everything else. The five public reads move **above** `requireIdentity` and mount `optionalIdentity` themselves.
`GET /catalog` and `GET /channels/{id}/followers` stay below it and gain `requireOwner`.

This ordering is the whole mechanism, and it is easy to get wrong in a way tests would not catch if they only
ever send a token: **every public route needs a test that sends none.**

### 4.3 What degrades, exactly

The replacement for §7's one-representation rule. On the five public routes, with no session:

| Field | Anonymous | Reason |
|---|---|---|
| `management` | **omitted** | who reviewed, the note, pause reason, last feed check, latest run — operational |
| `processing` | **omitted** | attempt outcomes, failure detail, provider codes — operational |
| `following` | **`false`** | there is nobody for it to be true of |
| `followerCount` | present | a fact about the channel, not about any reader |
| `read` | **absent** | already absent for an ineligible caller; unchanged in kind |
| `related` | **`[]`** | related titles are filtered to the caller's eligible channels, and an anonymous caller has none |
| everything else | present | title, status, paused, counts, the summary, `waitReason`, `skipReason` |

`waitReason` stays because it is already the reader-safe projection of an attempt (PRD §4.2 rule 11) — the one
piece of processing designed to be shown.

**These are two shapes of one schema, not two schemas.** `management` and `processing` become optional on
`Channel` and `Episode` in `packages/shared`, which makes them optional for *every* caller at the type level;
the API document says which routes can omit them, and the tests say when.

### 4.4 The two owner moves

`GET /catalog` and `GET /channels/{id}/followers` gain `requireOwner` and `errorResponses({ owner: true })`. The
owner surface grows from seven operations to nine, and `openapi.test.ts`'s `OWNER_ONLY` set grows with it — that
set exists so a route joining or leaving the surface is a deliberate edit.

`FollowersResponse` is unchanged: the owner still sees addresses.

### 4.5 The API document

The five public operations carry `security: []`, like `/health` and `/session/*`, and `openapi.test.ts`'s
`PUBLIC` set grows from four paths to nine. They keep their `400` and lose their `401`, since a missing session
is no longer an error on them.

### 4.6 The web

Unchanged by this spec. `api.ts` sends the token it holds, which is still correct: a signed-in reader gets the
richer shape without asking. The screens stay behind the guard until §7's open question is answered.

## 5. The consequences to accept

- **The summaries become scrapeable.** They cost DownSub credits and Workers AI neurons to produce, and anyone
  who finds the URL can read them without signing in. That is the point of the decision, and it is worth naming
  as a cost rather than discovering later.
- **There is no rate limit anywhere.** Public reads make that matter more: an anonymous caller can page the
  catalog as fast as they like. Nothing paid is reachable anonymously — `/channels/feed`, retry and chat all
  still need a session — so the exposure is read bandwidth, not spend. **Named, not closed.**
- **Two shapes for one schema.** Any client reading `management` or `processing` must treat them as optional,
  and a bug where one is omitted for a signed-in caller would look like missing data rather than an error.
- **§8's privacy exception is withdrawn**, which is a promise reversed in the reader's favour but a reversal
  nonetheless, and §7's one-representation rule goes with it.

## 6. Acceptance criteria

1. With no `Authorization` header, all five public routes answer `200`.
2. With no session, `management` is absent from the channel list and the channel detail.
3. With no session, `processing` is absent from every episode shape, and `waitReason`, `status` and `skipReason`
   are present.
4. With no session, `following` is `false`, `followerCount` is unchanged, `read` is absent and `related` is `[]`.
5. With **any** session, all four reappear — `management` is not owner-only.
6. A **stale or invalid** token on a public route gets the anonymous view, not a `401`.
7. `GET /catalog` answers `403 FORBIDDEN` for a signed-in non-owner, and `200` for the owner.
8. `GET /channels/{id}/followers` answers `403` for a signed-in non-owner, and still returns addresses to the
   owner.
9. Neither owner move writes anything on refusal — they are reads, so this is trivially true and asserted once.
10. `GET /openapi.json` marks exactly nine operations public and exactly nine owner-only, and both sets are
    listed in `openapi.test.ts` rather than counted.
11. Every route that is not public still answers `401` without a session — the public five are the only
    additions, and no route lost its guard by accident.

## 7. Out of scope, and one open question

Rate limiting. Caching or CDN rules for the public reads. Any change to the web.

**~~TODO(owner): does a public catalog imply a public web?~~ — ANSWERED and BUILT 2026-09-21, the same day
(`docs/specs/public-reading.md`). Yes: the landing page, a channel and a summary render without a session, at
these routes. The detail below was the question, and the spec answers each part of it — with one correction, that
`/sources` is *not* among the public screens, because signed out it repeated the landing page.** The
owner's answer in review: **yes, a landing page is coming** — channel → episodes → summaries, readable signed out —
as a future iteration, and these five routes are its API. What it still needs is the shape: which statuses it
presents (the API answers all three), whether a withdrawn channel is browsable there, the shell, the nav and the
sign-in affordance for a reader who is not signed in. The API change is inert until a signed-out visitor can
reach a screen. Making `/sources` and `/read/:episodeId` public in the web would turn this into a visible
feature — a shareable summary, a browsable catalog, a reason to sign up — and would need the shell, the nav and
the sign-in affordance designed for a reader who is not signed in (`docs/design.md`). That is a Design-phase-sized
question and it is not answered here.

## 8. `AGENTS.md` and PRD alignment

- **§2** — the paragraph on where follow membership lives stays true; it describes the Registry's shape, not
  who may read it. Nothing to change.
- **§8, second criterion** — the follower-list carve-out is withdrawn, leaving "users cannot inspect another
  user's chats, messages, preferences, or read receipts" without an exception.
- **§7 target contract** — "the API returns the same representation to every identity" is replaced by §4.3's
  table, and the list of routes needing a session gains the five exceptions.
- **§7 screens** — the Sources and Reading entries note that their data is public while the screens are not.
- **§8** — criteria 1–11 above join the section M6 will sweep.
- **§9** — one entry: what the route-by-route review decided, and that it reversed §7's one-representation rule
  and §2's follower exception.
- **`AGENTS.md`** — the Identity plumbing section gains `optionalIdentity` beside `requireIdentity` and
  `requireOwner`, with the rule that a rejected token on a public route is anonymous rather than refused.
