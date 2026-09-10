# Feature spec — Channel state simplification

**Written:** 2026-09-10, against `main` at `9b08622`, reading the uncommitted 2026-09-10 edits to `AGENTS.md`,
`docs/PRD.md`, and the M3 spec and plan in the working tree.
**Revised:** 2026-09-10, same day. Declining is a channel status, not a soft delete; channels are never deleted (§2,
second table, last row). Nothing else moved.
**Status:** proposed. Drafted from the group PM review of the channel-state proposal and the ten review decisions of
2026-09-10 (§2). Nothing here is implemented; an implementation plan follows acceptance.
**Supersedes, once accepted:** the catalog, request, follow, and deletion rules in `AGENTS.md` and PRD §4.1–4.3;
`docs/specs/home-read-experience.md` §6.4, §7, §9.3, and the request routes in §10; `docs/specs/m3-ingestion.md` §2
(channel failure rows), §3.3, §3.4, and the approval path in §3; `docs/specs/m3-ingestion-plan.md` Steps 4, 7, 8, 9
(§12 below lists the edits).

## 1. Summary

A channel becomes an approval container with three statuses, `requested`, `approved`, and `declined`, and stops
carrying import outcomes. Anyone puts a channel into the catalog by pasting its id, which also follows it; the owner
approves or declines. Declining is the one answer to both "no, not this channel" and "we are withdrawing this one":
it stops scheduling by itself, hides the channel from the catalog list, keeps everything it produced, and can be
undone by the owner approving it again or by a user requesting it again after reading the owner's note. Channels are
never deleted, softly or otherwise.

Episodes carry the state machine that matters: `pending`, `available`, `failed`, `skipped`. Technical failures are
retried on three runs before they reach the owner, and deterministic outcomes (too short, non-English, no captions
after the wait, live, unplayable) are skipped automatically. Follows are recorded in the Registry as well as the User
DO, so the owner sees real follower counts and a channel nobody follows is paused rather than ingested.

Gone: the automatic-follow handoff between the Durable Objects, channel failure codes, channel retry, the channel
waiting code, channel soft delete and restore, the request entity with its seven outcome phrases, and the follow
eligibility guard. Added: a `declined` status, a pause flag, a follower record in the Registry, an episode `skipped`
status with reasons, and owner skip and retry per episode. The timing matters: M3 ingestion is not built, and this
removes more of that unbuilt work than it adds.

## 2. Decisions this spec makes

The first block is the PM proposal of 2026-09-10 as amended in review; the second block is the review answers.

| Question | Decision | Why |
|---|---|---|
| Channel statuses | **Three: `requested`, `approved`, `declined`.** Pause (`paused_by`) is a flag on approved channels. Nothing is deleted. | Import outcomes never described the channel well: today `available` is absorbing and every later problem already lives on episodes. Three statuses on one axis make the channel what it is, a catalog membership with the owner's answer. |
| Who creates a channel | **Anyone.** A user pasting a `UC…` id or `/channel/UC…` URL creates a `requested` channel and follows it. The owner's add creates it `approved`. | One action for users, no separate request form, and the owner queue is simply the requested channels. |
| Follow guard | **Any `requested` or `approved` channel can be followed.** Following a declined one is "request again" (§3.1). | With requests being follows, gating follows on availability would block the very action that requests a channel. Readability is decided by episode state, not by the follow. |
| Episode metadata on channels | Every channel representation carries `episodes: { tracked, available, pending, waiting, failed, skipped }`, `lastIngestedAt`, `lastCheckedAt`, `followerCount`, and `paused`. | "Approved" no longer promises content, so the reader needs "0 of 5 summarised yet" where today they had "available". The counts already exist in the owner-only management block. |
| Episode statuses | **Four: `pending`, `available`, `failed`, `skipped`.** `processing` and `no_transcript` go. Pending carries an optional wait reason; failed carries the last technical reason; skipped carries a skip reason. | The run table already says what is in progress. "No transcript" is one skip reason among several, not a status of its own. |
| Owner review of episodes | The owner retries or skips a `failed` episode; retry also reopens a `skipped` one. Channel-level retry is removed. | This is the per-episode retry the M3 spec already proposes, made the only retry. |

