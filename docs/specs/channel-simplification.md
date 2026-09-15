# Feature spec — Channel state simplification

**Written:** 2026-09-10, against `main` at `9b08622`, reading the uncommitted 2026-09-10 edits to `AGENTS.md`,
`docs/PRD.md`, and the M3 spec and plan in the working tree.
**Revised:** 2026-09-10, same day, twice. First: declining is a channel status, not a soft delete; channels are never
deleted. Second: the application has no production data, so the initial migrations are rewritten rather than
extended, the two data questions are closed, and the initial import runs at first approval regardless of followers
(§2, second table, last three rows; §6).
**Status:** accepted and merged to `main` at `6e075b1` (2026-09-10). The owner's browser walkthrough of Home, Channel,
Owner, and Owner channel detail was completed the same day with no defects reported. The M3 spec and plan were
revised against §12 the same day (`docs/specs/m3-ingestion.md`, `docs/specs/m3-ingestion-plan.md`), as were
`AGENTS.md` and the home read-experience spec and plan.
**Supersedes, once accepted:** the catalog, request, follow, and deletion rules in `AGENTS.md` and PRD §4.1–4.3;
`docs/specs/home-read-experience.md` §6.4, §7, §9.3, and the request routes in §10; `docs/specs/m3-ingestion.md` §2
(channel failure rows), §3.3, §3.4, and the approval path in §3; `docs/specs/m3-ingestion-plan.md` Steps 4, 7, 8, 9
(§12 below lists the edits). It also takes a one-time, owner-approved exception to two `AGENTS.md` schema rules (§6).

**Superseded for screens 2026-09-15.** The Design phase (`docs/specs/design-phase.md`) rebuilt the reader's and the
owner's screens: Home is gone, split into `/queue`, `/sources` and `/chats`; a summary has its own screen at
`/read/:episodeId`; `/history` is the library and the only place a receipt is undone; `/channel/:id` became
`/sources/:id` and `/owner*` became `/curate*`; the digest's 24-hour window and its marks-on-return rule are both
gone. The screen descriptions below are what was on `main` until then and are kept for their reasoning, not as a
description of the product. `docs/PRD.md` §7 is current; `docs/design.md` governs how any of it looks.


## 1. Summary

A channel becomes an approval container with three statuses, `requested`, `approved`, and `declined`, and stops
carrying import outcomes. Anyone puts a channel into the catalog by pasting its id, which also follows it; the owner
approves or declines. Declining is the one answer to both "no, not this channel" and "we are withdrawing this one":
it stops scheduling by itself, hides the channel from the catalog list, keeps everything it produced, and can be
undone by the owner approving it again or by a user requesting it again after reading the owner's note. Channels are
never deleted, softly or otherwise.

Episodes carry the state machine that matters: `pending`, `available`, `failed`, `skipped`. Every unfinished,
non-deterministic outcome recovers every six hours for one 48-hour window; only short, non-English, and unplayable
episodes skip automatically. Follows are recorded in the Registry as well as the User DO, so the owner sees real
follower counts and a channel nobody follows is paused rather than discovered again.

Gone: the automatic-follow handoff between the Durable Objects, channel failure codes, channel retry, the channel
waiting code, channel soft delete and restore, the request entity with its seven outcome phrases, and the follow
eligibility guard. Added: a `declined` status, a pause flag, a follower record in the Registry, an episode `skipped`
status with reasons, and owner skip and retry per episode. Because nothing is deployed, the schema is rewritten to
match the model exactly: no deprecated columns, no deprecated table. The timing matters twice over: M3 ingestion is
not built, so this removes more of that unbuilt work than it adds, and there is no data to carry.

## 2. Decisions this spec makes

The first block is the PM proposal of 2026-09-10 as amended in review; the second block is the review answers.

| Question | Decision | Why |
|---|---|---|
| Channel statuses | **Three: `requested`, `approved`, `declined`.** Pause (`paused_by`) is a flag on approved channels. Nothing is deleted. | Import outcomes never described the channel well: today `available` is absorbing and every later problem already lives on episodes. Three statuses on one axis make the channel what it is, a catalog membership with the owner's answer. |
| Who creates a channel | **Anyone.** A user pasting a `UC…` id or `/channel/UC…` URL creates a `requested` channel and follows it. The owner's add created it `approved` until 2026-09-12; now every add creates `requested` (PRD §9). | One action for users, no separate request form, and the owner queue is simply the requested channels. |
| Follow guard | **Any `requested` or `approved` channel can be followed.** Following a declined one is "request again" (§3.1). | With requests being follows, gating follows on availability would block the very action that requests a channel. Readability is decided by episode state, not by the follow. |
| Episode metadata on channels | Every channel representation carries `episodes: { tracked, available, pending, waiting, failed, skipped }`, derived `lastIngestedAt`, `lastCheckedAt`, `followerCount`, and `paused`. | "Approved" no longer promises content, so the reader needs "0 of 5 summarised yet" where today they had "available". `lastIngestedAt` becomes `MAX(episodes.processed_at)` in M3 so an episode Retry never writes the channel. |
| Episode statuses | **Four: `pending`, `available`, `failed`, `skipped`.** `processing` and `no_transcript` go. Pending's wait or technical reason lives on its latest attempt (2026-09-12); failed carries `INGESTION_TIMEOUT` with that reason as detail; skipped carries a skip reason. | The run table already says what is in progress. "No transcript" is one skip reason among several, not a status of its own. |
| Owner review of episodes | The owner retries or skips a `failed` episode; retry also reopens a `skipped` one. Channel-level retry is removed. | This is the per-episode retry the M3 spec already proposes, made the only retry. |

