# Feature spec — The Registry re-key: email to a generated `user_id`

**Written:** 2026-09-20, against `main` at `8b707a0`. A child spec of the Auth phase; roadmap
`docs/specs/auth-phase-plan.md`.
**Parent:** `docs/specs/auth-phase.md` §4.3 (the re-key), §4.4 (owner seeding), decisions 4 and 5; PRD §2, §5.1,
§5.4. Parent acceptance criteria 8, 16, 18, 22, 23 and 24.
**Replaces:** the parent plan's chunks **A2 and A3**, which are withdrawn as separate chunks and delivered here as
nine steps. A4–A9 keep their labels, so nothing downstream is renumbered.
**Status:** **implemented 2026-09-20** on `main` in seven commits (`ac28569`…`82d294f`), `pnpm check` green
at each, 395 tests, and the `wrangler dev` walkthrough recorded in the plan. One open item is carried out of
the chunk and is not the re-key: chat retrieval returned no sources while the dev Vectorize index had not
processed the new vectors — the plan's walkthrough section states the evidence.

## 1. Summary

The Registry stops being keyed by email address and starts being keyed by a `user_id` it generates. Five columns
move, the User DO's name moves with them, and `email` demotes to a nullable unique attribute. `auth_user_id` is
added and left null for everyone — better-auth does not exist until A4, and nothing reads that column until A7.

**Nothing else changes.** The product still runs on `X-User-Email`, still says "Who is this for?", still enforces
no authorization. When this chunk is done the only observable difference is that `/me` also returns a `userId`.

## 2. Why one chunk and not two

The parent plan split this in half: A2 moved the schema while callers still passed email, A3 moved the callers.
That seam is wrong, and its own plan said so without noticing — A2 step 2.4 recorded a **plan decision** that
`followers.ts` and the three audit writers would "resolve email → `user_id` internally" in A2 and take `user_id`
in A3. That resolution code exists only to be deleted one chunk later. It is written, reviewed, tested and thrown
away, and while it exists every follower write does a lookup the finished design does not need.

**The better seam is by table, not by layer**, and one property of the schema makes it available:
**`email` stays `UNIQUE` on `global_users`**. SQLite foreign keys may reference any unique column, not only the
primary key, so `channel_followers.user_email REFERENCES global_users (email)` remains valid after `user_id`
becomes the primary key. Every table that points at an identity therefore keeps working while the others move, and
each one can be converted **column, module and callers together, once**, with `pnpm check` green at every step.

Two consequences worth stating. There is no half-migrated module at any point, so a reviewer reading one step sees
one table's whole story. And **no `/clean-local` is needed inside this chunk**: tests run on in-memory storage
(`apps/api/test/setup.ts`), and local dev storage was wiped on 2026-09-20 and stays empty unless `pnpm dev` runs.
One wipe is owed at the end only if it did.

## 3. Decisions this spec makes

1. **One chunk, nine steps, each S or M**, replacing A2 and A3. Owner instruction 2026-09-20.
2. **Converted by table, not by layer.** Each step takes one identity-bearing table from email to `user_id`
   together with its module and its callers. No module changes signature twice.
3. **`email` stays `UNIQUE`,** which is what makes step-by-step possible, and is independently required by parent
   decision 5 so the schema enforces one-person-one-email.
4. **`user_id` is `crypto.randomUUID()`**, the generator already used for run, attempt, generation, chat and
   message ids. No new dependency, no new convention.
5. **`auth_user_id` lands in step 1 and stays null.** Adding it later would be a second in-place migration edit for
   one nullable column; adding it now costs nothing and A7 finds it waiting.
6. **The audit columns store `user_id` and the views resolve the email for display.** A row records who acted; what
   a screen prints is a lookup, not a copy, so an address that changes cannot leave a stale one behind in history.

## 4. Contract

### 4.1 The five schema sites

All in `apps/api/migrations/registry/0001_init.sql`, edited in place under PRD §5.4.

