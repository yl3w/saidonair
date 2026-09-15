# Feature spec — Follows have one owner

**Written:** 2026-09-13, against `main` at `16949b3`.
**Status:** complete 2026-09-13. Implemented on `main` in `7a630fc` (Registry side), `092ef97` (routes), and
`b04c81e` (User DO); the `wrangler dev` legs are recorded in `docs/specs/follows-single-owner-plan.md`. The PRD and
`AGENTS.md` edits in §8 were applied with this spec.
**Owner decision 2026-09-13:** the Registry's `channel_followers` is the only record of follows; the User DO's
`channel_follows` table goes.

## 1. Summary

Since 2026-09-10 a follow was written twice: a row in the caller's User DO, then a row in the Registry's
`channel_followers`. The User DO row fed the user's own list, `following`, and eligibility; the Registry row fed
`followerCount`, the owner's queue, and the automatic pause. Nothing could make the two writes atomic, and nothing
detected when the second failed. The two failure modes were silent and product-visible: a user follows a channel nobody
else follows, the Registry write fails, the channel stays system-paused and is never discovered, while the user sees
"following"; or an unfollow's Registry write fails and a phantom follower keeps a channel discovering, and spending
transcript credits, for nobody.

The copy bought nothing. Both rows carried the same two timestamps, follows were already Registry data by design so
there was no privacy in the copy, and every Home load already goes through the Registry for channels and the catalog.
So the Registry owns follows outright. The User DO keeps what is truly private: read receipts, chats, and preferences.
The wire contract does not change; the web does not change.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Where follows live | **Only in `channel_followers`** (Registry). `channel_follows` is dropped from the User DO's `0001`, edited in place; nothing is deployed and local state is wiped. | One row cannot disagree with itself. Governance is open (PRD §5.4). |
| A user's own list | `channel_followers WHERE user_email = ? AND unfollowed_at IS NULL`, newest `followed_at` first. New index `channel_followers(user_email, unfollowed_at)`. | The list was the User DO's one job for follows; the Registry answers it in one indexed query. |
| Eligibility | **One SQL join in the Registry**: active follows of the email ∩ `channels.status = 'approved'`. `lib/eligibility.ts` is deleted; `do/registry/followers.ts` `listEligible` is the one implementation (`AGENTS.md`). | Two RPCs and an in-memory intersection become one query. Hard rule 3's retrieval scope (M4) will call the same function. |
| Unfollow of a channel never followed | `NOT_FOUND` "channel is not followed", as the User DO answered; unfollowing a tombstone stays idempotent (200, the tombstone). | Keeps `DELETE /follows/:channelId` exactly as documented and tested. |
| Follow of a declined channel | Unchanged: the route answers 409 `ChannelDeclinedResponse` before writing. | The rule lives in the route today; the Registry method stays a plain write. |
| Refollow timestamps | Unchanged: an explicit refollow clears `unfollowed_at` and adopts the new `followed_at`; an idempotent follow of an active row keeps the original. | Already the Registry's `ON CONFLICT` behaviour (`recordFollow`). |
| Wire contract | **Unchanged.** `Follow`, `FollowsResponse`, `FollowResponse`, `Follower`, `Channel.following`, `Channel.followerCount` keep their shapes and meanings. | `followedAt` and `unfollowedAt` come from the Registry row, which has both. |
| Web | **Unchanged.** | It reads the same fields. |
| Rejected alternatives | An outbox with a Durable Object alarm, and a reconciling pass in the six-hour cron, were the ways to make two stores agree. | Both add machinery to keep a copy the product does not need. |

## 3. Data

**Registry** `channel_followers`: unchanged columns (`channel_id`, `user_email`, `followed_at`, `unfollowed_at?`,
`updated_at`, `created_at`; composite PK; FKs to `channels` and `global_users`). One new index,
`channel_followers_user_email_unfollowed_at ON channel_followers (user_email, unfollowed_at)`, for the per-user list
and eligibility. Edited into `0001_init.sql` in place, so the index exists on a fresh Registry.

**User DO**: `channel_follows` and `channel_follows_unfollowed_at` are removed from `0001_init.sql`. The remaining
tables are `summary_reads`, `chats`, `chat_messages`, `chat_message_sources`, `user_preferences`. The header comment
notes the 2026-09-13 edit.

Eligibility, the one implementation:

```sql
SELECT c.channel_id, …channel columns…
FROM channel_followers f
JOIN channels c ON c.channel_id = f.channel_id
WHERE f.user_email = ? AND f.unfollowed_at IS NULL AND c.status = 'approved'
ORDER BY c.title COLLATE NOCASE, c.channel_id
```

## 4. Registry contract (RPC facade, `do/registry.ts`)