| Review question (2026-09-10) | Decision | Consequence |
|---|---|---|
| How is a rejected request represented? | First answer: soft-delete the requested channel. **Revised the same day: a `declined` status** (below). | Recorded for the trail; the declined row is the operative decision. |
| Which episode outcomes reach the owner? | **`failed` means technical only.** Deterministic outcomes are skipped by the system. | The queue holds only things a retry can fix. The 2026-09-08 caption-versus-technical distinction survives as skipped versus failed. |
| How does the owner stop a hopeless channel? | **An owner pause flag.** | Scheduling stops, summaries stay readable, resume is one click. |
| What are the channel statuses called? | **`requested` and `approved`**, later joined by `declined`. | "Available" is freed to mean readable content, on episodes only. |
| Are requested channels visible to everyone? | **Yes, as awaiting approval.** | Anyone can follow early; the owner sees interest build. Requests stop being private and Home drops its requests list. |
| Do unsuccessful episodes retry before the owner sees them? | **Yes, every six hours for one 48-hour processing window.** Waiting, provider, technical, oversized-transcript, AI, Vectorize, and lost-Workflow outcomes all use the same deadline; there is no three-attempt terminal rule. | One recovery policy is predictable. `attempt_count` remains diagnostic history; only the deadline makes an unfinished publication `failed`. |
| How do we know who requested a channel? | **Following a requested channel registers the follower in the Registry.** | One action for users. The Registry keeps an active follower record per channel and user. |
| What does `skipped` mean to each role? | **Reversible by owner retry; readers see the title with no summary.** | Channel history stays complete and a wrong automatic skip can be undone. |
| Does unfollowing withdraw a request? | **A channel with no active followers is paused, whatever its status.** Pause lifts on the next follow. | Ingestion follows demand. The Registry tracks active followers for every channel, replacing requester count with a real follower count. |
| Should declining soft-delete the channel, or be a status? | **A `declined` status; nothing is deleted.** Declined excludes scheduling by itself, so it is never also paused. A user re-requests a declined channel after seeing the owner's note, with one confirmation; the owner may approve a declined channel directly. Declining an approved channel confirms once in the UI. Copy says "Declined" when the channel was never approved and "Withdrawn" when it was. | One field describes the channel. The `deleted_at` axis, the restore route, the "restore it first" guards, and the two meanings of deletion all go. Approve and Decline become the only owner verbs at channel level, with Pause and Resume. |
| Is there production data to migrate? | **No.** The application is not deployed; local Durable Object state is wiped once and the initial migrations are rewritten to the new model (§6). | No data migration, no deprecated columns or tables, no compatibility shims. At the time a one-time, owner-approved exception to "never edit a committed migration" and "migrations are additive only"; both rules were withdrawn outright on 2026-09-12 (PRD §5.4). |
| Does the initial import run at first approval when nobody follows yet? | **Yes.** The newest `initial_import_count` entries are imported once; later runs wait for a follower. | The owner asked for the channel explicitly, the cost is at most five credits, and the catalog can show "N summarised" so people can judge the channel before following it. Recommended in review and adopted. |

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
       │     │                    (no fence)    │
       ▼     │                         ▼        │
   ┌────────────────────────────────────────────────┐
   │  declined   hidden from the catalog list; followers keep the row and read the owner's note   │
   └────────────────────────────────────────────────┘
