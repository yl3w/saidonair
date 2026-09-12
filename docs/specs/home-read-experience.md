# Feature spec — Home on first load: reader and owner views

**Status:** Decided with the owner on 2026-09-07 (§13) and delivered the same day in two phases
(`docs/specs/home-read-experience-plan.md`). **Revised 2026-09-10** against `docs/specs/channel-simplification.md`,
merged to `main` at `6e075b1`: channel requests, soft deletion, channel failure codes, channel retry and restore, and
the automatic follow are gone; channels are `requested | approved | declined` with a pause flag, requesters follow
when they request, follower counts are real, and episodes carry the outcomes. The screens below describe what is on
`main` today; the owner's browser walkthrough of them was completed on 2026-09-10. §13 keeps the 2026-09-07 decisions
and marks which ones the revision superseded.
**Revised 2026-09-12:** M3 channel runs are RSS discovery history only. Episode processing and recovery use one
independent attempt ledger, continue for 48 hours regardless of channel status or pause, and no longer use a
three-attempt terminal rule. Owner Retry and Skip are episode actions in every channel status. The owner started over
on the schema, the Registry DO stores, and the API for M3 (`m3-ingestion-plan.md` Step 4): no legacy value survives
in the types below.
**Slice:** the "read experience". First UI milestone (M5) plus the read routes it needs from M2 and M4.
**Precedence:** `AGENTS.md` overrides this document where they disagree, and `channel-simplification.md` §2–§7 is
the authority on channel and episode state. Section 16 lists the edits that carried the 2026-09-07 decisions into
`AGENTS.md` and the PRD; the 2026-09-10 edits are listed in `channel-simplification.md` §11.

## 1. Summary

