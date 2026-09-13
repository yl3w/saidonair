# Implementation plan — Follows have one owner

**Implements:** `docs/specs/follows-single-owner.md` under the rules in `AGENTS.md`.
**Written:** 2026-09-13, against `main` at `16949b3`.
**Status:** proposed; awaiting the owner's go. No new dependencies.
**Shape:** three code steps and one documentation step, each one commit ending with `pnpm check` green. Step 1 adds
the Registry side (additive, nothing else changes). Step 2 moves every route onto it (the User DO's follow methods
become unused but still exist, so the gate stays green). Step 3 removes the User DO's follows and edits its `0001`,
after which the owner wipes local state. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §6, all ten criteria. In short: one table holds every follow, every route reads it, the User DO has no follow
table or method, eligibility is one Registry query, the OpenAPI document is unchanged, `pnpm check` is green, and the
`wrangler dev` legs are recorded here.

### Step 1 — The Registry answers a user's follows and eligibility  (size: S)

**Files:** `apps/api/migrations/registry/0001_init.sql`, `apps/api/src/do/registry/followers.ts`,
`apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry.ts`, `apps/api/test/registry-followers.test.ts`,
`apps/api/test/registry-migrations.test.ts`.

- 1.1 `0001_init.sql`: add `CREATE INDEX channel_followers_user_email_unfollowed_at ON channel_followers (user_email,
  unfollowed_at);` after the existing follower index, with a one-line comment (the user's own list and eligibility).
  Edited in place (PRD §5.4).
- 1.2 `types.ts`: add `FollowRecord = { channelId: string; followedAt: number; unfollowedAt: number | null }`.
- 1.3 `followers.ts`: `recordFollow` and `recordUnfollow` return the `FollowRecord` they wrote (the channel they
  returned is fetched by the routes anyway); `recordUnfollow` throws `NOT_FOUND` "channel is not followed" when no row
  exists for the pair and returns the existing row unchanged when it is already a tombstone. New: `listByEmail(sql,
  email)` (active, newest `followed_at` first, then `channel_id`), `activeChannelIds(sql, email)` (sorted), and
  `listEligible(sql, email)` with the join in spec §3, returning `CatalogChannel[]` through `channels.ts`'s row mapper
  (**plan decision:** export `toChannel` from `channels.ts` for it rather than duplicating the column list).
- 1.4 Facade: `recordFollow` and `recordUnfollow` return `FollowRecord`; add `listFollows(email)`,
  `activeChannelIds(email)`, `listEligibleChannels(email)`, each normalising the email with `users.requireEmail` and
  validating ids as the neighbours do.

**Tests:** `registry-followers.test.ts` gains: the returned rows on follow, refollow (new `followedAt`, `unfollowedAt`
null), and unfollow (tombstone); `NOT_FOUND` on unfollowing a never-followed channel and idempotency on a tombstone;
`listFollows` newest first excluding tombstones; `activeChannelIds` sorted; `listEligibleChannels` returning approved
follows only across requested, approved, paused, and declined channels and an unfollowed one. `registry-migrations`
asserts the new index by name in `sqlite_master`. **Done when:** `pnpm check` green.

### Step 2 — Every route reads the Registry  (size: M)

**Files:** `apps/api/src/routes/follows.ts`, `apps/api/src/routes/channels.ts`, `apps/api/src/routes/digest.ts`,
`apps/api/src/lib/eligibility.ts` (deleted), `apps/api/test/routes-channels.test.ts`,
`apps/api/test/routes-follows-digest.test.ts`, `apps/api/test/validation.test.ts` (if it seeds a follow),
`AGENTS.md` (nothing: the layout line is already gone).

- 2.1 `follows.ts`: `PUT` keeps the declined check, then `registry.recordFollow(email, id)` and the view; `DELETE` is
  `registry.recordUnfollow(email, id)` and the view; `GET` is `registry.listFollows(email)` then
  `listChannelManagement(ids)` and the unread counts (unchanged: receipts stay in the User DO). `followView` and
  `toFollow` take the `FollowRecord`.
- 2.2 `channels.ts`: `followAndView` calls `recordFollow` only; `isFollowing` and the `following` set read
  `registry.activeChannelIds(email)`; the episodes route's eligible set is `registry.listEligibleChannels(email)`.
- 2.3 `digest.ts`: `registry.listEligibleChannels(email)`. Delete `lib/eligibility.ts`.
- 2.4 Tests: every `userDO(X).follow(...)` in the route tests becomes `registry().recordFollow(X, ...)`, and
  `userDO(ALICE).activeChannelIds()` becomes `registry().activeChannelIds(ALICE)`. New assertion in the follow test:
  after `PUT`, the same identity's `GET /channels` row shows `following: true` and `followerCount` including them, and
  after `DELETE` both flip, in one response each (spec §6.2). The declined-channel follow, the 404 on a never-followed
  channel, the idempotent second `DELETE`, and the pause-at-zero cases stay as they are and now exercise one store.

**Done when:** `pnpm check` green; the OpenAPI test passes untouched (spec §6.8).

### Step 3 — The User DO forgets follows  (size: S)

**Files:** `apps/api/migrations/user/0001_init.sql`, `apps/api/src/do/user.ts`, `apps/api/src/do/user/follows.ts`
(deleted), `apps/api/src/do/user/types.ts`, `apps/api/test/user-follows.test.ts` (deleted),
`apps/api/test/user-migrations.test.ts`, `apps/api/test/user-reads.test.ts`.

- 3.1 `0001_init.sql` (user): remove the `channel_follows` table and its index; the header notes the 2026-09-13 edit
  and points at PRD §5.2. Edited in place (PRD §5.4).
- 3.2 `do/user.ts`: remove `follow`, `unfollow`, `listFollows`, `activeChannelIds`, the `follows` import, and the two
  types; the class comment says read receipts, chats, and preferences. Delete `do/user/follows.ts`; remove
  `ChannelFollow` and `ListFollowsOptions` from `types.ts`.
- 3.3 Tests: delete `user-follows.test.ts` (its semantics moved to `registry-followers.test.ts` in Step 1);
  `user-migrations.test.ts` expects the five remaining tables and drops the `channel_follows` column assertion;
  `user-reads.test.ts`'s "keeps receipts through unfollow" seeds an approved channel, follows and unfollows through
  the Registry, and asserts the receipt survives.

**Done when:** `pnpm check` green. Then the owner wipes local Durable Object state (`/clean-local-do`, on their word:
the User DOs recorded `0001_init` with the old table) before the walkthrough.

### Step 4 — Walkthrough and closing  (size: S)

**Files:** `docs/specs/follows-single-owner.md`, this file.

- Under `wrangler dev` on wiped state: add a channel as one identity (a real `UC…` id; the feed call is permitted),
  follow it as a second identity, and check `GET /channels` shows `following` and `followerCount: 2`; unfollow both and
  check the channel reads `paused: true` with `management.pausedBy: "system"`; refollow and check the pause lifts;
  `DELETE /follows` on a never-followed id is 404; `GET /digest` as a follower answers 200. Record the results below.
- Set both status lines to complete with the date.

**Done when:** `pnpm check` green (docs only).

## Walkthrough record

_Filled in at Step 4._