```

Columns on `channels` (Registry), exactly as §6 creates them:

| Column | Values | Rule |
|---|---|---|
| `status` | `requested`, `approved`, `declined` | `requested` by a user's add or re-request; `approved` by approval (the owner's add shortcut was removed 2026-09-12); `declined` by the owner. Every transition is in the rules below; there is no other. |
| `paused_by`, `paused_at` | null, `owner`, `system`; both set or both null | `approved` only, enforced by a check. No new feed-discovery runs while set; already discovered episodes keep recovering. `system` is set when the last active follower leaves and cleared by the next follow. `owner` is set and cleared only by the owner; a system pause never overrides it. Cleared on decline, recomputed on approve. |
| `approved_at` | null or unix ms; non-null whenever `status = 'approved'` | Set the first time the channel is approved and never reset. Decides whether a later approval starts an initial import, and whether copy says "Declined" or "Withdrawn". |
| `reviewed_at`, `reviewed_by_email`, `review_note` | nullable; the first two non-null whenever the status is not `requested` | Written by approve, decline, and owner add (the owner is the reviewer); the latest review only. Kept when a declined channel is re-requested, so the queue can show it. A review log is out of scope (§8). |
| `initial_import_count` | integer, default 5 | Unchanged. Applies to the import started at first approval. |
| `lifecycle_version` | removed 2026-09-11 | Was the fence for run writes. Dropped by migration `0002_drop_lifecycle_version.sql` on 2026-09-11, then absent from the `0001` rewritten on 2026-09-12; the 2026-09-12 design gives episode recovery its own lifecycle independent of channel status. |
| `last_checked_at` | nullable unix ms | Stored feed-check time, changed only by a feed-aware channel run. |
| `last_ingested_at` | removed 2026-09-12 | Gone from the rewritten `0001`; the API derives `lastIngestedAt` from episode `processed_at`. |

There is no `deleted_at`, `failure_code`, `failure_detail`, or `available_at`.

Rules:

- **Create.** `POST /channels { channelId, title?, initialImportCount? }` validates the id offline, fetches its RSS
  feed (404 → `INVALID_INPUT`), and calls the Registry's create-only `createChannel` with the feed title. Every
  call creates `requested` (until 2026-09-12 the owner's call created `approved` and started the initial import;
  PRD §9). The caller is followed onto the channel (§3.2). When the Registry answers `INVALID_STATE` because
  the id already exists, the route does not fail: a `requested` or `approved` channel is followed and returned with
  200; a `declined` one is returned as 409 `INVALID_STATE` with `{ channelId, status: "declined", reviewNote,
  reviewedAt }` so the client can show the note and offer "Request again". The Registry stays create-only, as decided
  in `db26c74`.
- **Request again.** `POST /channels/:id/request`, anyone. Requires `declined`. Sets `status = 'requested'`, keeps the
  review fields for the queue to show, and follows the caller. This is the only way out of `declined` for a user, and
  it is explicit: the client asks once, showing the owner's note and date.
- **Approve.** `POST /channels/:id/approve { title?, initialImportCount?, explanation? }`, owner. Requires
  `requested` or `declined`. Sets `status = 'approved'`, the review fields, and `approved_at` if null. Starts the
  initial import only when `approved_at` was null, whether or not anyone follows yet; a re-approved channel is picked
  up by the next scheduled run. Recomputes pause from the follower count. Followers are already following; nothing is
  handed off.
- **Decline.** `POST /channels/:id/decline { explanation? }`, owner. Requires `requested` or `approved`. Sets
  `status = 'declined'` and the review fields. From `approved` it also clears the pause. Future feed discovery stops,
  but recovery of already discovered episodes continues independently; any resulting summary remains hidden from
  readers until re-approval. Episodes, summaries, vectors, follows, and read receipts are kept. The UI
  confirms once when declining an approved channel, showing its follower count.
- **Pause and resume.** `POST /channels/:id/pause` and `POST /channels/:id/resume`, owner, `approved` only.
  Automatic pause and resume are §3.2. Pause stops feed discovery, not episode recovery. Pause never hides summaries
  or affects digest, chat, or read receipts.
- **No channel failure, no channel retry, no channel waiting code, no channel deletion.** A channel with every
  episode skipped is an approved channel with `episodes.available = 0`, visible as such to everyone.

### 3.2 Follows and followers

**Superseded 2026-09-13** (`docs/specs/follows-single-owner.md`, PRD §9): follows now live only in the Registry's
`channel_followers`; the User DO's `channel_follows` table and the two-write rule below are gone. The follower
record, the automatic pause, and the eligibility definition stand.

Follows stay in the User DO (`channel_follows`), reduced to what they are: the channel id, when the follow started,
and when it ended. The `origin` and `origin_request_id` columns go with the automatic follow (§6). The Registry gains
`channel_followers`: one row per channel and email with `followed_at` and nullable `unfollowed_at`. It exists so the
Registry can answer three questions it cannot answer today: who is waiting on a requested channel, how many people
follow a channel, and whether anyone follows it at all. This is a deliberate change to the privacy split in
`AGENTS.md` → Identity model: follow membership becomes shared Registry data; read receipts, preferences, and chats
remain private to the User DO.

- `PUT /follows/:channelId` requires a `requested` or `approved` channel, else 409 `INVALID_STATE` with the channel's
  status and note ("declined by the owner; request it again"). It writes the User DO first, then
  `registry.recordFollow(channelId, email)`. Both writes are idempotent; if the second fails the route returns the
  error and the client retries. `DELETE /follows/:channelId` mirrors this with `recordUnfollow` and works on any
  status. A pair that ends up inconsistent is corrected by the next follow or unfollow of that pair; the User DO
  remains the source of truth for what the user sees in their own list, the Registry for counts and the owner queue.
- `POST /channels` and `POST /channels/:id/request` by a user perform the same two follow writes after creating or
  re-requesting the channel.
- **Automatic pause.** `recordUnfollow` counts the channel's active followers inside the same Registry call; at zero
  on an `approved` channel it sets `paused_by = 'system'` unless `paused_by = 'owner'`. `recordFollow` clears a
  `system` pause. Owner resume clears either kind; if nobody follows, the next unfollow to zero pauses it again. A
  `requested` channel is never paused; the queue derives "nobody is waiting" from a follower count of zero.
- **Eligibility** (`lib/eligibility.ts`, hard rule 3): active follows ∩ `status = 'approved'`. Paused channels are
  eligible: their existing summaries stay readable and searchable. Requested channels have no content and declined
  ones are excluded, both by status.
- The automatic-follow handoff, `UserDO.autoFollow`, the approval sweep, and the `channel_requests` table are removed.

### 3.3 Episodes

```
   feed entry discovered (newest N at first approval; new uploads on scheduled runs)
          │
          ▼
   ┌─────────────┐   unfinished after 48 hours  ┌──────────┐
   │   pending   │ ───────────────────────────► │  failed  │
   │ recovering  │ ◄─────────────────────────── │          │
   └─────────────┘   owner Retry: new window    └──────────┘
      │       ▲                                     │
      │       │ owner retry                         │ owner skip
      │       │                                     ▼
      │   ┌───────────┐ ◄───────────────────────────┘
      │   │  skipped  │  system: SHORT · NON_ENGLISH · UNPLAYABLE; owner: OWNER
      │   └───────────┘
      ▼
   ┌─────────────┐
   │  available  │  may also carry a `replace` window while its old summary remains readable
   └─────────────┘
```

| Column | Values | Rule |
|---|---|---|
| `status` | `pending`, `available`, `failed`, `skipped` | Readable content state. Active processing is described by the window columns, so an available episode can generate a replacement without disappearing. |
| `discovered_by_run_id` | an ingestion run id | Immutable provenance: the feed-discovery run that created the episode. It replaces new M3 writes to `ingestion_run_episodes`. |
| `intent`, window timestamps | `publication`, `replacement`, or null; `window_started_at`, `window_deadline_at`, `next_attempt_at` | New episodes open a `publish` window immediately. Every unsuccessful result schedules another attempt six hours later. At 48 hours publication becomes failed; replacement ends while the old summary remains available. An Owner Retry that passes pre-flight starts a new window. |
| `waiting_code` | removed 2026-09-12 | Gone from the rewritten `0001`; the latest attempt carries the waiting reason. |
| `attempt_count`, `failure_code`, `failure_detail` | count from 0; `INGESTION_TIMEOUT` and the latest attempt's reason, written once at the deadline | Diagnostic count that never makes an episode terminal; the deadline does. Technical reasons before the deadline live on the attempt. |
| `skip_reason`, `skipped_at`, `skipped_by_email` | `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`, `OWNER`; present exactly when `skipped` | System skips carry a reason and no email; owner skips carry `OWNER` and the owner's email. Cleared by owner Retry. |
| vector generations | `active_vector_generation`, `staged_vector_generation` | Attempts stage vectors under the staged generation. Publication switches the active generation only after the full set and summary are ready, and the attempt then deletes the previous generation; an abandoned staged generation is deleted by the episode's next attempt. |
| `transcript_checked_at`, `chunk_count`, `vectorized_at`, `processed_at` | as in the M3 spec | `processed_at` is first `summaryAvailableAt` and never resets. |

Classification, carrying the 2026-09-08 rules onto the new statuses:

- Under 180 seconds → `skipped SHORT`, nothing stored. Captions exist but none English → `skipped NON_ENGLISH`.
- No captions → the attempt finishes `waiting CAPTIONS`; live or upcoming → `waiting LIVE_OR_UPCOMING`; the episode
  stays `pending` with its next attempt time and no reason of its own. Both retry every six hours and use the same
  episode recovery deadline as every other unfinished outcome.
- `UNPLAYABLE` → `skipped UNPLAYABLE`. The owner can retry it if the video becomes public.
- `PROVIDER_LIMIT` finishes the attempt `waiting PROVIDER_LIMIT` and leaves the window open with the next attempt six
  hours later.
- `PROVIDER_HTTP`, `PROVIDER_PARSE`, `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `VECTORIZE_FAILED`,
  `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED`, `WORKFLOW_LOST`, and `TRANSCRIPT_TOO_LARGE` record
  the attempt and retry six hours later. None fails early because of its count.
