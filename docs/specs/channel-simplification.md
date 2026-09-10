# Feature spec — Channel state simplification

**Written:** 2026-09-10, against `main` at `9b08622`, reading the uncommitted 2026-09-10 edits to `AGENTS.md`,
`docs/PRD.md`, and the M3 spec and plan in the working tree.
**Status:** proposed. Drafted from the group PM review of the channel-state proposal and the nine review decisions of
2026-09-10 (§2). Nothing here is implemented; an implementation plan follows acceptance.
**Supersedes, once accepted:** the catalog, request, and follow rules in `AGENTS.md` and PRD §4.1–4.3;
`docs/specs/home-read-experience.md` §6.4, §7, §9.3, and the request routes in §10; `docs/specs/m3-ingestion.md` §2
(channel failure rows), §3.3, §3.4, and the approval path in §3; `docs/specs/m3-ingestion-plan.md` Steps 4, 7, 8, 9
(§12 below lists the edits).

## 1. Summary

A channel becomes an approval container with two statuses, `requested` and `approved`, and stops carrying import
outcomes. Anyone puts a channel into the catalog by pasting its id, which also follows it; the owner approves or
declines. Episodes carry the state machine that matters: `pending`, `available`, `failed`, `skipped`. Technical
failures are retried on three runs before they reach the owner, and deterministic outcomes (too short, non-English,
no captions after the wait, live, unplayable) are skipped automatically. Follows are recorded in the Registry as well
as the User DO, so the owner sees real follower counts and a channel nobody follows is paused rather than ingested.

Gone: the automatic-follow handoff between the Durable Objects, channel failure codes, channel retry, the channel
waiting code, the request entity with its seven outcome phrases, and the follow eligibility guard. Added: a pause
flag, a follower record in the Registry, an episode `skipped` status with reasons, and owner skip and retry per
episode. The timing matters: M3 ingestion is not built, and this removes more of that unbuilt work than it adds.

## 2. Decisions this spec makes

The first block is the PM proposal of 2026-09-10 as amended in review; the second block is the nine review answers.

| Question | Decision | Why |
|---|---|---|
| Channel statuses | **Two: `requested` and `approved`.** The only status transition is owner approval. Deletion (`deleted_at`) and pause (`paused_by`) are flags on either status. | Import outcomes never described the channel well: today `available` is absorbing and every later problem already lives on episodes. Two statuses make the channel what it is, a catalog membership with an approval. |
| Who creates a channel | **Anyone.** A user pasting a `UC…` id or `/channel/UC…` URL creates a `requested` channel and follows it. The owner's add creates it `approved`. | One action for users, no separate request form, and the owner queue is simply the requested channels. |
| Follow guard | **Any non-deleted channel can be followed**, requested or approved. | With requests being follows, gating follows on availability would block the very action that requests a channel. Readability is decided by episode state, not by the follow. |
| Episode metadata on channels | Every channel representation carries `episodes: { tracked, available, pending, waiting, failed, skipped }`, `lastIngestedAt`, `lastCheckedAt`, `followerCount`, and `paused`. | "Approved" no longer promises content, so the reader needs "0 of 5 summarised yet" where today they had "available". The counts already exist in the owner-only management block. |
| Episode statuses | **Four: `pending`, `available`, `failed`, `skipped`.** `processing` and `no_transcript` go. Pending carries an optional wait reason; failed carries the last technical reason; skipped carries a skip reason. | The run table already says what is in progress. "No transcript" is one skip reason among several, not a status of its own. |
| Owner review of episodes | The owner retries or skips a `failed` episode; retry also reopens a `skipped` one. Channel-level retry is removed. | This is the per-episode retry the M3 spec already proposes, made the only retry. |