| Method | Semantics |
|---|---|
| `recordFollow(email, channelId): FollowRecord` | `ensureUser`, then upsert the follower row (idempotent on an active row; a tombstone is cleared and adopts the new `followed_at`); lifts a `system` pause. Returns the row. `NOT_FOUND` for an unknown channel. Unchanged in behaviour; the return type changes from the channel to the follow row. |
| `recordUnfollow(email, channelId): FollowRecord` | `NOT_FOUND` when the user never followed the channel; idempotent on a tombstone; otherwise sets `unfollowed_at` and, at zero active followers on an approved channel with no owner pause, sets `paused_by = 'system'`. Returns the row. |
| `listFollows(email): FollowRecord[]` | Active follows of the email, newest `followed_at` first. |
| `activeChannelIds(email): string[]` | The channel ids of the active follows, sorted. |
| `listEligibleChannels(email): CatalogChannel[]` | Active follows ∩ approved, the query in §3. |
| `countFollowers`, `listFollowers` | Unchanged. |

`FollowRecord` is `{ channelId, followedAt, unfollowedAt }`; `FollowerRecord` (`{ email, followedAt }`) stays for the
owner's list. The User DO facade loses `follow`, `unfollow`, `listFollows`, and `activeChannelIds`; `do/user/follows.ts`
and the `ChannelFollow` and `ListFollowsOptions` types are deleted. Read receipts, chats, and preferences are untouched.

## 5. Routes

| Route | Today | After |
|---|---|---|
| `PUT /follows/:channelId` | `getChannel` (409 if declined) → `user.follow` → `registry.recordFollow` → view | `getChannel` (409 if declined) → `registry.recordFollow` → view |
| `DELETE /follows/:channelId` | `user.unfollow` → `registry.recordUnfollow` → view | `registry.recordUnfollow` → view |
| `GET /follows` | `user.listFollows` → `registry.listChannelManagement(ids)` → unread | `registry.listFollows(email)` → `listChannelManagement(ids)` → unread |
| `POST /channels`, `POST /channels/:id/request` | create or reopen → `user.follow` → `registry.recordFollow` → view | create or reopen → `registry.recordFollow` → view |
| `GET /channels`, `GET /channels/:id`, the channel actions | `following` from `user.activeChannelIds()` | `following` from `registry.activeChannelIds(email)` |
| `GET /channels/:id/episodes`, `GET /digest` | `eligibleChannels(registry, user)` (two RPCs) | `registry.listEligibleChannels(email)` (one) |
| Unread counts | `registry.listAvailableEpisodeIds` minus `user.readEpisodeIds` | Unchanged: receipts stay in the User DO |

Every route keeps its documented status codes and bodies, so the OpenAPI document does not change.

## 6. Acceptance criteria

1. A fresh User DO lists `0001_init` alone and has no `channel_follows` table; a fresh Registry has the
   `channel_followers(user_email, unfollowed_at)` index.
2. `PUT /follows/:channelId` then `GET /channels` from the same identity shows `following: true` and
   `followerCount` counting that follow in the same response; `DELETE` shows `following: false` and the count
   decremented; the owner's `GET /channels/:id/followers` agrees. There is no code path that can make these disagree.
3. `DELETE /follows/:channelId` on a channel the caller never followed is 404; a second `DELETE` on a tombstone is 200
   with the tombstone; an explicit refollow clears the tombstone and adopts the new `followedAt`.
4. The last active follower leaving pauses an approved channel by the system; the next follow lifts a system pause and
   never an owner pause; a requested channel is never paused (unchanged behaviour, re-tested against the single store).
5. `GET /follows` lists active follows newest first with `unreadCount` from the User DO's receipts; a follow of a
   declined channel stays listed with the note and reads zero unread until re-approval.
6. `GET /digest` and the receipt rule in `GET /channels/:id/episodes` use the Registry's eligibility: a follower of an
   approved channel is eligible, a follower of a declined or requested one is not, a non-follower is not.
7. The User DO facade exposes no follow method; `lib/eligibility.ts` does not exist; `test/user-follows.test.ts` is
   gone and its semantics live in `test/registry-followers.test.ts`.
8. The OpenAPI document does not change: the coverage test, the component list, and the parse assertions pass
   without edits.
9. `pnpm check` green; under `wrangler dev` on wiped local state, follow, unfollow, refollow, and a declined follow
   behave as §5 says and the four web screens still load.
10. `AGENTS.md` and the PRD carry §8.

## 7. Out of scope

- M4 chat retrieval scope: it will call `listEligibleChannels` too, which is the point, but M4 registers it.
- Any change to read receipts, unread counting, or the web.
- Reconciliation or an outbox: rejected above.

## 8. `AGENTS.md` and PRD edits (applied 2026-09-13 with this spec)

- **PRD** §2, §3 (diagram), §4.3, §5.1, §5.2, §5.3 (indexes), §5.4, §7 (follow routes row), §8, §9 (decision).
- **AGENTS.md**: repo layout (`do/user/` without follows; `lib/eligibility.ts` gone; `do/registry/` names the
  follower store as the one record of follows and the one implementation of eligibility); Data & schema conventions
  (the follower record is the only record; `followers.ts` answers the user's list and eligibility).
- `channel-simplification.md` §3.2 and `home-read-experience.md` §9.3 and §10 carry supersession notes.
