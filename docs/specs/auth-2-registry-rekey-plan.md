# Implementation plan — The Registry re-key

**Implements:** `docs/specs/auth-2-registry-rekey.md` under `AGENTS.md`; parent `docs/specs/auth-phase.md`;
roadmap `docs/specs/auth-phase-plan.md`. Replaces that roadmap's chunks **A2 and A3**; A4–A9 keep their labels.
**Written:** 2026-09-20, against `main` at `8b707a0`.
**Status:** awaiting owner approval.
**Shape:** nine steps, every one **S or M**, each one commit when the owner asks with `pnpm check` green.
Decisions this plan makes are marked **plan decision** and stand unless vetoed.

**The invariant that makes the steps small:** `email` stays `UNIQUE` on `global_users`, and SQLite foreign keys may
reference any unique column. So every `REFERENCES global_users (email)` survives step 1 and each table converts on
its own, module and callers together, with the suite green after each. Check that before moving work between steps.

**No `/clean-local` inside this chunk.** Tests use in-memory storage (`apps/api/test/setup.ts`) and local dev
storage was wiped on 2026-09-20. Step 9 owes one wipe only if `pnpm dev` ran in the meantime.

## Definition of complete

Spec §5, all eleven criteria.

### Step 1 — `global_users` re-keyed  (size: M)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `apps/api/src/do/registry/users.ts`,
`apps/api/src/do/registry/types.ts`, `apps/api/test/registry-users.test.ts`,
`apps/api/test/registry-migrations.test.ts`.

- 1.1 `global_users` becomes `user_id TEXT PRIMARY KEY`, `email TEXT UNIQUE` (nullable),
  `auth_user_id TEXT UNIQUE` (nullable), with `role`, `last_seen_at` and `created_at` unchanged. The file's header
  comment gains the 2026-09-20 edit line, as the 2026-09-13 one did.
- 1.2 **Every other table is left alone this step.** `channel_followers.user_email`, `reviewed_by_email`,
  `skipped_by_email` and `requested_by_email` still say `REFERENCES global_users (email)` and still work, because
  `email` is still unique. This is the step to verify that claim rather than assume it.
- 1.3 `users.ts`: `ensureUser` mints `crypto.randomUUID()` on insert, keeps `ON CONFLICT (email) DO UPDATE SET
  last_seen_at`, and returns the row. `getUser` gains a by-`user_id` form beside the by-email one. `seedOwner`
  mints an id and is otherwise unchanged.
- 1.4 `types.ts`: `RegistryUser` gains `userId: string` and `authUserId: string | null`.

**Tests:** spec §5 criteria 1–5.
**Done when:** `pnpm check` green.

### Step 2 — `channel_followers`  (size: S)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `apps/api/src/do/registry/followers.ts`,
`apps/api/src/do/registry.ts`, `apps/api/src/lib/eligibility.ts`, `apps/api/src/routes/follows.ts`,
`apps/api/src/routes/channels.ts`, `apps/api/test/registry-followers.test.ts`,
`apps/api/test/routes-follows-digest.test.ts`.

- 2.1 `user_email` → `user_id` in the composite primary key and the foreign key;
  `channel_followers_user_email_unfollowed_at` → `channel_followers_user_id_unfollowed_at`.
- 2.2 `followers.ts` takes `user_id` — **once**, not email now and id later.
- 2.3 The facade, eligibility, and the two routes that follow and unfollow pass `identity.userId`.

**Tests:** spec §5 criteria 6 and 7.
**Done when:** `pnpm check` green.

### Step 3 — `channels.reviewed_by_email`  (size: S)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `apps/api/src/do/registry/channels.ts`,
`apps/api/src/lib/channel-view.ts`, `apps/api/src/routes/channels.ts`,
`apps/api/test/registry-channels.test.ts`, `apps/api/test/routes-channels.test.ts`.

- 3.1 `reviewed_by_email` → `reviewed_by_user_id`, and the CHECK that requires it on a reviewed channel.
- 3.2 `channels.ts` records `identity.userId` on approve and decline.
- 3.3 `channel-view.ts` resolves the reviewer's email through `global_users` for display. **Plan decision:** one
  batched lookup per view build, not one per row — the Curate table renders up to fifty.

**Tests:** spec §5 criterion 8, approve and decline halves.
**Done when:** `pnpm check` green.