| Review question (2026-09-10) | Decision | Consequence |
|---|---|---|
| How is a rejected request represented? | **Soft-delete the requested channel.** The note lives on the channel; a fresh request reopens it. Approved-then-deleted channels stay owner-restore-only. | The 2026-09-07 "restore it first" rule survives where content exists and is not needed where none does. |
| Which episode outcomes reach the owner? | **`failed` means technical only.** Deterministic outcomes are skipped by the system. | The queue holds only things a retry can fix. The 2026-09-08 caption-versus-technical distinction survives as skipped versus failed. |
| How does the owner stop a hopeless channel? | **An owner pause flag.** | Scheduling stops, summaries stay readable, resume is one click. Delete stops being the only lever. |
| What are the channel statuses called? | **`requested` and `approved`.** | "Available" is freed to mean readable content, on episodes only. |
| Are requested channels visible to everyone? | **Yes, as awaiting approval.** | Anyone can follow early; the owner sees interest build. Requests stop being private and Home drops its requests list. |
| Do technical failures retry before the owner sees them? | **Up to three attempts across scheduled runs, then `failed`.** Credit exhaustion is a wait, not an attempt. | Transient provider errors clear themselves at no credit cost (errors are not billed). Replaces "never automatically restart technical failures". |
| How do we know who requested a channel? | **Following a requested channel registers the follower in the Registry.** | One action for users. The Registry keeps an active follower record per channel and user. |
| What does `skipped` mean to each role? | **Reversible by owner retry; readers see the title with no summary.** | Channel history stays complete and a wrong automatic skip can be undone. |
| Does unfollowing withdraw a request? | **A channel with no active followers is paused, whatever its status.** Pause lifts on the next follow. | Ingestion follows demand. The Registry tracks active followers for every channel, replacing requester count with a real follower count. |

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
     │        ▲                        │        ▲    first follow / owner resume
  decline   new request             delete   restore (owner only)
     ▼        │                        ▼        │
   requested · declined              approved · removed
   (deleted_at set)                  (deleted_at set, lifecycle_version +1)
