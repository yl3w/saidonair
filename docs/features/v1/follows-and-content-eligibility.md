# Follows and content eligibility

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and behavior

A follow selects which shared channels participate in a reader's personal
digest, read receipts, and chat retrieval. It also contributes to the channel's
follower count and automatic ingestion pause. It does not make another copy of
shared content or determine whether a public summary URL can be opened.

The authoritative eligibility rule is:

```text
eligible channels = active follows ∩ channels whose status is approved
```

Paused approved channels remain eligible. Requested and declined channels do not.
Anonymous callers have an empty eligible set even though public summaries remain
readable.

## Follow lifecycle

- `GET /follows` returns active follows with embedded channel information,
  follower count, and the caller's unread count. It includes follows whose channel
  has since been declined; those channels report zero unread while ineligible.
- `PUT /follows/:channelId` follows or refollows a requested/approved channel.
  An active follow is idempotent. Refollowing clears the tombstone and gives the
  relationship a new `followedAt`. Unknown channels are 404; declined channels
  return 409 with review information.
- `DELETE /follows/:channelId` records `unfollowedAt` rather than deleting the
  row. Repeating an existing unfollow is idempotent; a never-followed relationship
  returns 404.
- Channel addition and requesting a declined channel again also follow the caller.

Existing read receipts survive unfollow/refollow and decline/reapproval. A summary
with no prior receipt is unread when it becomes eligible; a prior read summary
does not become unread merely because the reader follows again. Existing chat
messages and source snapshots are also retained. New chat questions use current
eligibility.

## Automatic pause

When the last active follower leaves an approved, unpaused channel, it becomes
system-paused. A new follow lifts a system pause. A follow does not lift an owner
pause. Explicit owner resume can clear either pause; first approval computes the
pause from the current follower count.

Follow writes and automatic pause calculation execute in the Registry rather
than coordinating duplicate follow records across Durable Objects. Pausing stops
future scheduled discovery; it does not cancel processing, suppress recovery, or
hide existing summaries from eligible readers.

## Implementation and storage

| Responsibility | Source |
|---|---|
| HTTP follow operations and unread projection | [follows routes](../../../apps/api/src/routes/follows.ts) |
| Authoritative relationship and eligibility queries | [followers store](../../../apps/api/src/do/registry/followers.ts), especially `recordFollow`, `recordUnfollow`, and `listEligible` |
| Transaction boundaries | [Registry facade](../../../apps/api/src/do/registry.ts) |
| Per-request eligibility | [eligibility.ts](../../../apps/api/src/lib/eligibility.ts) |
| Follow control | [FollowButton](../../../apps/web/src/components/FollowButton.tsx), [Sources](../../../apps/web/src/screens/Sources.tsx), [Source](../../../apps/web/src/screens/Source.tsx) |

`channel_followers` lives only in the Registry. Receipts live in each User DO's
`summary_reads`. Related-summary responses are filtered to eligible channels;
the digest and chat use the same underlying eligibility definition. See
[Digest](personal-digest-queue-and-history.md) and
[Chat](chat-and-grounded-answers.md).

## Tests and limitations

[Follower-store tests](../../../apps/api/test/registry-followers.test.ts) cover
relationship and pause behavior.
[Follow/digest route tests](../../../apps/api/test/routes-follows-digest.test.ts)
cover eligibility, unread counts, and receipt retention through refollow.
[Chat tests](../../../apps/api/test/chat.test.ts) cover ineligible scope and stored
scope survival.

The API and database preserve relationships; this is not a per-user transcript
subscription or a notification/email system. Follower addresses are available
only through the owner-protected follower-list API, while counts are public.

Refollowing preserves existing read receipts. Follows govern personalized
operations; they are not required for public direct summary reads.