| Review question (2026-09-10) | Decision | Consequence |
|---|---|---|
| How is a rejected request represented? | First answer: soft-delete the requested channel. **Revised the same day: a `declined` status** (last row). | Recorded for the trail; the last row is the operative decision. |
| Which episode outcomes reach the owner? | **`failed` means technical only.** Deterministic outcomes are skipped by the system. | The queue holds only things a retry can fix. The 2026-09-08 caption-versus-technical distinction survives as skipped versus failed. |
| How does the owner stop a hopeless channel? | **An owner pause flag.** | Scheduling stops, summaries stay readable, resume is one click. |
| What are the channel statuses called? | **`requested` and `approved`**, later joined by `declined`. | "Available" is freed to mean readable content, on episodes only. |
| Are requested channels visible to everyone? | **Yes, as awaiting approval.** | Anyone can follow early; the owner sees interest build. Requests stop being private and Home drops its requests list. |
| Do technical failures retry before the owner sees them? | **Up to three attempts across scheduled runs, then `failed`.** Credit exhaustion is a wait, not an attempt. | Transient provider errors clear themselves at no credit cost (errors are not billed). Replaces "never automatically restart technical failures". |
| How do we know who requested a channel? | **Following a requested channel registers the follower in the Registry.** | One action for users. The Registry keeps an active follower record per channel and user. |
| What does `skipped` mean to each role? | **Reversible by owner retry; readers see the title with no summary.** | Channel history stays complete and a wrong automatic skip can be undone. |
| Does unfollowing withdraw a request? | **A channel with no active followers is paused, whatever its status.** Pause lifts on the next follow. | Ingestion follows demand. The Registry tracks active followers for every channel, replacing requester count with a real follower count. |
| Should declining soft-delete the channel, or be a status? | **A `declined` status; nothing is deleted.** Declined excludes scheduling by itself, so it is never also paused. A user re-requests a declined channel after seeing the owner's note, with one confirmation; the owner may approve a declined channel directly. Declining an approved channel bumps the fence and confirms once in the UI. Copy says "Declined" when the channel was never approved and "Withdrawn" when it was. | One field describes the channel. The `deleted_at` axis, the restore route, the "restore it first" guards, and the two meanings of deletion all go. Approve and Decline become the only owner verbs at channel level, with Pause and Resume. |

## 3. Model

### 3.1 Channels

```
                     ┌─────────────────┐
     user pastes id  │  not in catalog │  owner adds
          ┌──────────┴────────┬────────┴──────────┐
          ▼                   │                   ▼
   ┌────────────┐   owner approves   ┌────────────┐  0 followers / owner pause  ┌───────────────────┐
   │ requested  │ ─────────────────► │  approved  │ ──────────────────────────► │ approved · paused │
   └────────────┘                    └────────────┘ ◄────────────────────────── └───────────────────┘
       │     ▲                         │        ▲    first follow / owner resume
  owner   user requests           owner       owner approves again
  declines  again (sees note)     withdraws   (no new initial import)
       │     │                    (fence +1)    │
       ▼     │                         ▼        │
   ┌────────────────────────────────────────────────┐
   │  declined   hidden from the catalog list; followers keep the row and read the owner's note   │
   └────────────────────────────────────────────────┘
```

Columns on `channels` (Registry), see §6 for the migration:

| Column | Values | Rule |
|---|---|---|
| `status` | `requested`, `approved`, `declined` | `requested` by a user's add or re-request; `approved` by the owner's add or approval; `declined` by the owner. Every transition is in the rules below; there is no other. |
| `paused_by`, `paused_at` | null, `owner`, `system` | Meaningful on `approved` only. No new runs while set. `system` is set when the last active follower leaves and cleared by the next follow. `owner` is set and cleared only by the owner; a system pause never overrides it. Cleared on decline, recomputed on approve. |
| `approved_at` | null or unix ms | Set the first time the channel is approved and never reset. Decides whether a later approval starts an initial import, and whether copy says "Declined" or "Withdrawn". |
| `reviewed_at`, `reviewed_by_email`, `review_note` | nullable | Written by approve and decline; the latest review only. The note is shown to followers of a declined channel and on the re-request confirmation. A review log is out of scope (§8). |
| `initial_import_count` | integer, default 5 | Unchanged. Applies to the import started at first approval. |
| `lifecycle_version` | integer from 1 | Unchanged. Bumped when an approved channel is declined; that is the only transition a run can be in flight for. |
| `deleted_at`, `failure_code`, `failure_detail`, `available_at` | deprecated | Kept, never written or read. `available_at` is replaced by `approved_at`. |

Rules:

- **Create.** `POST /channels { channelId, title?, initialImportCount? }` validates the id offline, fetches its RSS
  feed (404 → `INVALID_INPUT`), and calls the Registry's create-only `createChannel` with the feed title. A user's
  call creates `requested`; the owner's call creates `approved` with `approved_at` and starts the initial import. The
  caller is followed onto the channel (§3.2). When the Registry answers `INVALID_STATE` because the id already exists,
  the route does not fail: a `requested` or `approved` channel is followed and returned with 200; a `declined` one is
  returned as 409 `INVALID_STATE` with `{ channelId, status: "declined", reviewNote, reviewedAt }` so the client can
  show the note and offer "Request again". The Registry stays create-only, as decided in `db26c74`.
- **Request again.** `POST /channels/:id/request`, anyone. Requires `declined`. Sets `status = 'requested'`, keeps the
  review fields for the queue to show, and follows the caller. This is the only way out of `declined` for a user, and
  it is explicit: the client asks once, showing the owner's note and date.
- **Approve.** `POST /channels/:id/approve { title?, initialImportCount?, explanation? }`, owner. Requires
  `requested` or `declined`. Sets `status = 'approved'`, the review fields, and `approved_at` if null. Starts the
  initial import only when `approved_at` was null; a re-approved channel is picked up by the next scheduled run.
  Recomputes pause from the follower count. Followers are already following; nothing is handed off.
- **Decline.** `POST /channels/:id/decline { explanation? }`, owner. Requires `requested` or `approved`. Sets
  `status = 'declined'` and the review fields. From `approved` it also bumps `lifecycle_version`, so a running run is
  fenced out, and clears `paused_by`. Episodes, summaries, vectors, follows, and read receipts are kept. The UI
  confirms once when declining an approved channel, showing its follower count.
- **Pause and resume.** `POST /channels/:id/pause` and `POST /channels/:id/resume`, owner, `approved` only.
  Automatic pause and resume are §3.2. A running run finishes; pause only stops new selection. Pause never hides
  summaries or affects digest, chat, or read receipts.
- **No channel failure, no channel retry, no channel waiting code, no channel deletion.** A channel with every
  episode skipped is an approved channel with `episodes.available = 0`, visible as such to everyone.

### 3.2 Follows and followers

Follows stay in the User DO (`channel_follows`, unchanged schema; `origin` is always `manual` from now on and
`origin_request_id` is never written). The Registry gains `channel_followers` (§6): one row per channel and email
with `followed_at` and nullable `unfollowed_at`. It exists so the Registry can answer three questions it cannot answer
today: who is waiting on a requested channel, how many people follow a channel, and whether anyone follows it at all.
This is a deliberate change to the privacy split in `AGENTS.md` → Identity model: follow membership becomes shared
Registry data; read receipts, preferences, and chats remain private to the User DO.

- `PUT /follows/:channelId` requires a `requested` or `approved` channel, else 409 `INVALID_STATE` with the channel's
  status and note ("declined by the owner; request it again"). It writes the User DO first, then
  `registry.recordFollow(channelId, email)`. Both writes are idempotent; if the second fails the route returns the
  error and the client retries. `DELETE /follows/:channelId` mirrors this with `recordUnfollow` and works on any
  status. A pair that ends up inconsistent is corrected by the next follow or unfollow of that pair; the User DO
  remains the source of truth for what the user sees in their own list, the Registry for counts and the owner queue.
- `POST /channels` and `POST /channels/:id/request` by a user perform the same two follow writes after creating or
  re-requesting the channel.
- **Automatic pause.** `recordUnfollow` counts the channel's active followers inside the same Registry call; at zero
  it sets `paused_by = 'system'` on an `approved` channel unless `paused_by = 'owner'`. On a `requested` channel it
  sets the same flag so the queue can say "nobody is waiting"; declining does not need it. `recordFollow` clears a
  `system` pause. Owner resume clears either kind; if nobody follows, the next unfollow to zero pauses it again.
- **Eligibility** (`lib/eligibility.ts`, hard rule 3): active follows ∩ `status = 'approved'`. Paused channels are
  eligible: their existing summaries stay readable and searchable. Requested channels have no content and declined
  ones are excluded, both by status.
- The automatic-follow handoff, `auto_follow_completed_at`, `UserDO.autoFollow`, and the approval sweep are removed.
  `channel_requests` is deprecated (§6).

### 3.3 Episodes

```
   feed entry selected (newest N at first approval; new uploads on scheduled runs)
          │
          ▼
   ┌─────────────┐   third technical failure    ┌──────────┐
   │   pending   │ ───────────────────────────► │  failed  │
   │  (waiting?) │ ◄─────────────────────────── │          │
   └─────────────┘   owner retry                └──────────┘
      │       ▲                                     │
      │       │ owner retry                         │ owner skip
      │       │                                     ▼
      │   ┌───────────┐ ◄───────────────────────────┘
      │   │  skipped  │  system: SHORT · NON_ENGLISH · NO_CAPTIONS (≥ 48 h) · LIVE_OR_UPCOMING (≥ 48 h) · UNPLAYABLE
      │   └───────────┘
      ▼
   ┌─────────────┐
   │  available  │  every vector verified in `shared-catalog` and a summary stored; `processed_at` set once
   └─────────────┘
```