```

Columns on `channels` (Registry), see §6 for the migration:

| Column | Values | Rule |
|---|---|---|
| `status` | `requested`, `approved` | Set to `requested` by a user's add, `approved` by the owner's add or approval. Never moves back. |
| `deleted_at` | null or unix ms | Soft delete. On a requested channel it means declined; on an approved one, removed. |
| `paused_by`, `paused_at` | null, `owner`, `system` | No new runs while set. `system` is set when the last active follower leaves and cleared by the next follow. `owner` is set and cleared only by the owner; a system pause never overrides it. |
| `approved_at` | null or unix ms | Set once at approval or owner add. |
| `reviewed_at`, `reviewed_by_email`, `review_note` | nullable | Written by approve and decline. The note is shown to followers of a declined channel and kept when it is reopened. |
| `initial_import_count` | integer, default 5 | Unchanged. Applies to the import started at approval. |
| `lifecycle_version` | integer from 1 | Unchanged. Bumped by delete of an approved channel; no other bump exists once channel retry is gone. |
| `failure_code`, `failure_detail`, `available_at` | deprecated | Kept, never written. `available_at` is replaced by `approved_at`. |

Rules:

- **Create.** `POST /channels` validates the id offline, fetches its RSS feed (404 → `INVALID_INPUT`), and calls the
  Registry's create-only `createChannel` with the feed title. A user's call creates `requested`; the owner's call
  creates `approved` with `approved_at` and starts the initial import. The caller is followed onto the channel
  (§3.2). When the Registry answers `INVALID_STATE` because the id already exists, the route does not fail: an
  existing non-deleted channel is followed; a declined one is reopened (`deleted_at` cleared) and followed; a removed
  one returns 409 `INVALID_STATE` "removed by the owner; ask them to restore it".
- **Approve.** `POST /channels/:id/approve { title?, initialImportCount?, explanation? }`, owner. Requires
  `requested` and not deleted. Sets `status = 'approved'`, `approved_at`, the review fields, and starts the initial
  import. Followers are already following; nothing is handed off.
- **Decline.** `DELETE /channels/:id { explanation? }` on a requested channel, owner. Sets `deleted_at` and the review
  fields. No run ever existed, so no fence bump. Followers keep their rows and read "Declined" with the note.
- **Remove and restore.** `DELETE /channels/:id` on an approved channel and `POST /channels/:id/restore` behave as
  today: soft delete with a `lifecycle_version` bump, restore clears `deleted_at` only. Restoring an approved channel
  never approves or retries anything, and active followers regain access at once.
- **Pause and resume.** `POST /channels/:id/pause` and `POST /channels/:id/resume`, owner. Automatic pause and resume
  are §3.2. A running run finishes; pause only stops new selection. Pause never hides summaries or affects digest,
  chat, or read receipts.
- **No channel failure, no channel retry, no channel waiting code.** A channel with every episode skipped is an
  approved channel with `episodes.available = 0`, visible as such to everyone.

### 3.2 Follows and followers

Follows stay in the User DO (`channel_follows`, unchanged schema; `origin` is always `manual` from now on and
`origin_request_id` is never written). The Registry gains `channel_followers` (§6): one row per channel and email
with `followed_at` and nullable `unfollowed_at`. It exists so the Registry can answer three questions it cannot answer
today: who is waiting on a requested channel, how many people follow a channel, and whether anyone follows it at all.
This is a deliberate change to the privacy split in `AGENTS.md` → Identity model: follow membership becomes shared
Registry data; read receipts, preferences, and chats remain private to the User DO.

- `PUT /follows/:channelId` requires a non-deleted channel of either status, else 409 `INVALID_STATE` (declined:
  "declined by the owner; add it again to reopen"; removed: "removed by the owner"). It writes the User DO first,
  then `registry.recordFollow(channelId, email)`. Both writes are idempotent; if the second fails the route returns
  the error and the client retries. `DELETE /follows/:channelId` mirrors this with `recordUnfollow`. A pair that ends
  up inconsistent is corrected by the next follow or unfollow of that pair; the User DO remains the source of truth
  for what the user sees in their own list, the Registry for counts and the owner queue.
- `POST /channels` by a user performs the same two follow writes after creating or reopening the channel.
- **Automatic pause.** `recordUnfollow` counts the channel's active followers inside the same Registry call; at zero
  it sets `paused_by = 'system'` unless `paused_by = 'owner'`. `recordFollow` clears a `system` pause. Owner resume
  clears either kind; if nobody follows, the next unfollow to zero pauses it again.
- **Eligibility** (`lib/eligibility.ts`, hard rule 3): active follows ∩ `status = 'approved'` ∩ `deleted_at IS NULL`.
  Paused channels are eligible: their existing summaries stay readable and searchable. Requested channels have no
  content and are excluded by status.
- The automatic-follow handoff, `auto_follow_completed_at`, `UserDO.autoFollow`, and the approval sweep are removed.
  `channel_requests` is deprecated (§6).

### 3.3 Episodes

```
   feed entry selected (newest N at approval; new uploads on scheduled runs)
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

Owner actions, both requiring an approved, non-deleted channel with no queued or running run, else 409:

- `POST /channels/:id/episodes/:videoId/retry`: from `failed` or `skipped` to `pending`, attempts and skip fields
  cleared, one-episode `owner_retry` run. Siblings and their summaries are untouched.
- `POST /channels/:id/episodes/:videoId/skip`: from `failed` to `skipped OWNER`.

### 3.4 Scheduling

- **Cron, every 6 hours** (unchanged): select channels with `status = 'approved'`, `deleted_at IS NULL`,
  `paused_by IS NULL`, and no queued or running run. Per channel: new feed entries plus every `pending` episode,
  waiting or below three attempts, including selected episodes that have left the feed.