- At `window_deadline_at`, pre-flight permits one final attempt. If pre-flight blocks or that attempt remains
  unfinished, publication becomes `failed INGESTION_TIMEOUT`; its detail retains the latest reason. An unfinished
  replacement leaves the episode available and records the timeout.
- `available` is published only after the complete staged vector generation and summary are ready, so an
  available replacement cannot damage the current summary's retrieval data. Superseded and abandoned generations are
  deleted by the attempts that follow them, and retrieval verifies each vector's generation before using its text
  (`m3-ingestion.md` §2 "Publishing").

Owner actions are independent of both channel status and channel runs:

- `POST /channels/:id/episodes/:episodeId/retry`: any episode state and any channel status. When pre-flight permits, it
  opens a new 48-hour window, `publish` or `replace`, and one immediate episode attempt. A blocked pre-flight
  records a blocked owner attempt but leaves episode and recovery state unchanged. Retry is refused only while that
  episode has a running attempt; a running attempt older than an hour whose instance is gone is reconciled inline
  and the Retry proceeds.
- `POST /channels/:id/episodes/:episodeId/skip`: `failed → skipped OWNER` in any channel status.

### 3.4 Scheduling

- **Channel discovery, every 6 hours:** `0 */6 * * *` selects `approved`, non-paused channels and reads RSS only.
  It creates previously unknown episodes and never selects an existing one.
- **Episode recovery, every 6 hours:** `30 */6 * * *` selects every open window due at `next_attempt_at`, without
  joining channel status or pause. It reconciles old running attempts, applies 48-hour deadlines, checks DownSub
  status once, and starts due attempts when the provider is available, spaced three seconds apart. A provider block
  at the deadline closes the window instead of scheduling a later check.
- **First approval** starts the initial import of the newest `initial_import_count` entries, whether or not anyone
  follows yet (decided 2026-09-10). If nobody follows, the channel is paused by the system at approval while that
  one run still proceeds, and later runs wait for a follower. A later approval, after a decline, starts nothing; the
  next scheduled run picks the channel up.
- **Reconciliation** (decided 2026-09-11, revised 2026-09-12): at each recovery tick, a running episode attempt whose
  Workflow is missing or gone after one hour closes `failed WORKFLOW_LOST`; the episode remains in its processing window
  and is due again six hours later. An approved channel with no discovery run at all appears
  under Needs attention as "approved, never started", with no age window, and a Start action that requests a run.
- Follower count affects only discovery through pause. Paused and declined channels do no discovery; their already
  discovered episodes remain eligible for recovery.

## 4. What each role sees

| Channel is | Users see it | Users follow it | Owner actions | Cron |
|---|---|---|---|---|
| `requested` | Yes, "awaiting owner approval", with follower count | Yes; following registers them as a requester | Approve, Decline. Queue shows followers and "nobody is waiting" when none | No |
| `approved` | Yes, with episode counts; summaries for followers | Yes | Decline (confirms once), Pause; per-episode Retry and Skip | Discovery and episode recovery |
| `approved · paused` | Yes, "paused", existing summaries readable | Yes; a follow lifts a system pause | Resume, Decline; per-episode Retry and Skip | Episode recovery only |
| `declined`, never approved | Not in the catalog list. Followers see "Declined" with the note and Request again; anyone who pastes the id sees the same | Request again (one confirmation) | Approve; per-episode Retry and Skip when an episode exists | Episode recovery only |
| `declined`, previously approved | Not in the catalog list. Followers see "Withdrawn" with the note and Request again | Request again (one confirmation) | Approve; no new initial import; per-episode Retry and Skip | Episode recovery only |

Episodes: readers see every tracked episode's title in channel history; `available` ones carry the summary, others
read "no summary" (`pending`: the wait reason from its latest attempt, else "not yet" (`waitReason`, 2026-09-12);
`skipped`: the humanised reason; `failed`: "the owner has been notified").
Digest, unread counts, and chat use `available` episodes of eligible channels only.

## 5. API contract

Entity-based as before: no `/owner/*`. `management` and `?scope=all` were the owner's until 2026-09-12, when the API
stopped enforcing any authorization (PRD §9): every operation, `?scope=all`, and `management` are open to every caller.

| Route | Who | Change | Purpose |
|---|---|---|---|
| `GET /channels` | anyone | changed | `requested` and `approved` channels, each with `status`, `paused`, `following`, `followerCount`, `episodes` counts, `lastIngestedAt`; `?scope=all` (owner) adds `declined` channels and `management` |
| `POST /channels { channelId, title?, initialImportCount? }` | anyone | changed | User: create `requested` and follow (201), or follow the existing `requested`/`approved` one (200). Owner: created `approved` and started the import (201) until 2026-09-12; now the same as a user's call. A `declined` id is 409 `INVALID_STATE` with `channelId`, `status`, `reviewNote`, `reviewedAt` |
| `GET /channels/:id` | anyone | changed | Any status by id, so a declined channel can show its note; declined ones simply do not appear in the list |
| `POST /channels/:id/request` | anyone | new | `declined → requested`; follows the caller |
| `POST /channels/:id/approve { title?, initialImportCount?, explanation? }` | owner | new | `requested → approved` with the initial import, or `declined → approved` without one |
| `POST /channels/:id/decline { explanation? }` | owner | new | `requested → declined`, or `approved → declined` with the pause cleared; stops future discovery, not recovery of existing episodes |
| `DELETE /channels/:id`, `POST /channels/:id/restore` | | **removed** | Channels are never deleted |
| `POST /channels/:id/pause`, `POST /channels/:id/resume` | owner | new | Owner pause; resume clears any pause. `approved` only |
| `POST /channels/:id/retry` | owner | **removed** | |
| `GET /channels/:id/episodes?limit=` | anyone | changed | Episode `status` takes the new values; the owner's `processing` block adds intent/window start/deadline/next attempt, attempt count, latest outcome, and latest attempt |
| `POST /channels/:id/episodes/:episodeId/retry` | owner | as planned | Any episode state and channel status; when pre-flight permits, opens a fresh 48-hour window and starts an immediate attempt, never a channel run; blocked leaves recovery/content unchanged |
| `POST /channels/:id/episodes/:episodeId/skip` | owner | new | `failed → skipped OWNER` in any channel status |
| `GET /channels/:id/runs` | owner | clarified; renamed from `ingestion-runs` 2026-09-12 | Initial/scheduled feed-discovery runs with feed status and discovered episodes; all processing history is exposed through episode attempts |
| `GET /channels/:id/followers` | owner | new, replaces `/requests` | Emails and `followedAt` of active followers; the UI shows emails only in the queue and counts elsewhere |
| `GET /follows`, `PUT /follows/:channelId`, `DELETE /follows/:channelId` | anyone (own) | changed | Follow any `requested` or `approved` channel (409 with the note for `declined`); each write also records the follower in the Registry |
| `GET /channel-requests`, `POST /channel-requests`, `…/approve`, `…/reject` | | **removed** | Requests are channels |
| `GET /catalog` | owner | changed | `channels: { requested, approved, paused, declined }`, `episodes: { available, pending, waiting, failed, skipped }`, `attention: { failedEpisodes, neverStarted, requested }`, `lastSuccessfulIngestionAt` (`MAX(episodes.processed_at)`, revised 2026-09-12), `transcripts: { remainingCredits, status }` (M3) |
| `GET /digest`, chats, preferences, `/me` | | unchanged | |