| Column | Values | Rule |
|---|---|---|
| `status` | `pending`, `available`, `failed`, `skipped` | `processed` becomes `available`; `no_transcript` becomes `skipped` with `NO_CAPTIONS`; `processing` is dropped, the run row says what is in flight. |
| `waiting_code` | null, `CAPTIONS`, `LIVE_OR_UPCOMING`, `PROVIDER_LIMIT` | Only on `pending`. Set when a run leaves the episode for a later run; cleared on the next attempt. Waiting never counts as an attempt. |
| `attempt_count`, `failure_code`, `failure_detail` | existing | A technical or provider error increments `attempt_count` and records the reason. Below three attempts the episode stays `pending` and the next scheduled run reattempts it. The third makes it `failed`. Owner retry resets the count. |
| `skip_reason`, `skipped_at`, `skipped_by_email` | `SHORT`, `NON_ENGLISH`, `NO_CAPTIONS`, `LIVE_OR_UPCOMING`, `UNPLAYABLE`, `OWNER` | System skips carry a reason and no email; owner skips carry `OWNER` and the owner's email. Cleared by owner retry. |
| `transcript_checked_at`, `chunk_count`, `vectorized_at`, `processed_at` | existing | Unchanged. `processed_at` is `summaryAvailableAt` and is never reset. |

Classification, carrying the 2026-09-08 rules onto the new statuses:

- Under 180 seconds → `skipped SHORT`, nothing stored. Captions exist but none English → `skipped NON_ENGLISH`.
- No captions on a video published within the last 48 hours → `pending`, `waiting_code = CAPTIONS`,
  `transcript_checked_at` set. At or after 48 hours a fresh no-caption answer → `skipped NO_CAPTIONS`.
- Live or upcoming → `pending`, `waiting_code = LIVE_OR_UPCOMING`; at or after 48 hours still live → `skipped
  LIVE_OR_UPCOMING`. Known live metadata takes precedence over an `UNPLAYABLE` answer, as in the M3 spec.
- `UNPLAYABLE` → `skipped UNPLAYABLE`. The owner can retry it if the video becomes public.
- `PROVIDER_LIMIT` (credits) ends the run, leaves the remaining selected episodes `pending` with
  `waiting_code = PROVIDER_LIMIT`, and counts no attempt.
- `PROVIDER_AUTH`, `PROVIDER_HTTP`, `PROVIDER_RATE_LIMIT`, `PROVIDER_PARSE`, `VECTORIZE_INCOMPLETE`, and summary
  failures after the raw-text fallback → technical: attempt +1, reason recorded, `failed` on the third.
- Publish rules are unchanged: `available` only after `getByIds` returns every expected vector and the summary row
  exists, in one Registry write fenced by `lifecycle_version`.

Owner actions, both requiring an `approved` channel with no queued or running run, else 409:

- `POST /channels/:id/episodes/:videoId/retry`: from `failed` or `skipped` to `pending`, attempts and skip fields
  cleared, one-episode `owner_retry` run. Siblings and their summaries are untouched.
- `POST /channels/:id/episodes/:videoId/skip`: from `failed` to `skipped OWNER`.

### 3.4 Scheduling

- **Cron, every 6 hours** (unchanged): select channels with `status = 'approved'`, `paused_by IS NULL`, and no queued
  or running run. Per channel: new feed entries plus every `pending` episode, waiting or below three attempts,
  including selected episodes that have left the feed.
- **First approval** starts the initial import of the newest `initial_import_count` entries. If the channel is paused
  because nobody follows it, the import still runs once; later runs wait for a follower. `TODO(owner):` confirm, or
  skip the initial import while paused. A later approval, after a decline, starts nothing; the next scheduled run
  picks the channel up.
- **Reconciliation** (unchanged in intent from the M3 spec): a queued or running run whose Workflow is missing or
  failed is closed and fenced; its episodes keep their attempt counts. An approved channel with no run at all after
  the `TODO(owner)` window appears under Needs attention as "approved, never started" with a Start action that
  requests a run.
- Follower count never affects selection except through pause. A paused channel is skipped, not failed. A declined
  channel is excluded by status.

## 4. What each role sees