- **Approval** starts the initial import of the newest `initial_import_count` entries. If the channel is paused
  because nobody follows it, the import still runs once; later runs wait for a follower. `TODO(owner):` confirm, or
  skip the initial import while paused.
- **Reconciliation** (unchanged in intent from the M3 spec): a queued or running run whose Workflow is missing or
  failed is closed and fenced; its episodes keep their attempt counts. An approved channel with no run at all after
  the `TODO(owner)` window appears under Needs attention as "approved, never started" with a Start action that
  requests a run.
- Follower count never affects selection except through pause. A paused channel is skipped, not failed.

## 4. What each role sees

| Channel is | Users see it | Users follow it | Owner actions | Cron |
|---|---|---|---|---|
| `requested` | Yes, "awaiting owner approval", with follower count | Yes; following registers them as a requester | Approve, Decline. Queue shows followers and "nobody is waiting" when paused | No |
| `approved` | Yes, with episode counts; summaries for followers | Yes | Pause, Delete; per-episode Retry and Skip | Yes, unless paused |
| `approved · paused` | Yes, "paused", existing summaries readable | Yes; a follow lifts a system pause | Resume, Delete | No |
| `requested · declined` | Only followers, as "Declined" with the note | Reopen by adding it again | Nothing until reopened | No |
| `approved · removed` | Only followers, as "removed by the owner" | No (409) | Restore | No |

Episodes: readers see every tracked episode's title in channel history; `available` ones carry the summary, others
read "no summary" (`pending`: "not yet"; `skipped`: the humanised reason; `failed`: "the owner has been notified").
Digest, unread counts, and chat use `available` episodes of eligible channels only, exactly as today's `processed`.

## 5. API contract

Entity-based as before: no `/owner/*`, authorization per operation, `management` and `?scope=all` for the owner.

| Route | Who | Change | Purpose |
|---|---|---|---|
| `GET /channels` | anyone | changed | All non-deleted channels, both statuses, each with `status`, `paused`, `following`, `followerCount`, `episodes` counts, `lastIngestedAt`; `?scope=all` (owner) adds deleted channels and `management` |
| `POST /channels { channelId, title?, initialImportCount? }` | anyone | changed | User: create `requested` and follow, or follow the existing one, or reopen a declined one (201 created, 200 existing). Owner: create `approved` and start the import. 409 for a removed channel |
| `GET /channels/:id` | anyone | changed | Any non-deleted channel; deleted only for followers (so their list can explain itself) and the owner |
| `POST /channels/:id/approve { title?, initialImportCount?, explanation? }` | owner | new | `requested → approved`, starts the import |
| `DELETE /channels/:id { explanation? }` | owner | changed | Decline a requested channel or remove an approved one |
| `POST /channels/:id/restore` | owner | unchanged | Approved and deleted only |
| `POST /channels/:id/pause`, `POST /channels/:id/resume` | owner | new | Owner pause; resume clears any pause |
| `POST /channels/:id/retry` | owner | **removed** | |
| `GET /channels/:id/episodes?limit=` | anyone | changed | Episode `status` takes the new values; `skipReason`, `waitingCode`, `attemptCount` in the owner's `processing` block |
| `POST /channels/:id/episodes/:videoId/retry` | owner | as planned | From `failed` or `skipped` |
| `POST /channels/:id/episodes/:videoId/skip` | owner | new | From `failed` |
| `GET /channels/:id/ingestion-runs` | owner | unchanged | |
| `GET /channels/:id/followers` | owner | new, replaces `/requests` | Emails and `followedAt` of active followers; the UI shows emails only in the queue and counts elsewhere |
| `GET /follows`, `PUT /follows/:channelId`, `DELETE /follows/:channelId` | anyone (own) | changed | Any non-deleted channel; each write also records the follower in the Registry |
| `GET /channel-requests`, `POST /channel-requests`, `…/approve`, `…/reject` | | **removed** | Requests are channels |
| `GET /catalog` | owner | changed | `channels: { requested, approved, paused, deleted }`, `episodes: { available, pending, waiting, failed, skipped }`, `attention: { failedEpisodes, neverStarted, requested }`, `lastSuccessfulIngestionAt`, `transcripts.remainingCredits` |
| `GET /digest`, chats, preferences, `/me` | | unchanged | |