Shared schemas: `ChannelStatus` becomes `requested | approved | declined`; `ChannelFailureCode`, `CatalogState`,
`RequestOutcome`, `ChannelRequest*`, and `FollowOrigin` are removed; `EpisodeStatus` becomes
`pending | available | failed | skipped`; `EpisodeSkipReason` and `EpisodeWaitingCode` are added; `Channel` gains
`paused`, `followerCount`, `episodes`, `approvedAt`, `reviewNote`, `reviewedAt` and loses `deletedAt`, `available`,
`failureCode`; `Follow` loses `origin`; `ChannelManagement` loses `failureDetail`, `availableAt`, `requesterCount`,
`stuckPending` and gains `pausedBy`, `pausedAt`, `reviewedByEmail`, `neverStarted`. A `ChannelDeclinedResponse`
carries the 409 body for `POST /channels` and `PUT /follows/:channelId`, following the existing
`ChannelAlreadyAvailableResponse` pattern. The OpenAPI coverage test keeps document and routes in step.

## 6. Data and schema: a rewritten initial migration

The application is not deployed and holds no data anyone depends on (decided 2026-09-10). Rather than extend the
schema with additive columns and leave the old ones deprecated, the initial migrations are rewritten to the model in
§3. This is a one-time exception, approved by the owner, to two rules then in `AGENTS.md` → Data & schema conventions:
"migrations are additive only" and "never edit a migration file that has been committed", both since withdrawn
outright (2026-09-12, PRD §5.4); §11 records the exception as it stood in `AGENTS.md`. A second, owner-approved exception followed on 2026-09-11:
`0002_drop_lifecycle_version.sql` dropped `lifecycle_version` from `channels` and `ingestion_runs` as a new file. A
third followed on 2026-09-12, when the owner chose to start over on the schema, the Registry DO's store modules, and
the API for M3: `0001` is rewritten again to the M3 model and `0002` is deleted (§6.4). The listing in §6.1 below is
the 2026-09-10 file, kept as the record of that rewrite; the authoritative M3 shape is `m3-ingestion-plan.md` Step 4
and PRD §5.

What the reset involves:

- `apps/api/migrations/registry/0001_init.sql` is replaced by the file below. `0002_channel_request_title.sql` is
  deleted and removed from `migrations/registry/index.ts`, which then lists `0001_init` alone.
- `apps/api/migrations/user/0001_init.sql` changes in one table, `channel_follows`, shown after the Registry file.
- Local Durable Object state is wiped once with the `clean-local-do` skill (owner-initiated, hard rule 4), so the next
  `pnpm dev` runs the new `0001` files from empty and re-seeds the owner from `.dev.vars`. Tests are unaffected:
  `test/setup.ts` already starts every test from empty objects.
- No data migration, no `TODO(owner)` about existing rows, no compatibility code for old status values.

### 6.1 `apps/api/migrations/registry/0001_init.sql`