| Channel is | Users see it | Users follow it | Owner actions | Cron |
|---|---|---|---|---|
| `requested` | Yes, "awaiting owner approval", with follower count | Yes; following registers them as a requester | Approve, Decline. Queue shows followers and "nobody is waiting" when none | No |
| `approved` | Yes, with episode counts; summaries for followers | Yes | Decline (confirms once), Pause; per-episode Retry and Skip | Yes, unless paused |
| `approved · paused` | Yes, "paused", existing summaries readable | Yes; a follow lifts a system pause | Resume, Decline | No |
| `declined`, never approved | Not in the catalog list. Followers see "Declined" with the note and Request again; anyone who pastes the id sees the same | Request again (one confirmation) | Approve | No |
| `declined`, previously approved | Not in the catalog list. Followers see "Withdrawn" with the note and Request again | Request again (one confirmation) | Approve; no new initial import | No |

Episodes: readers see every tracked episode's title in channel history; `available` ones carry the summary, others
read "no summary" (`pending`: "not yet"; `skipped`: the humanised reason; `failed`: "the owner has been notified").
Digest, unread counts, and chat use `available` episodes of eligible channels only, exactly as today's `processed`.

## 5. API contract

Entity-based as before: no `/owner/*`, authorization per operation, `management` and `?scope=all` for the owner.

| Route | Who | Change | Purpose |
|---|---|---|---|
| `GET /channels` | anyone | changed | `requested` and `approved` channels, each with `status`, `paused`, `following`, `followerCount`, `episodes` counts, `lastIngestedAt`; `?scope=all` (owner) adds `declined` channels and `management` |
| `POST /channels { channelId, title?, initialImportCount? }` | anyone | changed | User: create `requested` and follow (201), or follow the existing `requested`/`approved` one (200). Owner: create `approved` and start the import (201). A `declined` id is 409 `INVALID_STATE` with `channelId`, `status`, `reviewNote`, `reviewedAt` |
| `GET /channels/:id` | anyone | changed | Any status by id, so a declined channel can show its note; declined ones simply do not appear in the list |
| `POST /channels/:id/request` | anyone | new | `declined → requested`; follows the caller |
| `POST /channels/:id/approve { title?, initialImportCount?, explanation? }` | owner | new | `requested → approved` with the initial import, or `declined → approved` without one |
| `POST /channels/:id/decline { explanation? }` | owner | new | `requested → declined`, or `approved → declined` with a fence bump |
| `DELETE /channels/:id`, `POST /channels/:id/restore` | | **removed** | Channels are never deleted |
| `POST /channels/:id/pause`, `POST /channels/:id/resume` | owner | new | Owner pause; resume clears any pause. `approved` only |
| `POST /channels/:id/retry` | owner | **removed** | |
| `GET /channels/:id/episodes?limit=` | anyone | changed | Episode `status` takes the new values; `skipReason`, `waitingCode`, `attemptCount` in the owner's `processing` block |
| `POST /channels/:id/episodes/:videoId/retry` | owner | as planned | From `failed` or `skipped` |
| `POST /channels/:id/episodes/:videoId/skip` | owner | new | From `failed` |
| `GET /channels/:id/ingestion-runs` | owner | unchanged | |
| `GET /channels/:id/followers` | owner | new, replaces `/requests` | Emails and `followedAt` of active followers; the UI shows emails only in the queue and counts elsewhere |
| `GET /follows`, `PUT /follows/:channelId`, `DELETE /follows/:channelId` | anyone (own) | changed | Follow any `requested` or `approved` channel (409 with the note for `declined`); each write also records the follower in the Registry |
| `GET /channel-requests`, `POST /channel-requests`, `…/approve`, `…/reject` | | **removed** | Requests are channels |
| `GET /catalog` | owner | changed | `channels: { requested, approved, paused, declined }`, `episodes: { available, pending, waiting, failed, skipped }`, `attention: { failedEpisodes, neverStarted, requested }`, `lastSuccessfulIngestionAt`, `transcripts.remainingCredits` |
| `GET /digest`, chats, preferences, `/me` | | unchanged | |

Shared schemas: `ChannelStatus` becomes `requested | approved | declined`; `ChannelFailureCode`, `CatalogState`,
`RequestOutcome`, `ChannelRequest*` are removed; `EpisodeStatus` becomes `pending | available | failed | skipped`;
`EpisodeSkipReason` and `EpisodeWaitingCode` are added; `Channel` gains `paused`, `followerCount`, `episodes`,
`approvedAt`, `reviewNote`, `reviewedAt` and loses `deletedAt`, `available`, `failureCode`; `ChannelManagement` loses
`failureDetail`, `availableAt`, `requesterCount`, `stuckPending` and gains `pausedBy`, `pausedAt`, `reviewedByEmail`,
`neverStarted`. A `ChannelDeclinedResponse` carries the 409 body for `POST /channels` and `PUT /follows/:channelId`,
following the existing `ChannelAlreadyAvailableResponse` pattern. The OpenAPI coverage test keeps document and routes
in step.

