# Implementation plan — The Registry re-key

**Implements:** `docs/specs/auth-2-registry-rekey.md` under `AGENTS.md`; parent `docs/specs/auth-phase.md`;
roadmap `docs/specs/auth-phase-plan.md`. Replaces that roadmap's chunks **A2 and A3**; A4–A9 keep their labels.
**Written:** 2026-09-20, against `main` at `8b707a0`.
**Status:** **complete 2026-09-20** on `main`, nine steps in seven commits (`ac28569`, `82ac3f7`, `4f67d43`, `da509ca`, `b4dfcba`, `f6c27a5`, `82d294f`), `pnpm check` green at each, 395 tests. The step 9 walkthrough ran against a real channel under `pnpm dev`; its record and one open item are below.
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

Run 2026-09-20 under `pnpm dev` against a real channel (`UCLtTf_uKt0Itd0NG7txrwXA`), on `X-User-Email`, with
better-auth nowhere in the picture.

| What was exercised | Result |
|---|---|
| Add + approve a channel | approved; the CHECK requires `reviewed_by_user_id` non-null, so the foreign key and the constraint both accepted a generated id |
| Initial discovery | one `initial` run, feed `read`, **5 episodes** — the §4.2 default |
| Ingestion | **5 available**, 0 pending, 0 failed, 0 skipped, one attempt each |
| A summary | structured, six takeaways |
| `GET /me` | `role: owner` — `seedOwner` promoted the **generated-id** row, criterion 4 in the live environment |
| Follows | following, `unreadCount: 5` |
| Read receipt | `POST …/read` → 200, reads back `true`: the **id-named User DO**, criterion 9 |
| Followers | **two identities**, distinct `user_id`s, addresses resolved by join, criterion 7 |
| Channel management | `reviewedByEmail` resolved from `reviewed_by_user_id`, criterion 8 |
| `GET /digest` | 5 episodes — eligibility by `user_id`, criterion 6 |
| Ask a question | replied, stored with its scope — but **no sources**; see below |

**Two followers of one channel with independent receipts is PRD §8's first criterion**, the one the M6 audit found
untested, observed live.

### Open item, carried out of this chunk

**Chat retrieval returned no sources** — "Nothing in this episode covers that", scoped and unscoped. It is **not
the re-key**, and the evidence is specific rather than a shrug:

- `GET /digest` returns all five episodes, and it reads eligibility through the same
  `listEligibleChannels(userId)` this chunk re-keyed. Eligibility is correct.
- `media-rag-dev` holds 347 vectors, and it was verified empty earlier the same day, so these writes landed.
- `pnpm verify:vectorize` passes: `channelId` and `episodeId` metadata indexes both present. That script exists
  for exactly this symptom — a filter on a property with no metadata index returns zero matches and produces this
  precise reply — and it rules that cause out.
- The index's `processedUpToDatetime` is **01:14:21**, while the five episodes published between **01:15:36** and
  **01:16:27**. Every chunk was written after the watermark, and it had not advanced twelve minutes later.

The likeliest reading is that the dev index has accepted the vectors (they are counted) but has not finished
processing them (they are not yet queryable) — `docs/specs/…`/memory records dev writes becoming readable in
10–80 s, and this is longer. **Re-check before A4**, and if it is still empty once the watermark passes the
publishes, it is a retrieval or generation-activation question for M3/M4 code this chunk never touched.

## Record

- **Step 1.** `getUser` did not gain a by-`user_id` form: nothing calls one. Steps 3–5 needed a *batched* lookup
  instead, which is `users.emailsByIds`.
- **Step 2.** The facade takes a `user_id`, not an address — reversed mid-step after starting the other way. An
  email-addressed facade works today and breaks at A7, when a person may have no address and must still be able
  to follow a channel. `recordFollow` therefore stopped auto-registering; the foreign key refuses an unknown id,
  which `registry-migrations` already asserted.
- **Step 3.** The plan said `channel-view.ts` would resolve the reviewer's address. It cannot: it is a pure
  projection with no SQL. Resolution belongs in `catalog.withManagement`, which already gathers every other
  channel fact in grouped queries. Same correction applied to step 4 in `episodes.ts`.
- **Step 3.** A `FOREIGN KEY` assertion was added at the approve path and then removed: it duplicated
  `registry-migrations`, and the RPC stub surfaces such a rejection twice, so `.rejects` consumed one and Vitest
  failed the run on the other.
- **Steps 4 and 5.** The fixtures, not the production paths, carried the blast radius: `seedEpisode` writing the
  old column failed 110 tests at once, `seedAttempt` 16.
- **Step 5.** `.map(attempts.toAttempt)` broke when the mapper gained a leading `sql` parameter — the hazard of
  point-free style over a signature you do not own. And an `await` inside a synchronous `inRegistry` callback
  fails a file at parse time, reported as one failing test in a file of twenty-six.
- **Step 6.** `apps/api/src/do/user.ts` no longer imports `lib/email` at all. Criterion 9 got no new test:
  `user-reads` and `user-chats` already assert receipts and chats stay with their owner, now against id-named
  objects, and `registry-users` asserts one address resolves to one id.
- **Step 7.** `apps/api` compiles against `packages/shared`'s **build output**, so a schema change needs
  `pnpm --filter @media-digest/shared build` before the API typechecks.
- **Step 8.** The plan named three document sites; there were fifteen. Two were already stale before this chunk:
  PRD §3's stack table still described the User DO by address, and §5.4 claimed "The Registry lists `0001_init`
  alone" after `0002_episode_duration` landed on 2026-09-14.
- **No `/clean-local` was needed**, as the chunk predicted: dev was wiped before it began and the migration was
  edited five times with nothing to clear.

## Record

Decisions made while implementing, by theme, added as they happen.