```sql
-- Global Registry DO — initial schema (docs/PRD.md §5.1, §5.3; docs/specs/channel-simplification.md §3, §6).
-- Rewritten 2026-09-10 before first deployment, with owner approval. Migration governance is open (docs/PRD.md
-- §5.4, 2026-09-12): this file may be edited in place; storage that already applied it must be wiped for an edit to run.
-- Superseded 2026-09-12 by a second pre-deployment rewrite (m3-ingestion-plan.md Step 4); kept here as the record
-- of the 2026-09-10 shape.
-- All timestamps are Unix milliseconds. Every table carries created_at.

-- Identities. `role` is the owner mechanism decided in AGENTS.md → Identity model:
-- the deployment seeds OWNER_EMAIL as `owner`; everyone else auto-registers as `user`.
CREATE TABLE global_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

-- Shared catalog. `status` is the owner's answer; import outcomes live on episodes. Nothing is deleted:
-- a declined channel keeps every episode, summary, vector, follow, and read receipt, and can be approved again.
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'declined')),
  initial_import_count INTEGER NOT NULL DEFAULT 5 CHECK (initial_import_count > 0),
  -- Set at the first approval, never reset. Decides whether a later approval starts an initial import
  -- and whether a declined channel reads "Declined" or "Withdrawn".
  approved_at INTEGER CHECK (approved_at IS NULL OR approved_at >= 0),
  -- Latest review only: approve, decline, and owner add write these. Kept when a declined channel is re-requested.
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR reviewed_at >= 0),
  reviewed_by_email TEXT REFERENCES global_users (email),
  review_note TEXT,
  -- Pause stops new runs on an approved channel. `system` = no active followers; `owner` = explicit and
  -- cleared only by the owner.
  paused_by TEXT CHECK (paused_by IS NULL OR paused_by IN ('owner', 'system')),
  paused_at INTEGER CHECK (paused_at IS NULL OR paused_at >= 0),
  last_checked_at INTEGER CHECK (last_checked_at IS NULL OR last_checked_at >= 0),
  last_ingested_at INTEGER CHECK (last_ingested_at IS NULL OR last_ingested_at >= 0),
  -- Fence for run writes; bumped when an approved channel is declined.
  lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (status = 'requested' OR (reviewed_at IS NOT NULL AND reviewed_by_email IS NOT NULL)),
  CHECK ((paused_by IS NULL) = (paused_at IS NULL)),
  CHECK (paused_by IS NULL OR status = 'approved')
);

-- Cron selection: approved and not paused.
CREATE INDEX channels_status_paused_by ON channels (status, paused_by);

-- Who follows what, shared so the Registry can list requesters, count followers, and pause a channel nobody
-- follows. The User DO's channel_follows stays the source of truth for the user's own list; this record is kept
-- in step by the follow routes (docs/specs/channel-simplification.md §3.2). An active follow is unfollowed_at IS NULL.
CREATE TABLE channel_followers (
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  user_email TEXT NOT NULL REFERENCES global_users (email),
  followed_at INTEGER NOT NULL CHECK (followed_at >= 0),
  unfollowed_at INTEGER CHECK (unfollowed_at IS NULL OR unfollowed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (channel_id, user_email)
);

CREATE INDEX channel_followers_channel_id_unfollowed_at ON channel_followers (channel_id, unfollowed_at);

-- 2026-09-10 shape. The 2026-09-12 rewrite (m3-ingestion-plan.md Step 4) replaces this table's recovery and reason columns.
-- `skipped` remains a deliberate, reversible outcome by the system or the owner.
CREATE TABLE episodes (
  episode_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  title TEXT NOT NULL,
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'available', 'failed', 'skipped')),
  waiting_code TEXT CHECK (waiting_code IS NULL OR waiting_code IN ('CAPTIONS', 'LIVE_OR_UPCOMING', 'PROVIDER_LIMIT')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT,
  failure_detail TEXT,
  skip_reason TEXT CHECK (
    skip_reason IS NULL
    OR skip_reason IN ('SHORT', 'NON_ENGLISH', 'NO_CAPTIONS', 'LIVE_OR_UPCOMING', 'UNPLAYABLE', 'OWNER')
  ),
  skipped_at INTEGER CHECK (skipped_at IS NULL OR skipped_at >= 0),
  skipped_by_email TEXT REFERENCES global_users (email),
  transcript_checked_at INTEGER CHECK (transcript_checked_at IS NULL OR transcript_checked_at >= 0),
  chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0),
  vectorized_at INTEGER CHECK (vectorized_at IS NULL OR vectorized_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- Available means the full vector set is retrievable and a summary exists.
  CHECK (
    status <> 'available'
    OR (chunk_count IS NOT NULL AND chunk_count > 0 AND vectorized_at IS NOT NULL AND processed_at IS NOT NULL)
  ),
  CHECK (waiting_code IS NULL OR status = 'pending'),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CHECK (status <> 'skipped' OR skipped_at IS NOT NULL),
  CHECK (skipped_by_email IS NULL OR skip_reason = 'OWNER'),
  CHECK (skip_reason IS NULL OR skip_reason <> 'OWNER' OR skipped_by_email IS NOT NULL)
);

CREATE INDEX episodes_channel_id_status_published_at ON episodes (channel_id, status, published_at);

CREATE TABLE episode_summaries (
  episode_id TEXT PRIMARY KEY REFERENCES episodes (episode_id),
  format TEXT NOT NULL CHECK (format IN ('structured', 'raw_fallback')),
  executive_summary TEXT,
  takeaways_json TEXT,
  topic_tags_json TEXT,
  raw_text TEXT,
  related_episode_ids_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (format = 'structured'
      AND executive_summary IS NOT NULL AND takeaways_json IS NOT NULL AND topic_tags_json IS NOT NULL)
    OR (format = 'raw_fallback' AND raw_text IS NOT NULL)
  )
);

CREATE TABLE ingestion_runs (
  run_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  workflow_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'scheduled', 'owner_retry')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  lifecycle_version INTEGER NOT NULL CHECK (lifecycle_version > 0),
  episode_limit INTEGER CHECK (episode_limit IS NULL OR episode_limit > 0),
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= 0),
  failure_code TEXT,
  failure_detail TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE INDEX ingestion_runs_channel_id_created_at ON ingestion_runs (channel_id, created_at);
-- At most one queued/running run per channel.
CREATE UNIQUE INDEX ingestion_runs_one_active_per_channel
  ON ingestion_runs (channel_id) WHERE status IN ('queued', 'running');

-- Per-run outcomes stay historical even after a later retry changes the episode's current status.
-- `selected` is the row's state until the run reaches the episode; `not_attempted` is a run that ended early.
CREATE TABLE ingestion_run_episodes (
  run_id TEXT NOT NULL REFERENCES ingestion_runs (run_id),
  episode_id TEXT NOT NULL REFERENCES episodes (episode_id),
  status TEXT NOT NULL CHECK (status IN ('selected', 'available', 'failed', 'skipped', 'waiting', 'not_attempted')),
  failure_code TEXT,
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (run_id, episode_id)
);
```

### 6.2 `apps/api/migrations/user/0001_init.sql`, the one table that changes

_Superseded 2026-09-13: `channel_follows` is dropped from the User DO altogether (`docs/specs/follows-single-owner.md`); the
listing below is the 2026-09-10 shape, kept as history._

```sql
-- Follow state. A retained row with unfollowed_at set records the unfollow; an active follow is
-- unfollowed_at IS NULL. The Registry's channel_followers mirrors this for counts and the owner queue.
CREATE TABLE channel_follows (
  channel_id TEXT PRIMARY KEY,
  followed_at INTEGER NOT NULL CHECK (followed_at >= 0),
  unfollowed_at INTEGER CHECK (unfollowed_at IS NULL OR unfollowed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE INDEX channel_follows_unfollowed_at ON channel_follows (unfollowed_at);
```

`origin`, `origin_request_id`, and their check go with the automatic follow. `summary_reads`, `chats`,
`chat_messages`, `chat_message_sources`, and `user_preferences` are unchanged.