## 6. Data and schema

Additive migration `apps/api/migrations/registry/0003_channel_simplification.sql`:

- `ALTER TABLE channels ADD COLUMN` `paused_by TEXT`, `paused_at INTEGER`, `approved_at INTEGER`,
  `reviewed_at INTEGER`, `reviewed_by_email TEXT`, `review_note TEXT`.
- `CREATE TABLE channel_followers (channel_id TEXT NOT NULL REFERENCES channels(channel_id), user_email TEXT NOT
  NULL REFERENCES global_users(email), followed_at INTEGER NOT NULL, unfollowed_at INTEGER, created_at INTEGER NOT
  NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (channel_id, user_email))` and an index on
  `(channel_id, unfollowed_at)`.
- `ALTER TABLE episodes ADD COLUMN` `waiting_code TEXT`, `skip_reason TEXT`, `skipped_at INTEGER`,
  `skipped_by_email TEXT`.
- Index `channels(status, paused_by)` for cron selection.

Value changes are code, not schema: `status` is `TEXT` in both tables. `deleted_at` stays as a deprecated column,
never written; the "Deletion is soft" convention in `AGENTS.md` keeps applying to every other entity, and channels
simply have no deletion. Two data questions need the owner because the migration convention is additive only:

- `TODO(owner):` existing `channels` rows were all created by approval or owner add, so they map to
  `status = 'approved', approved_at = created_at`; a row with `deleted_at` set maps to `declined`; failed ones lose
  their channel failure and are judged by their episodes. Apply as one `UPDATE` in the migration, or leave old rows
  to be corrected by hand in local dev.
- `TODO(owner):` existing pending `channel_requests` rows: convert each into a `requested` channel plus a follower
  record for the requester, or discard. The table itself stays, unwritten, per the convention.

No User DO migration: `channel_follows` is unchanged. Episodes have no production rows yet (M3 is unbuilt), so the
status rename costs nothing there.

## 7. Screens

- **Home, Channels.** Two subsections. **Followed** (`GET /follows`): approved rows show "N summarised · M unread ·
  ingested X" and link to the channel; requested rows show "awaiting owner approval"; paused rows add "paused";
  declined rows show "Declined" or "Withdrawn" with the owner's note, the date, and a **Request again** button that
  confirms once. Unfollow on every row. **Catalog** (`GET /channels` minus follows): approved channels with summarised
  counts and Follow; requested channels with "awaiting approval · N following" and Follow. Below both, one **Add a
  channel** input for a `UC…` id or `/channel/UC…` URL with the copy-the-id hint. A new id creates and follows; an
  existing id follows; a declined id shows "Declined on <date>: '<note>'" with Request again. The "Your requests"
  subsection, the request outcome phrases, and their polling are removed; the one remaining poll is for followed
  requested channels, every 15 s, until approved or declined.
- **Channel `/channel/:id`.** Any status. Requested: header, "awaiting owner approval", Follow or Unfollow, no
  episodes. Approved: as today, plus `skipped` and `pending` episodes listed by title with their phrase. Declined: the
  note, the date, and Request again; episodes listed without summaries when the channel had been approved.
- **Owner `/owner`.** **Queue**: requested channels oldest first with title, id linked to YouTube, active followers by
  email, "nobody is waiting" when none, "previously declined on <date>: '<note>'" when re-requested, Approve (title,
  import count, note) and Decline (note). Reviewed history collapsed: reviewer, time, note. **Needs attention**:
  `failed` episodes grouped by channel with reason, attempts, Retry and Skip; approved channels never started, with
  Start. **All channels**: status, paused, `available / tracked` with skipped and failed counts, followers, last
  ingested, latest run, and actions Approve or Decline, Pause or Resume. Declining an approved channel confirms once
  with the follower count. Health strip from `GET /catalog`.
- **Owner channel detail `/owner/channels/:id`.** Header with status, pause, approval and review fields, lifecycle
  version, import count, follower count; episodes with status, wait reason, attempts, failure or skip reason,
  summary format, Retry and Skip; runs; followers (emails) for requested channels, count only for approved ones.
  Never any user's read or chat activity.

## 8. Out of scope