Shared schemas: `ChannelStatus` becomes `requested | approved`; `ChannelFailureCode`, `CatalogState`,
`RequestOutcome`, `ChannelRequest*` are removed; `EpisodeStatus` becomes `pending | available | failed | skipped`;
`EpisodeSkipReason` and `EpisodeWaitingCode` are added; `Channel` gains `paused`, `followerCount`, `episodes`,
`approvedAt`, `reviewNote`; `ChannelManagement` loses `failureDetail`, `availableAt`, `requesterCount`, `stuckPending`
and gains `pausedBy`, `pausedAt`, `reviewedAt`, `reviewedByEmail`, `neverStarted`. The OpenAPI coverage test keeps
document and routes in step.

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
- Index `channels(status, deleted_at, paused_by)` for cron selection.

Value changes are code, not schema: `status` is `TEXT` in both tables. Two data questions need the owner because the
migration convention is additive only:

- `TODO(owner):` existing `channels` rows were all created by approval or owner add, so they map to
  `status = 'approved', approved_at = created_at`; failed ones lose their channel failure and are judged by their
  episodes. Apply as one `UPDATE` in the migration, or leave old rows to be corrected by hand in local dev.
- `TODO(owner):` existing pending `channel_requests` rows: convert each into a `requested` channel plus a follower
  record for the requester, or discard. The table itself stays, unwritten, per the convention.

No User DO migration: `channel_follows` is unchanged. Episodes have no production rows yet (M3 is unbuilt), so the
status rename costs nothing there.

## 7. Screens

- **Home, Channels.** Two subsections. **Followed** (`GET /follows`): approved rows show "N summarised · M unread ·
  ingested X" and link to the channel; requested rows show "awaiting owner approval"; paused rows add "paused";
  declined rows show "Declined" with the note and a link to add it again; removed rows show "removed by the owner".
  Unfollow on every row. **Catalog** (`GET /channels` minus follows): approved channels with summarised counts and
  Follow; requested channels with "awaiting approval · N following" and Follow. Below both, one **Add a channel**
  input for a `UC…` id or `/channel/UC…` URL with the copy-the-id hint. Its result is the channel row, whether
  created, reopened, or already present, and the row appears under Followed. The "Your requests" subsection, the
  request outcome phrases, and the polling are removed; the one remaining poll is for followed requested channels,
  every 15 s, until approved or declined.
- **Channel `/channel/:id`.** Any non-deleted channel. Requested: header, "awaiting owner approval", Follow or
  Unfollow, no episodes. Approved: as today, plus `skipped` and `pending` episodes listed by title with their phrase.
- **Owner `/owner`.** **Queue**: requested, non-deleted channels oldest first with title, id linked to YouTube,
  active followers by email, "nobody is waiting" when paused, Approve (title, import count, note) and Decline (note).
  Reviewed history collapsed: reviewer, time, note. **Needs attention**: `failed` episodes grouped by channel with
  reason, attempts, Retry and Skip; approved channels never started, with Start. **All channels**: status, paused,
  deleted, `available / tracked` with skipped and failed counts, followers, last ingested, latest run, and actions
  Pause or Resume, Delete or Restore, Approve or Decline for requested rows. Health strip from `GET /catalog`.
- **Owner channel detail `/owner/channels/:id`.** Header with status, pause, approval and review fields, lifecycle
  version, import count, follower count; episodes with status, wait reason, attempts, failure or skip reason,
  summary format, Retry and Skip; runs; followers (emails) for requested channels, count only for approved ones.
  Never any user's read or chat activity.