### 6.3 What the rewrite removes and adds

| Removed | Added |
|---|---|
| `channels.deleted_at`, `failure_code`, `failure_detail`, `available_at`, and the failed-needs-a-code check | `channels.approved_at`, `reviewed_at`, `reviewed_by_email`, `review_note`, `paused_by`, `paused_at`, and four checks tying them to status |
| `channel_requests` and its two indexes; migration `0002` | `channel_followers` and its index |
| Episode statuses `processing`, `no_transcript`, `processed` | Episode statuses `available`, `skipped`; `waiting_code`, `skip_reason`, `skipped_at`, `skipped_by_email`, and their checks |
| `channel_follows.origin`, `origin_request_id` | |
| Run-episode statuses `pending`, `processing`, `processed`, `no_transcript` | Run-episode statuses `selected`, `available`, `waiting`, `not_attempted` |

The Registry's `_migrations` table lists `0001_init` alone after the reset; `registry-migrations.test.ts` and
`user-migrations.test.ts` keep proving idempotence over the new files.

### 6.4 M3 rewrite (2026-09-12)

The owner chose to start over on the schema, the Registry DO's store modules, and the API for M3 rather than carry
deprecated tables, columns, and enum values. The Registry's `0001_init.sql` is rewritten a second time before first
deployment, `0002_drop_lifecycle_version.sql` is deleted, and local DO state is wiped, exactly as in §6 above. The new
file drops `ingestion_run_episodes`, `channels.last_ingested_at`, `episodes.waiting_code`, the `owner_retry` run kind,
the run status and Workflow columns, and the `NO_CAPTIONS` and `LIVE_OR_UPCOMING` skip values; it adds `feed_status`
and `discovered_count` to `ingestion_runs`, `discovered_by_run_id`, intent and window timestamps, and active/staged
vector generations to `episodes`, and creates `episode_ingestion_attempts` as the single execution history. The DDL is
in `m3-ingestion-plan.md` Step 4; the logical schema is PRD §5.

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
  episodes whose `publish` window expired, grouped by channel with `INGESTION_TIMEOUT`, last reason, attempts,
  Retry and Skip; approved channels never started, with
  Start. **All channels**: status, paused, `available / tracked` with skipped and failed counts, followers, last
  ingested, latest run, and actions Approve or Decline, Pause or Resume. Declining an approved channel confirms once
  with the follower count. Health strip from `GET /catalog`.
- **Owner channel detail `/owner/channels/:id`.** Header with status, pause, approval and review fields, import
  count, follower count; episodes with content status, intent/window deadline/next attempt, attempts, latest outcome,
  summary format, Retry and Skip; Retry is disabled only while that episode's attempt is running. Initial/scheduled
  runs show feed status and discovered episodes; followers (emails) for requested channels, count only for approved ones.
  Never any user's read or chat activity.

## 8. Out of scope

Bulk retry across channels, editing a channel's import count after approval, a review log beyond the latest note,
follower lists beyond what §7 shows, notifications, any authentication, and a general admin dashboard. A
channel-level "re-import everything" is not needed: the owner retries episodes. Hard-deleting a channel and its
content is not offered; declining keeps everything, by the retention convention. The M3 spec's legacy-takeaway
normalisation and any other compatibility shim for pre-reset data are unnecessary for the same reason as §6 and
should be dropped when that spec is revised.

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
| Technical failures are never restarted automatically; scheduled runs do not reattempt failed episodes | 2026-09-10 | AGENTS.md → Ingestion; M3 spec §3.4 | Independent episode recovery retries every six hours for up to 48 hours (§3.3) |
| Three technical attempts, and caption/live-specific settlement at 48 hours | 2026-09-10/11 | M3 spec §2; §3.3 here | One six-hour recovery schedule and one 48-hour deadline for every unfinished episode; only content classifications skip immediately (2026-09-12) |
| Channel runs own episode execution through `ingestion_run_episodes` | 2026-09-10/11 | M3 spec §2; §3.4 here | Runs record RSS discovery; episodes point to the run that created them; every execution is an episode attempt (2026-09-12) |
| Episode `waiting_code` and pre-deadline `failure_code` as the wait and technical reasons | 2026-09-10 | §3.3 here; M3 spec §3.3 | The latest attempt's outcome; the episode carries only `INGESTION_TIMEOUT` at the deadline and the column is gone from the rewritten schema (2026-09-12) |
| Scheduled runs select channels independently of follower count | 2026-09-08 | AGENTS.md → Ingestion; PRD §4.2 | Pause at zero followers (§3.2) |
| Only available, non-deleted channels can be followed | 2026-09-07 | AGENTS.md → Catalog; PRD §4.3 | Any `requested` or `approved` channel (§3.2) |
| Migrations are additive only; a committed migration file is frozen | 2026-09-07 | AGENTS.md → Data & schema conventions; both `0001_init.sql` headers | Suspended twice before first deployment, for the rewrite in §6 (2026-09-10) and the M3 rewrite in §6.4 (2026-09-12), with one owner-approved drop between them (`0002_drop_lifecycle_version.sql`, 2026-09-11, since folded into the second rewrite); both halves withdrawn outright on 2026-09-12 until the owner revisits governance |
| Declining an approved channel bumps `lifecycle_version` so a run in flight is fenced out | 2026-09-08, reaffirmed 2026-09-10 | AGENTS.md → Catalog, Ingestion; PRD §4.2; M3 spec §2; §3.1 and §9 here | Reversed: decline stops future discovery while independent recovery of already discovered episodes continues; the column was dropped |

Unchanged and reaffirmed: DownSub as the transcript source, the universal 48-hour window, the 180-second cutoff, live
and upcoming waits, English-only tracks, both crons every 6 hours, publish only after vector verification, soft deletion
for every entity other than channels, retention of everything, and hard rule 3 with "approved" in place of
"available, non-deleted". Fencing by `lifecycle_version` was later removed; channel state now controls discovery and
reader eligibility, while episode recovery owns its own lifecycle.

## 10. Acceptance criteria

1. A user pasting a valid new id gets a `requested` channel they follow; it appears in every user's catalog as
   awaiting approval and in the owner queue with that user's email. Pasting a handle or an id with no feed is 400.