| Table | From | To |
|---|---|---|
| `global_users` | `email TEXT PRIMARY KEY` | `user_id TEXT PRIMARY KEY`, `email TEXT UNIQUE` (nullable), `auth_user_id TEXT UNIQUE` (nullable) |
| `channel_followers` | `user_email` in the composite PK, the FK and `channel_followers_user_email_unfollowed_at` | `user_id`, and the index renamed to match |
| `channels` | `reviewed_by_email` + its CHECK | `reviewed_by_user_id` |
| `episodes` | `skipped_by_email` + its CHECK | `skipped_by_user_id` |
| `episode_ingestion_attempts` | `requested_by_email` + its CHECK | `requested_by_user_id` |

`0002_episode_duration.sql` adds `episodes.duration_sec` and touches nothing here; it replays unchanged.

### 4.2 Identity, minted and seeded

`ensureUser(sql, email, now)` keeps its shape and its insert-or-touch semantics, with `ON CONFLICT (email)`
still the conflict target because `email` is still unique. On insert it mints a `user_id`. `getUser` gains a
by-`user_id` form alongside the by-email one.

`seedOwner` is **unchanged in behaviour** and keeps running at DO start: it mints a `user_id` for `OWNER_EMAIL`
with `role = 'owner'` and `auth_user_id` null, promoting an existing row rather than creating a second. The parent
spec's earlier claim that seeding would have to invert is already withdrawn in its §4.4 — generating our own id is
what makes that unnecessary, and a fresh deployment still has an owner from the first request.

### 4.3 The User DO's name

`getUserDO(env, userId)` names the object by `user_id`. Its docstring currently says the email "is implicit in the
object's name and is never stored or logged here"; after this that is literally true, and the object holding every
chat and read receipt carries no address in its name. `middleware/user.ts` still reads `X-User-Email`, still calls
`ensureUser`, and now passes `identity.userId` to `getUserDO`.

### 4.4 What the API exposes

`MeResponse` gains `userId`. `FollowersResponse` carries `userId` alongside `email`, because the Owner screens
list followers by address and the address is now a lookup. No route is added, removed, or given a new verb.

## 5. Acceptance criteria

1. `global_users.user_id` is generated by the Registry and is never a value any caller supplied.
2. The Registry admits at most one row per non-null `email`, and any number with null.
3. The Registry admits at most one row per non-null `auth_user_id`, and any number with null.
4. `seedOwner` promotes an existing `OWNER_EMAIL` row rather than creating a second, and never demotes.
5. Migrations apply idempotently on a fresh Registry DO, and every re-keyed CHECK still rejects what it rejected
   before: an approved channel with no `approved_at`, a paused channel that is not approved, a skipped episode
   with no reason, an owner skip with no actor.
6. A follow, an unfollow and a refollow all resolve to one `channel_followers` row keyed by `user_id`.
7. Eligibility, `following`, `followerCount` and the owner's follower list still agree, from the one Registry join.
8. Approve, decline, skip and owner retry each record the acting `user_id`, and the Owner screens still print that
   person's email.
9. The User DO is addressed by `user_id`, and a caller's chats, receipts and preferences are the ones that
   identity owned before the re-key.
10. `GET /me` returns `userId`, `email` and `role`.
11. `X-User-Email` still works exactly as before, and the product runs unchanged under `wrangler dev`.

## 6. Out of scope

better-auth, D1, sessions, bearer tokens, the handoff, `403`s, and anything the web renders. `auth_user_id` is
created here and **written by nobody** until A7. The header stays; it is deleted in A7 and not before.

## 7. `AGENTS.md` and PRD alignment

- **PRD §5.1** — the five re-keyed columns and the nullable unique `email` and `auth_user_id`. Lands with step 8.
- **PRD §5.4** — records this in-place edit of `0001_init.sql`, after the 2026-09-13 one its header carries.
- **`AGENTS.md` hard rule 3** — "user emails are never namespaces" becomes "user identifiers are never
  namespaces". Unchanged in force; `lib/vectorize.ts` is not touched.
- **`AGENTS.md` → Identity plumbing** — the line describing `env.USER_DO.idFromName(email)` becomes the `user_id`.
- PRD §2's identity paragraph already describes the destination, amended by A1, and needs nothing further.