Bulk retry across channels, editing a channel's import count after approval, a review log beyond the latest note,
follower lists beyond what §7 shows, notifications, any authentication, and a general admin dashboard. A
channel-level "re-import everything" is not needed: the owner retries episodes. Hard-deleting a channel and its
content is not offered; declining keeps everything, by the retention convention.

## 9. Superseded decisions

| Decision | Made | Recorded in | Replaced by |
|---|---|---|---|
| A request for an available channel is refused with `INVALID_STATE` so the UI offers Follow | 2026-09-07 | AGENTS.md → Catalog; home spec §13 | Adding an existing channel follows it (§3.1) |
| Requesters see only their own requests | 2026-09-07 | AGENTS.md → Identity model | Requested channels are in everyone's catalog (§4) |
| Approval is refused while the channel is deleted ("restore it first") | 2026-09-07 | AGENTS.md → Catalog | Nothing is deleted; the owner approves a declined channel directly and a user re-requests it after reading the note (§3.1) |
| Approval creates the channel; a request configures nothing before approval | 2026-09-07 | AGENTS.md → Catalog; PRD §4.1 | The request creates the `requested` channel (§3.1) |
| Owner channel deletion is soft (`deleted_at`); restoration preserves follows; deletion stops ingestion and excludes retrieval | 2026-09-07 | AGENTS.md → Catalog, Data conventions; PRD §4.3 | The `declined` status does all three; approve replaces restore (§3.1) |
| Requester count stands in for follower count, which lives only in User DOs | 2026-09-07 | AGENTS.md → Screens; home spec §9.3 | Registry follower record (§3.2) |
| `NON_ENGLISH` as a channel failure code | 2026-09-08 | M3 spec §2 | Episode skip reason (§3.3) |
| Channel failure codes `NO_TRANSCRIPTS`, `NO_EPISODES`, `INITIAL_IMPORT_FAILED`; failed channels leave scheduling; owner channel retry | 2026-09-07/08 | AGENTS.md → Catalog, Ingestion; PRD §4.2 | No channel failure; pause (§3.1, §3.4) |
| Approval-driven automatic follows delivered immediately, including pending and failed channels | 2026-09-10 | AGENTS.md → Catalog; M3 spec §3 | Requesters follow when they request (§3.2) |
| Channel-level `ingestion_waiting_code` | 2026-09-10 | AGENTS.md → Ingestion; M3 spec §3.4 | Episode `waiting_code` (§3.3) |
| Technical failures are never restarted automatically; scheduled runs do not reattempt failed episodes | 2026-09-10 | AGENTS.md → Ingestion; M3 spec §3.4 | Three attempts across runs (§3.3) |
| Scheduled runs select channels independently of follower count | 2026-09-08 | AGENTS.md → Ingestion; PRD §4.2 | Pause at zero followers (§3.2) |
| Only available, non-deleted channels can be followed | 2026-09-07 | AGENTS.md → Catalog; PRD §4.3 | Any `requested` or `approved` channel (§3.2) |

Unchanged and reaffirmed: DownSub as the transcript source, the 48-hour caption wait, the 180-second cutoff, live
and upcoming waits, English-only tracks, cron every 6 hours, fencing by `lifecycle_version`, publish only after
vector verification, soft deletion for every entity other than channels, retention of everything, and hard rule 3
with "approved" in place of "available, non-deleted".

## 10. Acceptance criteria

1. A user pasting a valid new id gets a `requested` channel they follow; it appears in every user's catalog as
   awaiting approval and in the owner queue with that user's email. Pasting a handle or an id with no feed is 400.
2. Pasting an id that is already requested or approved follows the caller and creates nothing. Pasting a declined id
   is 409 with the owner's note and date; `POST /channels/:id/request` then makes it `requested`, follows the caller,
   and the queue shows "previously declined".
3. Approval flips `requested → approved`, sets `approved_at`, starts exactly one run, and changes no follow. There is
   no auto-follow code path left in the API or the User DO. Approving a declined channel that had been approved
   before starts no run and leaves `approved_at` as it was.
4. Declining a requested channel sets `declined` and no run row exists; its followers read "Declined" with the note.
   Declining an approved channel bumps `lifecycle_version`, so a run in flight publishes nothing; its followers read
   "Withdrawn" with the note; its summaries leave digest and chat and return on re-approval.
5. Following a requested or approved channel succeeds; following a declined one is 409 with the note. Each follow
   and unfollow is visible in the Registry follower record, and `followerCount` matches.
6. When the last active follower of a channel unfollows, `paused_by = 'system'` is set; the next follow clears it.
   An owner pause is not cleared by a follow, only by owner resume. Declining clears the flag; approving recomputes it.