2. Pasting an id that is already requested or approved follows the caller and creates nothing. Pasting a declined id
   is 409 with the owner's note and date; `POST /channels/:id/request` then makes it `requested`, follows the caller,
   and the queue shows "previously declined".
3. Approval flips `requested → approved`, sets `approved_at`, starts exactly one run whether or not anyone follows,
   and changes no follow. There is no auto-follow code path left in the API or the User DO. Approving a declined
   channel that had been approved before starts no run and leaves `approved_at` as it was.
4. Declining a requested channel sets `declined` and no run row exists; its followers read "Declined" with the note.
   Declining an approved channel changes no run or episode row (revised 2026-09-11); its followers read
   "Withdrawn" with the note; its summaries leave digest and chat and return on re-approval.
5. Following a requested or approved channel succeeds; following a declined one is 409 with the note. Each follow
   and unfollow is visible in the Registry follower record, and `followerCount` matches.
6. When the last active follower of an approved channel unfollows, `paused_by = 'system'` is set; the next follow
   clears it. An owner pause is not cleared by a follow, only by owner resume. Declining clears the flag; approving
   recomputes it. A requested channel is never paused.
7. The channel cron discovers only on approved, non-paused channels. The episode cron recovers every due accepted
   episode regardless of channel status or pause. Paused summaries stay readable; declined summaries do not.
8. Short, non-English, and unplayable episodes skip immediately. Every other unsuccessful result, including missing
   captions, live/upcoming, provider limit, technical failures, and oversized transcripts, stays in its window and is
   attempted every six hours until the 48-hour deadline.
9. No attempt count makes an episode terminal. At the deadline, unfinished publication becomes `failed
   INGESTION_TIMEOUT` with the last reason retained and appears under Needs attention.
10. M3 Retry works on every episode and channel status and creates no channel run or channel write. When pre-flight
    permits it starts a new 48-hour episode recovery; a blocked owner Retry records a blocked attempt and leaves
    window and content unchanged. Skip
    moves `failed` to `skipped OWNER` in any channel status. Episode actions ignore channel-run state.
11. `available` is set only after every vector in the staged generation is verified and a summary stored;
    publication switches the active generation and the previous one is deleted. Failed replacement attempts cannot
    alter the old active generation, and `processed_at` never resets on retry, refollow, or re-approval.
12. Readers see titles for pending, skipped, and failed episodes with the phrases in §4, and summaries only for
    available ones; digest and unread counts consider available episodes only.
13. `GET /openapi.json` lists exactly the routes in §5, and the removed routes return 404.
14. A fresh Registry and a fresh User DO run their rewritten `0001_init` idempotently; `_migrations` lists that one
    version in each; the schema has no `deleted_at`, `channel_requests`, or `origin` column, and every check in §6
    rejects the row it is meant to reject (approved without `approved_at`, paused while requested, skipped without a
    reason, owner skip without an email).
15. Under `wrangler dev`, from wiped local state: request → approve → import → one skipped and one available episode
    → unfollow to zero → paused → follow → resumed → decline (withdraw) → request again → approve, with summaries
    hidden and restored at the right steps, recorded in the plan's walkthrough.

## 11. `AGENTS.md` and PRD edits carrying the decisions

- **What this is / Identity model:** follows are recorded in the Registry as well as the User DO; requested channels
  are visible to everyone; "requesters see only their own requests" is removed; "Only the owner can configure/approve,
  delete/restore, or retry catalog channels" becomes "Only the owner can approve, decline, pause, and resume".
- **Catalog, requests, and follows:** rewrite around §3.1–3.2. Remove the request entity, the 409-then-follow rule,
  the auto-follow paragraphs, channel states `pending | available | failed`, channel failure codes, channel retry,
  and the deletion and restoration paragraph. Add `requested | approved | declined`, pause, decline and request again,
  the follower record, and "the initial import runs at first approval regardless of followers".
- **Ingestion pipeline:** remove channel failure classification and the channel waiting code; split feed discovery
  from episode recovery, make episodes point to their discovery run, add the unified attempt ledger and universal
  48-hour recovery, and stage vectors by generation. Keep the transcript contract and chunking.
- **Hard rule 3:** "current followed, approved channels".
- **Data & schema conventions:** the Registry owns `global_users`, `channels`, `channel_followers`, `episodes`,
  `episode_summaries`, `ingestion_runs`, and in M3 `episode_ingestion_attempts`;
  `channel_requests` is gone. Add one sentence:
  "The initial migrations were rewritten twice before first deployment, with owner approval, on 2026-09-10 and
  2026-09-12; there is no additive-only or frozen-file rule (2026-09-12)." Keep "Deletion is soft"
  for every other entity
  and add "channels are never deleted".
- **API shape table:** per §5. **Screens:** per §7. **Testing → Lifecycle and retry:** replace the auto-follow,
  channel-failure, and restore bullets with pause, decline and request again, the fence bump on withdraw, episode
  attempts, skip and retry; **Testing → Migrations** gains the check-constraint cases from criterion 14.
- **PRD** §3 principles, §4.1–4.3, §5 schema tables and enumerations (mirroring §6.1 and §6.2), §7 screens, and the
  route table: the same changes. Record the review decisions of 2026-09-10 in §9 or the decisions log the PRD keeps.

## 12. Impact on the M3 plan

- **Step 3:** shared contracts gain the new enums and `Channel` fields; `RequestOutcome`, `ChannelRequest`, and
  `FollowOrigin` go. The legacy-takeaway normalisation and its fixtures are dropped; there is no legacy data.
- **Step 4:** add discovery provenance and recovery/vector-generation columns, deprecate run-episodes, and make one
  attempt ledger serve first processing, scheduled recovery, and owner Retry.
- **Step 6:** the Workflow writes only its attempt and episode window state; it never flips channel or run state.
- **Step 7:** first approval and owner add record discovery, create pending episodes, and start their first attempts;
  owner Retry starts the same episode path and Skip stays episode-level.
- **Step 8:** separate six-hour channel-discovery and episode-recovery schedules; no approval sweep.
- **Step 9:** web copy for skip reasons, pause, "Declined" and "Withdrawn"; the queue and attention list per §7.
- The plan should be revised against this spec before the owner's go, and this spec's own plan can fold into it,
  since both touch the same files.