A person selects their email on the Account screen and lands on Home. Home is the reader view for everyone:
today's digest from followed channels, and a channel list split into **Followed** and **Catalog**, with one
**Add a channel** input under both. Adding a channel is how a user requests one: the channel is created
`requested`, the user follows it at once, and the row reads "Awaiting owner approval" until the owner decides.
The owner additionally sees an attention card on Home ("2 channels waiting for review · 1 episode failed ·
1 channel approved but never started") that links to a separate Owner page with three sections: the approval
queue, catalog health with the channel table, and a needs-attention list of failed episodes and never-started
channels, plus a per-channel detail view. Role comes from `GET /me`; unknown emails become `user`, the seeded
`OWNER_EMAIL` is `owner`. Nothing here adds authentication.

## 2. Product decisions this spec makes

The request used a few words that mean something specific in this codebase. This table is the translation
and the rationale, so the decisions are explicit rather than implied by screens.

| The ask | Decision | Why |
|---|---|---|
| "Login as an owner account" | **Account selection**, not login. The Account screen asks "Who is this for?", stores the email locally, and every request carries `X-User-Email`. Role is whatever `GET /me` returns. | `AGENTS.md` Identity model: there is no authentication and none should be added. |
| "Role determined by email; new email is `user`" | **Already implemented.** Middleware auto-registers unknown emails as `user`; the Registry seeds `OWNER_EMAIL` as `owner` on start, promote-only. | No new work; the spec only defines how the UI consumes `role`. |
| "Home with two distinct functions" | **One Home page** for reading, plus an **owner attention card** at the top that links to a **separate Owner page**. Users never see the card or the page. | Reading is a daily habit; curation is occasional and interrupt-driven. Mixing a catalog table into the digest page makes the common path noisier for the sake of the rare one. The card keeps both functions on Home without that cost. |
| "Administration function" | Named **Owner** in the UI. | Routes, roles, docs, and code already say `owner`. One word everywhere. |
| "Summary page of channel statistics" | Named **Catalog health**, limited to data the Registry DO owns: channel status and pause, follower counts, episode outcomes, ingestion runs. | `AGENTS.md` non-goals exclude general admin dashboards beyond owner catalog management. Everything shown must support a catalog decision: approve, decline, pause, resume, retry or skip an episode. |
| Not mentioned: Chats | **Out of this slice.** Home reserves the slot; no placeholder tab. | Chat needs ingestion, embeddings, and Workers AI (M3, M4). It is the "ask" experience, not the "read" experience. |
| "Read experience" with lists of pending requests, failed channels, followed and available channels | **Read plus the light actions that make each list actionable:** follow, unfollow, add (which is request), request again, approve, decline, pause, resume, retry or skip an episode. Confirmed in scope (decision 1, revised 2026-09-10). | A queue with no approve button is a report, not a review queue. Every action here is a Registry method. "Pending requests" are `requested` channels; "failed channels" became failed episodes when channel failure codes were removed. |
| First-time user | The digest's empty state **embeds the catalog** with follow buttons. | `AGENTS.md`: first-time users are presented with the catalog to follow. Putting it inside the digest means the first screen is immediately useful and the layout does not change once they follow. |

## 3. People

- **Owner.** Curates the shared catalog and also reads. Their follows, read receipts, and future chats live in
  their own User DO like anyone else's. Nothing in the reader view special-cases the owner, except that the
  owner's own **Add a channel** creates the channel `approved`, follows the owner, and starts the import.
- **User.** Reads digests, follows and unfollows channels in the catalog, adds channels that are missing (which
  requests them), and watches the followed row move from "Awaiting owner approval" to summaries, or to
  "Declined" with the owner's note and a **Request again** button.

## 4. Entry flow

1. `/` **Account.** Email input labelled "Who is this for?" and a list of recently used emails from
   `localStorage`. Selecting one stores it (trimmed, lowercased, deduplicated) and navigates to `/home`.
   If an email is already selected, `/` redirects to `/home`.
2. `/home` mounts and calls `GET /me`. The middleware normalizes the email, registers it if new, and returns
   `{ email, role }`.
3. The header renders the email, the role when it is `owner`, and "Switch account". The nav shows **Home**
   for everyone and **Owner (n)** for owners, where `n` is the attention count from §6.2.
4. Home loads its sections (§6). Owners also load the attention count.
5. A user who types `/owner` by hand is sent back to `/home` with a one-line note; the API returns
   403 `NOT_OWNER` regardless, because the Registry checks the role inside every owner method.

The client's copy of `role` is for rendering only. Authorization happens per request, server-side.

## 5. Information architecture

| Route | Screen | Who | Notes |
|---|---|---|---|
| `/` | Account | all | Unchanged from `AGENTS.md`. |
| `/home` | Home: owner card, Digest, Channels | all | Section jump links at the top. |
| `/channel/:id` | Channel (reader) | all | Any status; linked from channel rows. §6.5 says what each status shows. |
| `/owner` | Owner: Queue, Catalog, Needs attention | owner | Section jump links; `#requests`, `#catalog`, `#attention`. |
| `/owner/channels/:id` | Owner channel detail | owner | Episodes, runs, followers for one channel. |

Routing uses `preact-iso` in history mode. Cloudflare Pages serves `index.html` for unknown paths when no
`404.html` is deployed, so deep links and reloads work without a redirects file. Hash mode is the fallback if
that assumption fails in practice (§13).

Two pages plus a detail view. Section links within a page are anchors, so the browser back button and
reload behave predictably and nothing depends on client-side tab state.

## 6. Screen: Home `/home`

```
Media Digest                                  you@example.com · owner · Switch account
Home · Owner (3)

┌ Owner ───────────────────────────────────────────────────────────────────────┐
│ 2 channels waiting for review · 1 episode failed · 1 channel approved but     │
│ never started                                                       Review → │
└──────────────────────────────────────────────────────────────────────────────┘

Digest · Channels

## Today's digest                                          since 2026-09-06 09:12
                                                            Show last 7 days · Refresh
NEW  How we shipped the thing — Some Channel · 3h ago
     Executive summary, at most three sentences.
     • takeaway
     • takeaway
     • takeaway
     tags: ai, infra                     Watch · Related: Other episode title

     A quieter episode — Another Channel · 19h ago · unformatted summary
     raw summary text, newlines preserved

## Channels

### Followed (4)
Some Channel        12 summarised · 3 unread · ingested 3h ago              Unfollow
Another Channel      5 summarised · 0 unread · ingested 2d ago · paused     Unfollow
New Channel         Awaiting owner approval                                  Unfollow
Old Channel         Withdrawn on 2026-09-09: “off topic”   [Request again]  Unfollow

### Catalog (7)
Third Channel        8 summarised                                            Follow
Fourth Channel       awaiting approval · 2 following                         Follow
…

Add a channel  [ UC… channel id or /channel/UC… URL                     ] [Add]
On the channel's page open About, then Share channel, then Copy channel ID.
```

### 6.1 Header and nav

Site name, the current email, the word `owner` when applicable, and "Switch account" (returns to `/`).
Nav: **Home**, and **Owner (n)** for owners. No Chats entry in this slice.

### 6.2 Owner attention card (owners only)

One line, three facts, one link. Count of `requested` channels, count of `failed` episodes, and count of
approved channels that have never started a run (§7.3), each shown when nonzero. Links to `/owner#attention`.
Hidden entirely when the sum is zero; the nav still shows **Owner**. Fed by `GET /catalog` (§10), whose
`attention` block is also the Catalog health strip's source, so the card costs one small request.

### 6.3 Digest

- Source: `GET /digest?since=<iso>`; default `since` is 24 hours ago. Eligible channels are the reader's
  active follows intersected with `approved` catalog channels (`lib/eligibility.ts`, the one definition the
  digest, follows, episodes, and later chat share). Only `available` episodes carry summaries. Newest first,
  flat list, channel title as the byline. No grouping by channel; a day's digest is short. M3 changes the
  window and ordering basis to first availability (`summaryAvailableAt`, `AGENTS.md` → Screens); until then
  publication time is the basis.
- Each item shows: **video title** linked to `https://youtu.be/<videoId>`, channel title linked to
  `/channel/:id`, relative published time, executive summary, takeaways as bullets, topic tags as plain
  text. Raw-fallback summaries show the stored text with the note "unformatted summary".
- **Related** shows titles of related episodes only when they belong to the reader's eligible channels,
  each linked to its own `youtu.be` URL. Omitted when empty.
- **NEW** marks items that had no read receipt when the request ran. Returning them records the receipt, so
  the marker is the only trace the user gets of what they had not seen. The response carries `wasUnread`.
- **Show last 7 days** re-queries with `since` seven days ago. There is no further paging in this slice.
- **Refresh** (M3) runs the same list reload a follow or unfollow runs, which re-fetches the digest after the lists
  so NEW markers and unread counts still describe one moment. It exists because the only poll stops the moment a
  followed channel is approved, and its first summaries land minutes later; without it a reader on an empty digest
  could only reload the page. It is a button, not a poll.
- Empty states are two today, three after M3:
  - No active follows: "Follow a channel to start your digest." followed by the **Catalog** list from §6.4
    rendered inline, with follow buttons. Following any channel switches the section to the normal layout
    on the next load.
  - Following at least one channel and nothing in the window: "Nothing new since yesterday." M3 replaces
    this with the three-way copy of `AGENTS.md` → Screens: follows but none approved yet, no new summaries
    in the last 24 hours, no new summaries in the last 7 days (owner decision 2026-09-10).
- Load order matters. Home requests `/follows` and `/channels` first, then `/digest`. The digest marks its
  items read, and the follow rows show unread counts. Fetching the counts before the marking keeps the
  "3 unread" on a channel row consistent with the three items marked NEW below it.

### 6.4 Channels

Two subsections, each with a count in the heading, and one input below them.

**Followed.** Source: `GET /follows`. Every active follow, whatever the channel's status; the follow row is
the user's and is never removed by the owner. Row: title, then by status:

| Channel status | Row reads | Link |
|---|---|---|
| `approved` | "N summarised · M unread · ingested X ago" | `/channel/:id` |
| `approved`, paused | the same, plus "paused" | `/channel/:id` |
| `requested` | "Awaiting owner approval" | `/channel/:id` |
| `declined`, never approved | "Declined on <date>: '<note>'" and a **Request again** button that confirms once | `/channel/:id` |
| `declined`, previously approved | "Withdrawn on <date>: '<note>'" and **Request again** | `/channel/:id` |

**Unfollow** on every row. A declined channel that is still followed stays listed and drops out of the digest
and the unread counts. Sorted by most recent ingestion, then title. The phrases come from
`apps/web/src/lib/copy.ts` (`channelStateCopy`, `reviewCopy`), which every screen shares.

**Catalog.** Source: `GET /channels`, filtered to `following === false`. Returns `requested` and `approved`
channels only; declined ones are not in the catalog list. Row: title linked to `/channel/:id`; approved rows
show the summarised count, requested rows read "awaiting approval · N following"; **Follow** on both. Sorted
by title. Empty state: "The catalog is empty. Add a channel below."

**Add a channel.** One id input and a button, with one line of help: "On the channel's page open About, then
Share channel, then Copy channel ID." Accepted inputs are a bare `UC…` id or any URL containing
`/channel/UC…`; the route extracts the id offline. `@handle` and `/c/…` URLs are rejected with 400 and the
same help line; there is no handle resolution (decision 2, §9.6). Before creating anything the route fetches
the id's RSS feed: a 404 means no channel has that id and returns 400; success supplies the channel title,
stored on the channel. `POST /channels` then has three non-error outcomes:

- The id is **new**. A user's add creates the channel `requested` and follows the user (201). The owner's add
  creates it `approved`, follows the owner, and starts the initial import (201). The row appears under Followed.
- The id is **already in the catalog** as `requested` or `approved`. No channel is created; the caller follows it
  (200). This replaced the 2026-09-07 refusal (decision 6): following the existing channel is what the person
  wanted.
- The id is **declined**. 409 with a `ChannelDeclinedResponse` carrying the note and date. The form shows
  "Declined on <date>: '<note>'" with a **Request again** button, which calls `POST /channels/:id/request`
  after one confirmation, moving the channel back to `requested` and following the caller.

Poll `GET /follows` and `GET /channels` every 15 seconds only while a followed channel is `requested`, so an
approval or decline shows up without a reload. Stop polling otherwise. There is no other poll.

### 6.5 Channel `/channel/:id`

Any status, from `GET /channels/:id`, which returns declined channels too so their note can be read.
Header: title, "<state> · N following", and **Follow** or **Unfollow**.

- **Requested:** "Awaiting owner approval"; no episodes.
- **Approved:** summaries newest first for followers, marked read on view; a non-follower sees the titles and
  "Follow to read the summaries."; `pending`, `skipped`, and `failed` episodes listed by title with their
  phrase from `episodePhrase` ("Not summarised yet", "No summary: under three minutes", "Summary failed; the
  owner has been notified"). A paused channel reads "Approved · paused" and its existing summaries stay readable.
- **Declined:** the note and date ("Declined on…" or "Withdrawn on…"), the follower count, **Unfollow** when the
  caller follows (Follow is not offered: the API answers 409 for a declined channel), and **Request again**, which asks
  "<review copy>. Ask the owner again?" once. Episode titles are listed without summaries when the channel had
  been approved.

## 7. Screen: Owner `/owner`

```
Media Digest                                  you@example.com · owner · Switch account
Home · Owner (3)

Queue · Catalog · Needs attention

## Queue

### Waiting (2)
Foo Channel   UCxxxx   alice@example.com, carol@example.com                    2h ago
              [Approve]  title: [ Foo Channel ]  import count: [ 5 ]  note (optional): [        ]
              [Decline]  note (optional): [        ]
Bar Channel   UCyyyy   nobody is waiting · previously declined on 2026-09-08: “dup”   1d ago
              [Approve] [Decline]

### Reviewed (12) ▸

## Catalog

Requested 2 · Approved 9 · Paused 1 · Declined 1  |  Episodes 61 available / 70 tracked · 3 waiting · 1 failed · 5 skipped
Last successful ingestion 3h ago

### All channels (13)
Title          State               Episodes                     Last ingested  Latest run             Followers  Actions
Some Channel   Approved            12 / 12                      3h ago         scheduled · completed  4          Pause · Decline
Foo Channel    Approved · paused   3 / 5 · 2 skipped            2d ago         initial · completed    0          Resume · Decline
Bar Channel    Awaiting approval   0 / 0                        —              —                      0          Approve · Decline
Old Channel    Withdrawn           4 / 5                        30d ago        —                      2          Approve

Add a channel  [ UC… channel id ] [ title (from feed) ] [ import count: 5 ] [Add]

## Needs attention

### Failed episodes (1)
Foo Channel
  Broken upload   6d ago   Timed out after 48h · last: PROVIDER_HTTP · 8 attempts   [Retry] [Skip]

### Approved, never started (1)
Bar Channel   approved 3 days ago, no run recorded
```

### 7.1 Queue

Source: `GET /channels?scope=all`, filtered to `requested`. Two groups.

**Waiting.** Requested channels, oldest first, because the queue should drain in arrival order. Row: channel
title (captured from the RSS feed when the channel was added), id linked to its YouTube page, the active
followers by email from `GET /channels/:id/followers` (they are the requesters, since requesting follows),
"nobody is waiting" when every requester has since unfollowed, relative age, and "previously declined on
<date>: '<note>'" when the channel has review fields from an earlier decision. Actions: **Approve**, with the
title prefilled from the feed and editable, the import count defaulting to 5, and an optional note; and
**Decline**, with an optional note. Both notes become `reviewNote`, which followers of a declined channel see.
Approving a channel that had been approved before (declined then re-requested) does not start a second initial
import (`channel-simplification.md` §3.1).

**Reviewed.** Approved and declined channels with review fields, newest review first, collapsed by default.
Row: title, decision, reviewer, review time, note.

### 7.2 Catalog health strip

Source: `GET /catalog`. Counts of channels by status plus paused, episodes `available / tracked` with the
nonzero `failed` and `skipped` counts (the `waiting` count was dropped on 2026-09-12; wait reasons appear on
episode rows), and the most recent successful ingestion anywhere in the catalog.
Numbers only; each channel count links to the matching filter of
the All channels table. M3 adds the DownSub credit balance (`transcripts.remainingCredits`) to the same strip.

### 7.3 Needs attention

The failed-episode review that replaced the failed-channel review, plus one neighbour.

- **Failed episodes.** From the same `GET /channels?scope=all` rows: channels whose `episodes.failed` is nonzero,
  each expanded through `GET /channels/:id/episodes` to publication recoveries that exhausted 48 hours. Show
  `INGESTION_TIMEOUT`, the last underlying reason, diagnostic `attemptCount`, and failure time. Actions per episode:
  **Retry**, which starts a fresh 48-hour publication recovery when provider pre-flight permits, and **Skip** (`failed → skipped OWNER`). Both work
  regardless of channel status or discovery activity; Retry is disabled only while that episode has a running
  attempt. Siblings and every channel/run record are untouched.
  Skipped episodes are not listed here; the owner reopens one from the channel detail with Retry.
- **Approved, never started.** Approved channels whose `management.neverStarted` is true: no ingestion run row
  exists at all, with no age window (decision 9, carried over). Shown as information with how long ago the
  channel was approved; there is no Start button until M3 adds `POST /channels/:id/runs`. Until the ingestion
  Workflow exists, every approved channel sits here, which is the honest picture.

### 7.4 All channels

Source: `GET /channels?scope=all`; each row carries the owner-only `management` block. One row per channel in
every status, including declined, with client-side filter links from the health strip. Columns:

| Column | From | Notes |
|---|---|---|
| Title | `channels.title` | Links to `/owner/channels/:id`. |
| State | `status`, `paused`, `approvedAt` | "Awaiting approval", "Approved", "Approved · paused", "Declined", or "Withdrawn" (declined after having been approved). |
| Episodes | `episodes` counts | `available / tracked`, then non-zero `failed`, `skipped` (no `waiting` count since 2026-09-12). |
| Last ingested | `lastIngestedAt` | Relative time, derived from the channel's newest episode `processed_at`; Retry never writes the channel. |
| Latest run | `management.latestRun` | Kind and completed time plus exactly what the RSS check found: “N episodes discovered”, “Nothing new”, or “Feed unavailable”. Episode outcomes never appear on a discovery run. |
| Followers | `followerCount` | Real count from the Registry's follower record; emails only in the queue and the detail view. |
| Actions | `ChannelStatusActions` | Requested: Approve, Decline. Approved: Pause or Resume, Decline, and in M3 Start to check the feed now, paused or not. Declined: Approve. Declining an approved channel confirms once, naming its follower count. |

**Add a channel** (in scope, decision 1). A `UC…` id or `/channel/UC…` URL, optional title, optional import
count defaulting to 5. Calls `POST /channels`; for the owner this creates an `approved` channel, follows the
owner, and starts the initial import. The title comes from the RSS feed with an override field (§9.5).

## 8. Screen: Owner channel detail `/owner/channels/:id`

```
← Owner

# Some Channel                                     Approved · 4 following
UCxxxxxxxxxxxxxxxxxxxxxx · youtube.com/channel/UCxxxx…
Approved 2026-08-01 · reviewed 2026-09-09 by owner@example.com: “great channel” · import count 5 · last checked 9h ago
[Start] [Pause] [Decline]

## Episodes (12)
Title                    Published   Content              Recovery                         Attempts  Actions
The big one              2d ago      available            replacement · retry in 6h       2         [Retry]
Short update             5d ago      skipped · short      —                                1         [Retry]
Fresh upload             1d ago      pending              captions · 30h left · retry 6h  4         [Retry]
Broken upload            6d ago      failed · timeout     last: PROVIDER_HTTP              8         [Retry] [Skip]

## Runs (4)
Kind        Finished  Feed          Discovery
scheduled   3h ago    unavailable   Feed unavailable
scheduled   9h ago    read          2 episodes discovered
initial     9d ago    read          5 episodes discovered

## Followers
4 following
```

Everything below is read from the Registry DO; the source table is named so it is clear what is available
today versus after M3.

**Header** (`channels`): title, canonical URL, id, state with pause, `approvedAt`, the latest review
(`reviewedAt`, `reviewedByEmail`, `reviewNote`), `initialImportCount`, `lastCheckedAt` (M3: it moves only when
the feed was actually read, so a check time that stands still while runs keep appearing means the feed cannot be
read), created and updated times, and the follower count. Actions from `ChannelStatusActions`, the same component the table uses:
Approve, Decline, Pause, Resume as the status allows, with the one withdraw confirmation, and in M3 Start on an
approved channel, paused or not, so the owner can check its feed immediately.

**Episodes** (`episodes`, `episode_summaries`, `episode_ingestion_attempts`): title linked to `youtu.be`, published,
content status, recovery mode, last reason (from the latest attempt), recovery deadline, next attempt, diagnostic attempt count, transcript,
vector, and processing times, summary format, and latest attempt. Sorted newest published first. Publication recovery
shows pending; replacement recovery keeps the row available and says “Generating a replacement; the current summary
remains available.” A timed-out publication reads “Failed after 48 hours” plus its last reason. A timed-out
replacement stays available and reads as a finished recovery, not a failed episode.

**Retry** appears on every row and works under requested, approved, paused, and declined channels. When pre-flight
permits, it resets that episode's 48-hour window; it is disabled while the same episode has an attempt running under
an hour, and enabled after that because the route reconciles a dead instance inline; the row shows how long the
attempt has been running. A provider-blocked owner
Retry remains visible as a blocked latest attempt without changing content. **Skip** appears on failed rows and
marks `OWNER`; it has no discovery-run precondition. Siblings, channels, and discovery history are untouched.

**Runs** (`ingestion_runs`) are completed RSS discovery history: kind, finished time, feed status, episode limit,
and discovered count. Copy is “N episodes discovered”, “Nothing new”, or “Feed unavailable”. Runs never show
episode attempt outcomes and do not expand to run-episode rows. An episode's immutable `discoveredByRunId` is
diagnostic provenance, while its execution history stays on the episode. The section does not poll.

**Followers** (`channel_followers`): for a `requested` channel, the active followers' emails and follow times
from `GET /channels/:id/followers`, because they are the people waiting on the decision. For any other status,
the count only. Never any user's read or chat activity.

## 9. Alignment with the Durable Object design

### 9.1 What each screen reads

| Screen or section | Registry DO | User DO | Composition |
|---|---|---|---|
| Header, nav | `ensureUser` via middleware | — | `GET /me`, exists. |
| Owner card, health strip | `getCatalogSummary(actor)` | — | Owner-checked in the DO; returns the `Catalog` aggregate with its `attention` block. |
| Digest | `listDigest(channelIds, since)` | `activeChannelIds`, `readVideoIds`, `markRead` | Route intersects active follows with approved channels, fetches summaries of `available` episodes, computes `wasUnread`, then marks read. |
| Followed | `listChannelsByIds(ids)`, `listAvailableVideoIds(ids)` | `listFollows`, `readVideoIds` | Any status; unread per approved channel = available ids minus read ids. |
| Catalog | `listChannels()` (requested and approved) | `listFollows` | Follow state merged in the route. |
| Queue, All channels, attention | `listChannels(actor, { scope: "all" })` | — | Channel plus its `management` block: pause fields, episode counts, latest run, `neverStarted`. |
| Channel detail | `getChannel` + `listEpisodes`, `listRuns`, `listFollowers` | — | Sub-resource reads; the owner's `processing` fields ride on the same episode rows. |

### 9.2 Registry modules

One store module per concern under `do/registry/`, all present on `main`:

- `channels.ts`: the transitions of `channel-simplification.md` §3.1 (`requestChannel`, `approveChannel`,
  `declineChannel`, `pauseChannel`, `resumeChannel`, `createChannel`),
  `listChannels` with the `scope` rule, `listChannelsByIds` in any status, `getChannel`.
- `followers.ts`: `recordFollow`, `recordUnfollow`, `listFollowers`, `countFollowers`; the automatic system
  pause at zero followers and its lift on the next follow.
- `episodes.ts`: `listByChannel`, `listDigest`, `countByChannel`, `listAvailableVideoIds`, `getEpisode`,
  `retryEpisode`, `skipEpisode`. Digest items join `episodes`, `episode_summaries`, and `channels.title`; related
  ids are resolved to titles inside the method and filtered to the passed channel ids, so the route never sees
  titles from ineligible channels.
- `runs.ts`: `latestByChannel`, completed discovery history, feed status, discovered counts, and `neverStarted`.
- `episode-attempts.ts` (M3): unified first-processing, scheduled-recovery, and Owner-Retry attempt history.
- `catalog.ts`: `summarize()`, the `Catalog` aggregate.
- Facade methods on `RegistryDO`: reader-safe `listChannels`, `listChannelsByIds`, `getChannel`,
  `listAvailableVideoIds`, `listDigest`, `listEpisodes`; owner-checked `getCatalogSummary`, `listRuns`,
  `listFollowers`, and every transition. Internal names follow the entity vocabulary of §10.

All `IN (...)` lists go through `lib/sql.ts` chunking. M3 adds discovery writes, episode recovery state, and the
attempt ledger on the rewritten schema, which has no run-episode table.

### 9.3 What the DOs cannot tell us, and what we show instead

- **Follower counts** are real since 2026-09-10. Follows still live in each User DO, but every follow write
  also records the follower in the Registry's `channel_followers` table: the route writes the User DO first,
  then the Registry, so a Registry failure leaves the user's own view correct and the count at worst one low
  until the next follow or unfollow. The Registry uses the same record to pause a channel nobody follows. The
  2026-09-07 substitute, a requester count from `channel_requests`, is gone with that table.
- **Read and chat activity.** Private to User DOs by design (`AGENTS.md`: never expose another user's
  private DO data). The owner view never shows who has read what.
- **Whether ingestion is enabled.** The Registry does not know that the Workflow is not yet deployed.
  Approved channels with no run simply surface as never started (§7.3).

### 9.4 What is empty until M3

The digest, unread counts, summarised counts, episode lists, and run lists all read tables that ingestion
writes. Nothing writes them yet except the owner's per-episode Retry and Skip, which need a row to act on.
This slice ships those screens with real empty states and tests them with SQL-seeded fixtures, the way
`test/helpers.ts` drives channel state. When M3 lands, the screens fill in without UI changes beyond the ones
`m3-ingestion-plan.md` Step 9 lists.

### 9.5 Write paths used by the light actions

| Action | Registry DO | User DO | Notes |
|---|---|---|---|
| Follow, unfollow | `getChannel` for status, then `recordFollow` / `recordUnfollow` | `follow`, `unfollow` first | 409 `ChannelDeclinedResponse` for a declined channel; a follow lifts a system pause, an unfollow to zero followers sets one. |
| Add (user) | RSS fetch to verify the id and capture the title, then `createChannel` as `requested` plus `recordFollow` | `follow` | 201 new, 200 when the id is already `requested` or `approved` (follow only), 409 when declined. |
| Add (owner) | the same, `createChannel` as `approved`, `recordFollow` for the owner, `requestIngestion(channel_approved)` | `follow` | The owner is a follower of their own additions, so the channel is not system-paused. |
| Request again | `requestChannel` (`declined → requested`) plus `recordFollow` | `follow` | Review fields are kept so the queue can say "previously declined". |
| Approve | `approveChannel` | — | `requested → approved` starts the initial import (`requestIngestion`), which ignores the pause a zero-follower channel starts with; `declined → approved` for a previously approved channel starts nothing. Recomputes pause from the follower count. |
| Decline | `declineChannel` | — | From `requested` or `approved`; the latter also clears the pause. Stops future discovery, never recovery of existing episodes. |
| Pause, resume | `pauseChannel`, `resumeChannel` | — | `approved` only; resume clears any pause, owner or system. |
| Episode retry, skip | `retryEpisode`, `skipEpisode` | — | Both are independent of channel status and discovery runs. Retry resets the episode's 48-hour window when work starts; a blocked Retry leaves it unchanged. Skip is `failed → skipped OWNER`. |

**Requesting is following.** The automatic follow of 2026-09-07 (deliver the requester's follow once the
channel is available) is gone: a user follows at the moment they add or re-request a channel, and the follow
row simply becomes eligible when the owner approves. Nothing is handed off, so there is no sweep for M3 to run.

**Approve needs a title** (decision 7, simplified by decision 2). The channel already carries the title captured
from the RSS feed when it was added, so the approve form shows it prefilled and the owner may edit it; no fetch
happens at approval. Owner **Add a channel** takes the same path as a user's add: verify the id against its RSS
feed (`lib/youtube/rss.ts`, an allowed public endpoint) and take the feed title unless one was typed. If the
feed fetch fails and no title was given, return 400 and let the form ask for one. M3 extends the same
`rss.ts` for episode listing.

### 9.6 Channel ids instead of URL resolution

Users supply the channel id (decision 2, revised). Every YouTube channel page exposes it: open About (the
"…more" link under the description), press **Share channel**, choose **Copy channel ID**. The same option
exists in the mobile app. The form accepts a bare `UC…` id or any URL containing `/channel/UC…`, validated
offline by the shape check in `lib/youtube/ids.ts`. `@handle` and `/c/…` URLs are rejected with 400 and the
copy-the-id instructions: the RSS feed does not accept handles, and resolving them would need either the
YouTube Data API (rejected: Google Cloud project, API key) or an InnerTube call on the request path.
Handle resolution can be layered on later if the friction turns out to matter; nothing in the data model
prevents it.

The id is verified by fetching `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`. A 404 means no
channel has that id. Success yields the channel title, stored as `channels.title`, so the followed row, the
owner queue, and the approve form all show a name rather than an opaque id.

### 9.7 Consistency notes

- **Declined but followed.** A follow row survives the owner's decision. `GET /follows` reports the channel
  with `status: "declined"`, its note, and `approvedAt` (null for "Declined", set for "Withdrawn"); `GET /digest`
  and unread counts exclude it. Re-approval makes it eligible again with no user action. Explicit unfollow
  stays unfollowed.
- **Follow writes go User DO first, then Registry.** The user's own list is the source of truth for what they
  follow; the Registry's follower record drives counts and the automatic pause.
- **Read marking is a side effect of reading.** Every Home load marks the returned digest items read, per
  `AGENTS.md`. The NEW marker and the load order in §6.3 make that visible and consistent.
- **The owner is a normal reader.** Owner-only data comes only from owner-checked operations and the
  `management` block; the reader routes never branch on role except to attach that block.

## 10. API contract

**The API is modelled on the system's entities, never on roles.** Resources are nouns: the catalog, channels,
episodes, ingestion runs, follows, followers, the digest. Authorization is a property of an operation (and, for
a few fields, of the representation), not of a URL namespace or a type name. There is no `/owner/*` prefix and
no `Owner*` type. Three conventions carry this:

- **Same representation for every caller**, plus caller-relationship fields (`following`, `wasUnread`,
  `unreadCount`) and, on channels only, a `management` block that is present when the caller is the owner.
- **Collections default to what the caller may act on.** `?scope=all` widens `GET /channels` to declined
  channels as well and is owner-only.
- **Owner-only operations** return 403 `NOT_OWNER` to anyone else. `requireOwner` in `middleware/owner.ts` is
  applied to those handlers; the Registry re-checks the role inside every owner-only method, so the middleware
  is a convenience, not the guard.

The table is the contract on `main` at `6e075b1`. Rows marked *2026-09-07* were delivered by the home plan;
rows marked *2026-09-10* were added or changed by `channel-simplification-plan.md`. The OpenAPI document at
`GET /openapi.json`, generated from `packages/shared`, is the reference; `test/openapi.test.ts` keeps it and the
routes in step.

| Method and path | Who | Purpose | Since |
|---|---|---|---|
| `GET /me` | anyone | Email and role | M1 |
| `GET /catalog` | owner | Aggregate channels and episodes, last successful publication, provider health, and attention counts | revised 2026-09-12 |
| `GET /channels` | anyone | `requested` and `approved` channels with `following`, `followerCount`, `episodes` counts. `?scope=all` (owner) adds `declined` channels, each with `management` | 2026-09-07, reshaped 2026-09-10 |
| `POST /channels { channelId, title?, initialImportCount? }` | anyone | The id is verified against its RSS feed. User: create `requested` and follow (201), or follow the existing `requested` or `approved` channel (200). Owner: create `approved`, follow, start the import (201). 409 `ChannelDeclinedResponse` for a declined id; 400 `INVALID_INPUT` for handles, other URLs, or an id with no feed | 2026-09-07, reshaped 2026-09-10 |
| `GET /channels/:id` | anyone | One channel in any status, so a declined one can show its note; `management` for the owner | 2026-09-07, reshaped 2026-09-10 |
| `POST /channels/:id/request` | anyone | `declined → requested`; follows the caller | 2026-09-10 |
| `POST /channels/:id/approve { title?, initialImportCount?, explanation? }` | owner | `requested → approved` with the initial import, or `declined → approved` without one; recomputes pause | 2026-09-10 |
| `POST /channels/:id/decline { explanation? }` | owner | `requested → declined`, or `approved → declined` with the pause cleared; stops new discovery but existing episode recovery continues | revised 2026-09-12 |
| `POST /channels/:id/pause`, `POST /channels/:id/resume` | owner | Owner pause; resume clears any pause. `approved` only | 2026-09-10 |
| `GET /channels/:id/episodes?limit=` | anyone | Episodes newest first. Followers and the owner receive available summaries; the owner also receives recovery state and the latest attempt | revised 2026-09-12 |
| `POST /channels/:id/episodes/:videoId/retry` | owner | Any episode/channel state; resets the 48-hour window when work starts and returns an attempt; blocked leaves recovery unchanged; no discovery or channel write | revised 2026-09-12 |
| `POST /channels/:id/episodes/:videoId/skip` | owner | Any channel state; `failed → skipped OWNER`; no discovery precondition | revised 2026-09-12 |
| `GET /channels/:id/ingestion-runs` | owner | Completed initial/scheduled RSS discovery checks with feed status and discovered count | revised 2026-09-12 |
| `GET /channels/:id/followers` | owner | Active followers' emails and follow times, oldest first | 2026-09-10, replaces `/requests` |
| `GET /follows` | anyone (own) | Active follows in any channel status, each embedding its `channel` and carrying `unreadCount`; most recent ingestion first | 2026-09-07, reshaped 2026-09-10 |
| `PUT /follows/:channelId`, `DELETE /follows/:channelId` | anyone (own) | Follow or refollow a `requested` or `approved` channel (409 `ChannelDeclinedResponse` for declined); retained unfollow. Each write also records the follower in the Registry | 2026-09-07, reshaped 2026-09-10 |
| `GET /digest?since=<iso>` | anyone (own) | `available` episodes of eligible follows, newest first, default 24 h, clamped to 7 days; returned summaries are marked read; each carries `wasUnread` | 2026-09-07 |
| `DELETE /channels/:id`, `POST /channels/:id/restore`, `POST /channels/:id/retry`, `GET`/`POST /channel-requests`, `POST /channel-requests/:id/approve|reject`, `GET /channels/:id/requests` | | **Removed 2026-09-10.** Channels are never deleted, have no failure to retry, and are their own requests | |
| `POST /channels/:id/runs` | owner | M3: check an approved channel's RSS feed now, ignoring pause; return the completed discovery result | planned M3 |

Response shapes live in `packages/shared` as Zod schemas with inferred types, named after the entity they carry.
Sketch of the ones with structure this document depends on (the schemas are authoritative):

```ts
/** A catalog channel as any caller sees it; `management` is present for the owner only. */
export type Channel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: "requested" | "approved" | "declined";
  paused: boolean;                 // no new runs while true; approved channels only
  approvedAt: number | null;       // first approval, never reset; declined + non-null reads "Withdrawn"
  reviewedAt: number | null;
  reviewNote: string | null;       // the owner's latest note, shown to followers of a declined channel
  lastIngestedAt: number | null;
  episodes: EpisodeCounts;         // tracked, available, pending, waiting, failed, skipped
  following: boolean;              // caller-relationship field
  followerCount: number;           // from the Registry's follower record
  management?: ChannelManagement;
};

export type ChannelManagement = {
  initialImportCount: number;
  reviewedByEmail: string | null;
  pausedBy: "owner" | "system" | null;
  pausedAt: number | null;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
  episodes: EpisodeCounts;
  latestRun: IngestionRunSummary | null;
  neverStarted: boolean;           // approved and no ingestion run row at all
};

export type IngestionRunSummary = {   // the newest run, as the catalog row shows it
  runId: string;
  kind: "initial" | "scheduled";     // no status: a discovery run exists only once complete
  feedStatus: "read" | "unavailable";
  discoveredCount: number;
  startedAt: number;
  finishedAt: number;
};

export type EpisodeIngestionAttempt = {
  attemptId: string;
  videoId: string;
  trigger: "channel_ingestion" | "scheduled_recovery" | "owner_retry";
  requestedByEmail: string | null;
  recoveryMode: "publication" | "replacement";
  generationId: string | null;
  stagedChunkCount: number | null;  // set when embedding starts; lets the next attempt delete an abandoned generation
  workflowId: string | null;
  status: "running" | "available" | "failed" | "skipped" | "waiting" | "blocked";
  outcomeCode: string | null;
  failureDetail: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type Episode = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: number;
  status: "pending" | "available" | "failed" | "skipped";
  skipReason: EpisodeSkipReason | null;   // SHORT, NON_ENGLISH, UNPLAYABLE, OWNER
  summary: EpisodeSummary | null;  // content for followers and the owner
  related: { videoId: string; title: string }[]; // already filtered to the caller's eligible channels
  wasUnread?: boolean;             // set when a summary was returned to a reader
  processing?: EpisodeProcessing;  // owner only: recovery mode/deadline/next attempt/reason and latest attempt
};
export type DigestResponse = { since: number; episodes: Episode[] };

export type Follow = {
  channelId: string;
  followedAt: number;
  unfollowedAt: number | null;     // tombstone; null while active
  channel: Channel;                // embedded, any status
  unreadCount: number;             // available episodes without a receipt; 0 unless approved
};

export type Follower = { email: string; followedAt: number };

/** 409 body for `POST /channels` and `PUT /follows/:channelId` when the channel is declined. */
export type ChannelDeclinedResponse = ErrorResponse & {
  code: "INVALID_STATE";
  channelId: string;
  status: "declined";
  reviewNote: string | null;
  reviewedAt: number | null;
};

export type Catalog = {
  channels: { requested: number; approved: number; paused: number; declined: number };
  episodes: { available: number; pending: number; waiting: number; failed: number; skipped: number };
  lastSuccessfulIngestionAt: number | null;
  attention: { failedEpisodes: number; neverStarted: number; requested: number };
};
```

`IngestionRun`, `IngestionRunEpisode`, `IngestionRunSummary`, `EpisodeIngestionAttempt`, `EpisodeSummary`,
`EpisodeProcessing`, and the
enums join the existing types in `packages/shared`. Every response wraps its entity or list in a named field
(`{ channel }`, `{ channels }`, `{ episode }`, `{ episodes }`, `{ follows }`, `{ follow }`, `{ followers }`,
`{ runs }`, `{ catalog }`); Retry returns `{ episode, attempt }`.

## 11. States, errors, polling, layout

- **Loading.** The word "Loading…" in place of each section. Sections load independently; a slow digest
  never blocks the channel list. The owner's channel list keeps its rows while it refreshes after an action,
  with a "Refreshing channels…" line above and a "Couldn't refresh channels" error with Retry if the refresh
  fails, so a row's inline error and an open approve or decline form are not lost to the reload. While the list is
  refreshing, and after a refresh has failed, the rows' Approve, Decline, Pause, Resume, Retry, and Skip controls are
  disabled, because the rows may no longer match the Registry; the refresh Retry stays enabled.
- **Errors.** Inline, per section: "Couldn't load the digest. Retry." with a retry link. No toasts, no
  modals. A 400 from a malformed `X-User-Email` returns the user to `/`.
- **Actions.** Buttons disable while in flight and the row re-renders from a reload of its list, which runs
  whether the call succeeded or failed, so a lost response cannot leave a row stale. A failed action shows its
  message inline on the row (or under the channel header) until the next action on that row. Two confirmations,
  each asked once: declining an approved channel (the question names its follower count, shared by the table
  and the detail view through `ChannelStatusActions`) and **Request again** on a declined channel. Follow,
  unfollow, add, approve, decline from `requested`, pause, resume, episode retry, and episode skip act
  immediately; their effects are reversible or recorded.
- **Polling.** Only the Home channel lists, only while a followed channel is `requested` (§6.4). The owner
  attention count refreshes on navigation, not on a timer. Ingestion progress is never polled: readers press
  **Refresh** on the digest (M3), and the owner reloads the channel detail. Readers are not told about runs, so
  there is nothing for them to poll on, and caption and credit waits can last days.
- **Timestamps.** Relative in the row ("3h ago"); the absolute time in the element's `title`.
- **Layout.** Text only, one CSS file, no component library. Reader pages keep the current 42rem measure.
  Owner tables sit in a wider container (64rem) inside an `overflow-x: auto` wrapper, so the page never
  scrolls horizontally. Nav wraps on narrow screens.
- **Routing.** History mode (decision 8). Deep links and reloads are verified under `wrangler pages dev`
  before the web PR merges; if Pages does not serve `index.html` for unknown paths as expected, the
  fallback is hash mode, changed in one place.
- **Files.** Per the `AGENTS.md` layout: `main.tsx`, `api.ts` (the only `fetch` caller), `account.ts`,
  `session.tsx`, `lib/time.ts`, `lib/copy.ts` (every user-facing phrase for channel and episode state),
  `lib/use-load.ts`; screens `Account`, `Home`, `Channel`, `Owner`, `OwnerChannel`; components `Nav`, `Time`,
  `EpisodeItem`, `OwnerCard`, `Digest`, `ChannelList` (`FollowedList`, `CatalogList`), `AddChannel`,
  `RequestQueue`, `AttentionList`, `CatalogHealth`, `CatalogTable`, `ChannelStatusActions`.
  `components/Chat.tsx` waits for M4. Small files over large ones.

## 12. Out of scope for this slice

Chats and preferences, the ingestion Workflow and cron, summary generation, the on-demand Start action (M3),
editing a channel's title or import count after creation, bulk approve, any notification, any channel
deletion or archive (decided against on 2026-09-10: declined is the terminal-looking state, and a declined
channel can always be requested again).

## 13. Decisions made with the owner

### 2026-09-07

1. **Cut line.** Ship the light actions with the read views: follow, unfollow, request, approve, reject,
   retry, delete, restore, add channel. Every one maps to an existing Registry method.
   *Revised 2026-09-10:* the action set is follow, unfollow, add (request), request again, approve, decline,
   pause, resume, episode retry, episode skip. Delete, restore, and channel retry no longer exist.
2. **Channel identity.** Users supply the `UC…` channel id, or a `/channel/UC…` URL, copied from the channel's
   About dialog. No handle resolution. Revised the same day from "resolve handles via the public channel
   page" once the owner asked whether users could simply provide the id: it is one copy away for anyone, and
   dropping resolution removes an InnerTube call from the request path. The id is verified against its RSS
   feed at submission and the feed title stored. YouTube Data API v3 remains rejected as a credentialed Google
   dependency. *Stands.* The title now lives on the channel row, since the request row is gone.
3. **`GET /catalog`.** New route: the catalog's aggregate state, feeding the Home attention card and the health
   strip. Proposed as `GET /owner/overview`, renamed the same day under decision 11. *Stands;* the shape was
   rebuilt on 2026-09-10 around status counts, episode outcomes, and an `attention` block.
4. **Channel sub-resources.** `GET /channels/:id/episodes`, `/ingestion-runs`, and `/requests` serve the detail
   view; the list route stays light. Proposed as one `GET /owner/channels/:id`, re-shaped under decision 11.
   *Revised 2026-09-10:* `/requests` became `/followers`.
5. **Digest empty states.** Two: "Follow a channel to start your digest." with the catalog inline for
   readers with no follows; "Nothing new since yesterday." otherwise. *Stands until M3,* which brings the
   three-way copy recorded in `AGENTS.md` → Screens.
6. **Requests for already-available channels.** The owner's observation: nobody requests a channel they can
   see and follow. So submission refuses such a request with 409 and a Follow hint, no request row is
   created, and automatic-follow delivery stays entirely with M3's sweep. *Superseded 2026-09-10:* adding an
   id that is already `requested` or `approved` simply follows it (200); the 409 now belongs to declined
   channels and carries the owner's note; there is no automatic follow and no sweep.
7. **Channel title.** Captured from the RSS feed when a request is submitted, or when the owner adds a channel,
   and stored on the request. Approval uses the stored title and fetches nothing. The owner may override in
   either form; 400 with a prompt when a feed fetch fails and nothing was typed. *Stands,* stored on the channel.
8. **Routing.** History mode, verified under `wrangler pages dev`; hash mode is the fallback. *Stands.*
9. **Stuck pending.** The 2026-09-07 channel rule was superseded. M3 keeps “approved, never started” only for an
   approved channel with no discovery-run row; episode publication has its own 48-hour recovery deadline.
10. **UI vocabulary.** "Owner". *Stands.*
11. **API modelled on entities, not roles** (owner correction after Step 1.1 of the plan). The owner is a role
    that authorizes operations; it is not a resource. No `/owner/*` namespace, no `Owner*` types. Owner-only
    operations are marked per route and return 403 to others; `?scope=all` widens collections for the owner;
    channels carry a `management` block for the owner; every other representation is identical for all callers.
    Step 1.1 was reverted and the contract rewritten (§10). *Stands.*

### 2026-09-10 (recorded in `channel-simplification.md` §2; summarised here for the screens)

- Channels are `requested | approved | declined`; the owner's decision is the only channel status. There is no
  deletion: a declined channel keeps its history and can be requested again.
- Requesting is following. `POST /channels` by a user creates a `requested` channel and follows them; the
  "Your requests" list, the request outcome phrases, and their polling are gone from Home.
- Follower counts are real, kept in the Registry's `channel_followers` table; a channel nobody follows is
  paused by the system and a follow lifts that pause. The owner can pause and resume approved channels.
- Import outcomes live on episodes: `pending | available | failed | skipped` with wait and skip reasons.
  Readers see the skip reason; the owner retries or skips per episode. Needs attention lists failed episodes
  and never-started channels, not failed channels.
- A previously approved channel that is declined reads "Withdrawn"; re-approving it starts no second import.

### 2026-09-12 (M3 functional contract)

- Channel runs are completed RSS discovery checks, not containers for episode processing outcomes.
- Every episode attempt—first processing, automatic recovery, or Owner Retry—uses the same attempt ledger.
- Episode recovery retries every six hours for 48 hours and ignores channel status and pause. Attempt count is
  diagnostic; it never fails an episode by itself.
- Owner Retry and Skip work in every channel status. A Retry that starts work resets only that episode's recovery window; Skip remains
  `failed → skipped OWNER`.
- Available replacement keeps the current summary and vector generation readable until a new generation succeeds,
  after which the previous generation is deleted; retrieval verifies generations before using any text.
- The schema, the Registry DO stores, and the API were restarted for this model: `0001` rewritten a second time
  before first deployment, `0002` deleted, no legacy member in any shared type.

## 14. Acceptance criteria

- A new email selected on Account lands on Home with role `user`, sees no owner card or nav entry, and
  receives 403 `NOT_OWNER` from every owner-only operation: `GET /catalog`, any `?scope=all`, approve, decline,
  pause, resume, episode retry and skip, `/ingestion-runs`, and `/followers`.
- The seeded owner email lands on Home with the owner nav entry; the card appears only when the attention
  count is nonzero and links to `/owner#attention`.
- A reader with no active follows sees the catalog inside the digest section and can follow from there;
  after following, the digest shows "Nothing new since yesterday." until summaries exist.
- With seeded summaries: the digest lists the last 24 hours across eligible channels newest first, marks
  NEW on items without a receipt, records receipts for exactly the returned items, and excludes declined,
  requested, and unfollowed channels. "Show last 7 days" widens the window; "Refresh" (M3) re-fetches lists and
  digest in that order.
- Followed rows show summarised and unread counts consistent with the NEW markers on the same load; a
  declined channel that is still followed shows "Declined" or "Withdrawn" with the note and Request again, and
  disappears from the digest and the unread counts.
- Adding a new id as a user creates a `requested` channel that the user follows (201) and the row reads
  "Awaiting owner approval"; adding an id already in the catalog follows it (200) and creates nothing; adding a
  declined id returns 409 with the note and the form offers Request again; `@handle`, other URLs, and ids with no
  RSS feed return 400 with the copy-the-id instructions or "no YouTube channel has that id".
- Home polls the channel lists while a followed channel is `requested` and stops when none is.
- The owner queue lists requested channels oldest first with their followers' emails or "nobody is waiting";
  approve records the note and starts one initial import, using the stored title unless one was typed; decline
  records the note; re-approving a previously approved channel starts no second import.
- Declining an approved channel asks once, names the follower count, and leaves followers' rows reading
  "Withdrawn" with the note.
- Unfollowing a channel to zero followers pauses it by the system; a follow resumes it; the owner's Pause holds
  until Resume regardless of followers.
- Catalog health counts match seeded fixtures. Needs attention lists publication recoveries that exhausted 48 hours
  with `INGESTION_TIMEOUT`, their last reason, and diagnostic attempts. A Retry that starts work opens a fresh
  48-hour window without touching siblings, the channel, or discovery history; blocked Retry leaves recovery unchanged.
  Skip marks `OWNER`. Both actions work while the channel is
  requested, approved, paused, or declined; Retry is disabled only for an attempt on that episode running under an
  hour. Every
  approved channel with no discovery run appears under "Approved, never started".
- History-mode deep links to `/owner` and `/owner/channels/:id` survive a reload under `wrangler pages dev`.
- Channel detail separates episode content/recovery from completed discovery runs. Runs show discovered count,
  nothing new, or feed unavailable and never per-episode outcomes. Followers' emails appear only while requested.
- Pausing or declining stops new discovery but not recovery of episodes already discovered. An available replacement
  keeps old content readable; a publication or replacement retries every six hours for up to 48 hours regardless of
  attempt count.
- Two users with overlapping follows see independent unread counts and NEW markers for the same summaries.
- `pnpm check` passes; every route has been exercised under `wrangler dev` with a seeded local Registry
  (recorded in `channel-simplification-plan.md` → Walkthrough record), and the owner has walked the screens in a
  browser (done 2026-09-10).

## 15. Delivery

The 2026-09-07 sequencing, file lists, tests, and exit criteria live in `docs/specs/home-read-experience-plan.md`:
Phase 1 was the complete API, Phase 2 the complete web application, both merged that day. The 2026-09-10 revision
was delivered by `docs/specs/channel-simplification-plan.md` (Tasks 1–12, merged at `6e075b1`), which rewrote the
initial migration, the Registry stores, the routes, the shared schemas, and the screens named above. The home plan
is kept as the record of the first delivery and marks what the second superseded.

## 16. `AGENTS.md` and PRD edits carrying the decisions (applied 2026-09-07)

Historical record of the first delivery. Clauses about requests, deletion, channel failure, and the automatic
follow were rewritten again on 2026-09-10; `channel-simplification.md` §11 lists those edits.

- **Hard rule 2.** Name YouTube's allowed endpoints precisely: the RSS feed, and for transcripts one InnerTube
  `player` call as a mobile client plus the caption-track GET it returns. No watch-page scraping, no YouTube
  Data API. (A channel-page clause for handle resolution was added and removed the same day when decision 2
  was revised; the transcript mechanism was decided separately the same day and again on 2026-09-08, when
  DownSub replaced InnerTube for deployed transcripts.)
- **Catalog, requests, and follows.** Users supply the `UC…` id; no handle resolution; the id is verified by
  RSS at submission and the feed title stored. A request for a channel that is already available is refused
  with a follow hint and creates no request. (Superseded 2026-09-10: requests are channels, and an existing id
  is followed.)
- **Web UI, Screens.** Replace the `/home` entry's three-section description with: owner attention card
  (owners only), Digest with the two empty states, Channels with Followed, Available, Your requests.
  Note that Chats joins Home in M4. Add `/owner` and `/owner/channels/:id`. Record history-mode routing.
  (Rewritten 2026-09-10 to Followed, Catalog, Add a channel.)
- **Web UI.** Resolve "Owner catalog management is required, but a general admin dashboard is not… the
  management screens themselves are `TODO(owner)`" by pointing at `/owner` and this document.
- **API shape.** Replace the role-namespaced `/owner/*` rows with entity routes: `GET /catalog`,
  `?scope=all` on `/channels` and `/channel-requests`, `management` on channels, `POST /channels`, the channel
  sub-resources `/episodes`, `/ingestion-runs`, `/requests`, actions on `/channels/:id` and `/channel-requests/:id`.
  State the entities-not-roles principle. (The request routes, delete, restore, and retry were removed on
  2026-09-10; `/requests` became `/followers`.)
- **Open decisions.** Close "Owner management interface".
- **Repo layout.** API: `do/registry/episodes.ts`, `runs.ts`, `catalog.ts`; `lib/eligibility.ts`, `lib/outcome.ts`,
  `lib/channel-view.ts`, `lib/episode-view.ts`, `lib/body.ts`, `lib/ingestion.ts`; `middleware/owner.ts`; `routes/catalog.ts`, `channels.ts`, `follows.ts`, `digest.ts`,
  `channel-requests.ts`; migration `0002`. Web: `session.tsx`, `lib/time.ts`, `lib/copy.ts`, the screens and
  components listed in §11. (On 2026-09-10 `lib/outcome.ts`, `routes/channel-requests.ts`, and migration `0002`
  were removed, `do/registry/followers.ts` was added, and the web components became the list in §11.)
- **PRD §7.** Mirror the screen changes; PRD §9 closes the management-interface open decision.