### Step 4 — `episodes.skipped_by_email`  (size: S)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `apps/api/src/do/registry/episodes.ts`,
`apps/api/src/lib/episode-view.ts`, `apps/api/src/routes/episodes.ts`,
`apps/api/test/registry-episodes.test.ts`, `apps/api/test/routes-channels.test.ts`.

- 4.1 `skipped_by_email` → `skipped_by_user_id`, and the CHECK pairing it with an `OWNER` skip reason.
- 4.2 `episodes.ts` records `identity.userId` on an owner skip.
- 4.3 `episode-view.ts` resolves the skipper's email for display, batched as in step 3.

**Tests:** spec §5 criterion 8, skip half; criterion 5's owner-skip CHECK.
**Done when:** `pnpm check` green.

### Step 5 — `episode_ingestion_attempts.requested_by_email`  (size: S)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `apps/api/src/do/registry/attempts.ts`,
`apps/api/src/do/registry/processing.ts`, `apps/api/src/routes/episodes.ts`,
`apps/api/test/registry-attempts.test.ts`, `apps/api/test/ingestion-attempts.test.ts`.

- 5.1 `requested_by_email` → `requested_by_user_id`, and the CHECK pairing it with `trigger = 'owner_retry'`.
- 5.2 The attempt writers record `identity.userId`; a cron-launched attempt still records none.

**Tests:** spec §5 criteria 5 and 8, retry half.
**Done when:** `pnpm check` green. **The schema is fully re-keyed at this point** — the remaining steps are the
Worker above it.

### Step 6 — The User DO's name  (size: M)

**Files:** `apps/api/src/do/user.ts`, `apps/api/src/middleware/user.ts`, `apps/api/test/helpers.ts`, and the
tests that build an identity.

- 6.1 `getUserDO(env, userId)` names the object by `user_id` and validates it is non-empty rather than an email.
  Its docstring's claim that the email "is implicit in the object's name and is never stored or logged here"
  becomes literally true; say so there.
- 6.2 `middleware/user.ts` still reads `X-User-Email` and still calls `ensureUser`, and now sets `c.var.identity`
  carrying `{ userId, email, role }` and passes `identity.userId` to `getUserDO`.
- 6.3 `helpers.ts` gains a helper that creates an identity and returns its `user_id`, so tests stop spelling the
  email twice.

**Tests:** spec §5 criterion 9 — a caller's chats, receipts and preferences are the ones that identity owned.
**Done when:** `pnpm check` green.

### Step 7 — What the API exposes  (size: S)

**Files:** `packages/shared/src/index.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/channels.ts`,
`apps/api/test/me.test.ts`, `apps/api/test/openapi.test.ts`.

- 7.1 `MeResponse` gains `userId`.
- 7.2 `FollowersResponse` carries `userId` beside `email`.
- 7.3 `openapi.test.ts` sees both, and every response still parses against the shared schemas.

**Tests:** spec §5 criterion 10.
**Done when:** `pnpm check` green.

### Step 8 — Documents  (size: S)

**Files:** `docs/PRD.md`, `AGENTS.md`.

- 8.1 PRD §5.1 rewritten to the re-keyed schema; §5.4 records this in-place edit of `0001_init.sql`.
- 8.2 `AGENTS.md` hard rule 3: "user emails are never namespaces" → "user identifiers are never namespaces".
  `lib/vectorize.ts` is not touched.
- 8.3 `AGENTS.md` → Identity plumbing: `env.USER_DO.idFromName(email)` becomes the `user_id`.
- 8.4 **Sweep, do not just edit.** Grep both documents for `user_email`, `reviewed_by`, `skipped_by`,
  `requested_by`, `idFromName` and "keyed by email" before calling this done. A1 listed four edit sites and there
  were seven; the sweep is the step, not the edits.

**Done when:** `pnpm check` green.

### Step 9 — The gate  (size: S)

- 9.1 If `pnpm dev` ran during this chunk, ask the owner for `/clean-local`; otherwise dev is already empty and
  nothing is owed.
- 9.2 Full `wrangler dev` walkthrough **on the old identity**: add a channel, approve it, discovery runs, an
  episode ingests, read the summary, mark it read, ask a question, and open every Curate screen.
- 9.3 Record it below.

**Tests:** spec §5 criterion 11.
**Done when:** the walkthrough is recorded and `pnpm check` green.

## Walkthrough record

| Step | Date | What was exercised | Result |
|---|---|---|---|
| 9 | | full product on `X-User-Email`, after the re-key | |

## Record

Decisions made while implementing, by theme, added as they happen.