## 8. Out of scope

Bulk retry across channels, editing a channel's import count after approval, follower lists beyond what §7 shows,
notifications, any authentication, and a general admin dashboard. A channel-level "re-import everything" is not
needed: the owner retries episodes.

## 9. Superseded decisions

| Decision | Made | Recorded in | Replaced by |
|---|---|---|---|
| A request for an available channel is refused with `INVALID_STATE` so the UI offers Follow | 2026-09-07 | AGENTS.md → Catalog; home spec §13 | Adding an existing channel follows it (§3.1) |
| Requesters see only their own requests | 2026-09-07 | AGENTS.md → Identity model | Requested channels are in everyone's catalog (§4) |
| Approval is refused while the channel is deleted | 2026-09-07 | AGENTS.md → Catalog | Kept for removed approved channels; a declined requested channel is reopened by a new request (§3.1) |
| Approval creates the channel; a request configures nothing before approval | 2026-09-07 | AGENTS.md → Catalog; PRD §4.1 | The request creates the `requested` channel (§3.1) |
| Requester count stands in for follower count, which lives only in User DOs | 2026-09-07 | AGENTS.md → Screens; home spec §9.3 | Registry follower record (§3.2) |
| `NON_ENGLISH` as a channel failure code | 2026-09-08 | M3 spec §2 | Episode skip reason (§3.3) |
| Channel failure codes `NO_TRANSCRIPTS`, `NO_EPISODES`, `INITIAL_IMPORT_FAILED`; failed channels leave scheduling; owner channel retry | 2026-09-07/08 | AGENTS.md → Catalog, Ingestion; PRD §4.2 | No channel failure; pause (§3.1, §3.4) |
| Approval-driven automatic follows delivered immediately, including pending and failed channels | 2026-09-10 | AGENTS.md → Catalog; M3 spec §3 | Requesters follow when they request (§3.2) |
| Channel-level `ingestion_waiting_code` | 2026-09-10 | AGENTS.md → Ingestion; M3 spec §3.4 | Episode `waiting_code` (§3.3) |
| Technical failures are never restarted automatically; scheduled runs do not reattempt failed episodes | 2026-09-10 | AGENTS.md → Ingestion; M3 spec §3.4 | Three attempts across runs (§3.3) |
| Scheduled runs select channels independently of follower count | 2026-09-08 | AGENTS.md → Ingestion; PRD §4.2 | Pause at zero followers (§3.2) |
| Only available, non-deleted channels can be followed | 2026-09-07 | AGENTS.md → Catalog; PRD §4.3 | Any non-deleted channel (§3.2) |

Unchanged and reaffirmed: DownSub as the transcript source, the 48-hour caption wait, the 180-second cutoff, live
and upcoming waits, English-only tracks, cron every 6 hours, fencing by `lifecycle_version`, publish only after
vector verification, soft deletion everywhere, and hard rule 3 with "approved" in place of "available".

## 10. Acceptance criteria

1. A user pasting a valid new id gets a `requested` channel they follow; it appears in every user's catalog as
   awaiting approval and in the owner queue with that user's email. Pasting a handle or an id with no feed is 400.
2. Pasting an id that is already approved follows the caller and creates nothing; pasting a declined id reopens it;
   pasting a removed id is 409 with "ask the owner to restore it".
3. Approval flips `requested → approved`, sets `approved_at`, starts exactly one run, and changes no follow. There is
   no auto-follow code path left in the API or the User DO.
4. Decline soft-deletes a requested channel and its followers see "Declined" with the note; no run row exists.
5. Following any non-deleted channel succeeds; following a deleted one is 409. Each follow and unfollow is visible in
   the Registry follower record, and `followerCount` matches.
6. When the last active follower of a channel unfollows, `paused_by = 'system'` is set; the next follow clears it.
   An owner pause is not cleared by a follow, only by owner resume.