7. Cron selects approved, non-paused channels only. A paused channel's summaries stay readable in digest, channel
   history, and chat retrieval. A declined channel's do not.
8. Episode outcomes classify per §3.3: short, non-English, no captions after 48 hours, live after 48 hours, and
   unplayable become `skipped` with the right reason and no owner action; a captionless fresh upload waits with
   `CAPTIONS`; credit exhaustion waits with `PROVIDER_LIMIT` and counts no attempt.
9. A technical error leaves the episode `pending` with `attempt_count` 1 and 2 and is reattempted on the next
   scheduled run; the third makes it `failed`, which appears under Needs attention.
10. Owner retry moves `failed` or `skipped` to `pending`, resets attempts, clears skip fields, starts a one-episode
    run, and leaves sibling summaries untouched; owner skip moves `failed` to `skipped OWNER`. Both are 409 while a
    run is active on the channel.
11. `available` is set only after every vector is verified and a summary stored; `processed_at` never resets on
    retry, refollow, or re-approval.
12. Readers see titles for pending, skipped, and failed episodes with the phrases in §4, and summaries only for
    available ones; digest and unread counts consider available episodes only.
13. `GET /openapi.json` lists exactly the routes in §5, and the removed routes return 404. No route or Registry method
    writes `deleted_at`.
14. Under `wrangler dev`: request → approve → import → one skipped and one available episode → unfollow to zero →
    paused → follow → resumed → decline (withdraw) → request again → approve, with summaries hidden and restored at
    the right steps, recorded in the plan's walkthrough.

## 11. `AGENTS.md` and PRD edits carrying the decisions

- **What this is / Identity model:** follows are recorded in the Registry as well as the User DO; requested channels
  are visible to everyone; "requesters see only their own requests" is removed; "Only the owner can configure/approve,
  delete/restore, or retry catalog channels" becomes "Only the owner can approve, decline, pause, and resume".
- **Catalog, requests, and follows:** rewrite around §3.1–3.2. Remove the request entity, the 409-then-follow rule,
  the auto-follow paragraphs, channel states `pending | available | failed`, channel failure codes, channel retry,
  and the deletion and restoration paragraph. Add `requested | approved | declined`, pause, decline and request again,
  and the follower record.
- **Ingestion pipeline:** remove channel failure classification and the channel waiting code; add episode
  `waiting_code`, `skipped` with reasons, three technical attempts, cron selection by approved and not paused, the
  fence bump on declining an approved channel, and the never-started attention item. Keep the transcript contract,
  chunking, and fencing.
- **Hard rule 3:** "current followed, approved channels".
- **Data & schema conventions:** add `channel_followers` to the Registry's tables; note `channel_requests` and
  `channels.deleted_at` deprecated; "Deletion is soft" stays for every other entity and "channels are never deleted"
  is added.
- **API shape table:** per §5. **Screens:** per §7. **Testing → Lifecycle and retry:** replace the auto-follow,
  channel-failure, and restore bullets with pause, decline and request again, the fence bump on withdraw, episode
  attempts, skip and retry.
- **PRD** §3 principles, §4.1–4.3, §5 schema tables and enumerations, §7 screens, and the route table: the same
  changes. Record the review decisions of 2026-09-10 in §9 or the decisions log the PRD keeps.

## 12. Impact on the M3 plan

- **Step 3:** shared contracts gain the new enums and `Channel` fields; `RequestOutcome` and `ChannelRequest` go.
- **Step 4:** no `failChannel`, no channel `NON_ENGLISH`, no `ingestion_waiting_code`, no `listPendingAutoFollows`
  or `ackAutoFollow`, no `deleteChannel` or `restoreChannel`. Add `recordFollow`/`recordUnfollow` with automatic
  pause, `approveChannel`, `declineChannel` (with the fence bump from approved), `requestChannel`,
  `pauseChannel`/`resumeChannel`, episode `skip`, and the attempt rule in `markTranscript`/`failEpisode`.
- **Step 6:** the Workflow never flips channel state; it publishes episodes only.
- **Step 7:** becomes "start points": first approval and owner add start the initial import; episode retry and skip
  routes; the auto-follow sweep is deleted from the step.
- **Step 8:** cron selects approved, non-paused channels and reattempts pending episodes below three attempts; no
  approval sweep.
- **Step 9:** web copy for skip reasons, pause, "Declined" and "Withdrawn"; the queue and attention list per §7.
- The plan should be revised against this spec before the owner's go, and this spec's own plan can fold into it,
  since both touch the same files.