7. Cron selects approved, non-deleted, non-paused channels only. A paused channel's summaries stay readable in digest,
   channel history, and chat retrieval.
8. Episode outcomes classify per §3.3: short, non-English, no captions after 48 hours, live after 48 hours, and
   unplayable become `skipped` with the right reason and no owner action; a captionless fresh upload waits with
   `CAPTIONS`; credit exhaustion waits with `PROVIDER_LIMIT` and counts no attempt.
9. A technical error leaves the episode `pending` with `attempt_count` 1 and 2 and is reattempted on the next
   scheduled run; the third makes it `failed`, which appears under Needs attention.
10. Owner retry moves `failed` or `skipped` to `pending`, resets attempts, clears skip fields, starts a one-episode
    run, and leaves sibling summaries untouched; owner skip moves `failed` to `skipped OWNER`. Both are 409 while a
    run is active on the channel.
11. `available` is set only after every vector is verified and a summary stored; `processed_at` never resets on
    retry, refollow, or restore.
12. Readers see titles for pending, skipped, and failed episodes with the phrases in §4, and summaries only for
    available ones; digest and unread counts consider available episodes only.
13. `GET /openapi.json` lists exactly the routes in §5, and the removed routes return 404.
14. Under `wrangler dev`: request → approve → import → one skipped and one available episode → unfollow to zero →
    paused → follow → resumed, recorded in the plan's walkthrough.

## 11. `AGENTS.md` and PRD edits carrying the decisions

- **What this is / Identity model:** follows are recorded in the Registry as well as the User DO; requested channels
  are visible to everyone; "requesters see only their own requests" is removed.
- **Catalog, requests, and follows:** rewrite around §3.1–3.2. Remove the request entity, the 409-then-follow rule,
  the auto-follow paragraphs, channel states `pending | available | failed`, channel failure codes, and channel retry.
  Add `requested | approved`, pause, decline and reopen, and the follower record.
- **Ingestion pipeline:** remove channel failure classification and the channel waiting code; add episode
  `waiting_code`, `skipped` with reasons, three technical attempts, cron selection by approved and not paused, and
  the never-started attention item. Keep the transcript contract, chunking, and fencing.
- **Hard rule 3:** "current followed, approved, non-deleted channels".
- **API shape table:** per §5. **Screens:** per §7. **Testing → Lifecycle and retry:** replace the auto-follow and
  channel-failure bullets with pause, decline and reopen, episode attempts, skip and retry.
- **Data & schema conventions:** add `channel_followers` to the Registry's tables; note `channel_requests` deprecated.
- **PRD** §3 principles, §4.1–4.3, §5 schema tables and enumerations, §7 screens, and the route table: the same
  changes. Record the review decisions of 2026-09-10 in §9 or the decisions log the PRD keeps.

## 12. Impact on the M3 plan

- **Step 3:** shared contracts gain the new enums and `Channel` fields; `RequestOutcome` and `ChannelRequest` go.
- **Step 4:** no `failChannel`, no channel `NON_ENGLISH`, no `ingestion_waiting_code`, no `listPendingAutoFollows`
  or `ackAutoFollow`. Add `recordFollow`/`recordUnfollow` with automatic pause, `approveChannel`, `declineChannel`,
  `pauseChannel`/`resumeChannel`, episode `skip`, and the attempt rule in `markTranscript`/`failEpisode`.
- **Step 6:** the Workflow never flips channel state; it publishes episodes only.
- **Step 7:** becomes "start points": approval and owner add start the initial import; episode retry and skip routes;
  the auto-follow sweep is deleted from the step.
- **Step 8:** cron selects approved, non-deleted, non-paused channels and reattempts pending episodes below three
  attempts; no approval sweep.
- **Step 9:** web copy for skip reasons and pause; the queue and attention list per §7.
- The plan should be revised against this spec before the owner's go, and this spec's own plan can fold into it,
  since both touch the same files.
