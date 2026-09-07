# Feature spec — Home on first load: reader and owner views

**Status:** Decided with the owner on 2026-09-07 (§13); the `AGENTS.md` and PRD edits in §16 were applied the
same day. Ready to implement.
**Slice:** the "read experience". First UI milestone (M5) plus the read routes it needs from M2 and M4.
**Precedence:** `AGENTS.md` overrides this document where they disagree. Section 16 lists the edits that carried
these decisions into `AGENTS.md` and the PRD.

## 1. Summary

A person selects their email on the Account screen and lands on Home. Home is the reader view for everyone:
today's digest from followed channels, and a channel list split into followed, available, and requested.
The owner additionally sees an attention card on Home ("2 requests waiting, 1 channel failed") that links
to a separate Owner page with two sections: the request review queue and catalog health, including a
failed-channel list and a per-channel detail view. Role comes from `GET /me`; unknown emails become `user`,
the seeded `OWNER_EMAIL` is `owner`. Nothing here adds authentication.

## 2. Product decisions this spec makes

The request used a few words that mean something specific in this codebase. This table is the translation
and the rationale, so the decisions are explicit rather than implied by screens.

| The ask | Decision | Why |
|---|---|---|
| "Login as an owner account" | **Account selection**, not login. The Account screen asks "Who is this for?", stores the email locally, and every request carries `X-User-Email`. Role is whatever `GET /me` returns. | `AGENTS.md` Identity model: there is no authentication and none should be added. |
| "Role determined by email; new email is `user`" | **Already implemented.** Middleware auto-registers unknown emails as `user`; the Registry seeds `OWNER_EMAIL` as `owner` on start, promote-only. | No new work; the spec only defines how the UI consumes `role`. |
| "Home with two distinct functions" | **One Home page** for reading, plus an **owner attention card** at the top that links to a **separate Owner page**. Users never see the card or the page. | Reading is a daily habit; curation is occasional and interrupt-driven. Mixing a catalog table into the digest page makes the common path noisier for the sake of the rare one. The card keeps both functions on Home without that cost. |
| "Administration function" | Named **Owner** in the UI. | Routes, roles, docs, and code already say `owner`. One word everywhere. |
| "Summary page of channel statistics" | Named **Catalog health**, limited to data the Registry DO owns: channel state, episode outcomes, ingestion runs, requests. | `AGENTS.md` non-goals exclude general admin dashboards beyond owner catalog management. Everything shown must support a catalog decision: approve, retry, delete, restore. |
| Not mentioned: Chats | **Out of this slice.** Home reserves the slot; no placeholder tab. | Chat needs ingestion, embeddings, and Workers AI (M3, M4). It is the "ask" experience, not the "read" experience. |
| "Read experience" with lists of pending requests, failed channels, followed and available channels | **Read plus the light actions that make each list actionable:** follow, unfollow, request, approve, reject, retry, delete, restore, add channel. Confirmed in scope (decision 1). | A list of pending requests with no approve button is a report, not a review queue. Every action here already has a Registry method. |
| First-time user | The digest's empty state **embeds the available catalog** with follow buttons. | `AGENTS.md`: first-time users are presented with the catalog to follow. Putting it inside the digest means the first screen is immediately useful and the layout does not change once they follow. |

## 3. People

- **Owner.** Curates the shared catalog and also reads. Their follows, read receipts, and future chats live in
  their own User DO like anyone else's. Nothing in the reader view special-cases the owner.
- **User.** Reads digests, follows and unfollows available channels, requests channels that are missing, and
  watches their request move through review and import.

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
| `/channel/:id` | Channel (reader) | all | Unchanged from `AGENTS.md`; linked from channel rows. Not re-specified here. |
| `/owner` | Owner: Requests, Catalog | owner | Section jump links; `#requests`, `#catalog`, `#attention`. |
| `/owner/channels/:id` | Owner channel detail | owner | Episodes, runs, requests for one channel. |

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
│ 2 requests waiting for review · 1 channel failed                    Review → │
└──────────────────────────────────────────────────────────────────────────────┘

Digest · Channels

## Today's digest                                          since 2026-09-06 09:12
                                                            Show last 7 days
NEW  How we shipped the thing — Some Channel · 3h ago
     Executive summary, at most three sentences.
     • takeaway
     • takeaway
     • takeaway
     tags: ai, infra                     Watch · Related: Other episode title

     A quieter episode — Another Channel · 19h ago · unformatted summary
     raw summary text, newlines preserved

## Channels

### Followed (3)
Some Channel      12 processed · 3 unread · ingested 3h ago                Unfollow
Another Channel    5 processed · 0 unread · ingested 2d ago                Unfollow
Removed Channel   Unavailable: removed by the owner                        Unfollow

### Available (7)
Third Channel      8 processed                                             Follow
…

### Your requests (2)
Some Requested Channel   UC…   Waiting for owner review · 2h ago
Another One              UC…   Approved · importing

Request a channel  [ UC… channel id                              ] [Request]
On the channel's page open About, then Share channel, then Copy channel ID.
```

### 6.1 Header and nav

Site name, the current email, the word `owner` when applicable, and "Switch account" (returns to `/`).
Nav: **Home**, and **Owner (n)** for owners. No Chats entry in this slice.

### 6.2 Owner attention card (owners only)

One line, three facts, one link. Count of pending requests, count of failed non-deleted channels, and count
of stuck pending channels (§7.3) when nonzero. Links to `/owner#attention`. Hidden entirely when the count
is zero; the nav still shows **Owner**. Fed by `GET /catalog` (§10), which is also the Catalog
health strip, so the card costs one small request.

### 6.3 Digest

- Source: `GET /digest?since=<iso>`; default `since` is 24 hours ago. Eligible channels are the reader's
  active follows intersected with available, non-deleted catalog channels. Newest first, flat list, channel
  title as the byline. No grouping by channel; a day's digest is short.
- Each item shows: **video title** linked to `https://youtu.be/<videoId>`, channel title linked to
  `/channel/:id`, relative published time, executive summary, takeaways as bullets, topic tags as plain
  text. Raw-fallback summaries show the stored text with the note "unformatted summary".
- **Related** shows titles of related episodes only when they belong to the reader's eligible channels,
  each linked to its own `youtu.be` URL. Omitted when empty.
- **NEW** marks items that had no read receipt when the request ran. Returning them records the receipt, so
  the marker is the only trace the user gets of what they had not seen. The response carries `wasUnread`.
- **Show last 7 days** re-queries with `since` seven days ago. There is no further paging in this slice.
- Empty states are two, not one:
  - Following at least one available channel and nothing published in the window:
    "Nothing new since yesterday." (the string `AGENTS.md` specifies)
  - No active follows: "Follow a channel to start your digest." followed by the **Available** list from
    §6.4 rendered inline, with follow buttons. Following any channel switches the section to the normal
    layout on the next load.
- Load order matters. Home requests `/follows` and `/channels` first, then `/digest`. The digest marks its
  items read, and the follow rows show unread counts. Fetching the counts before the marking keeps the
  "3 unread" on a channel row consistent with the three items marked NEW below it.

### 6.4 Channels

Three subsections, each with a count in the heading.

**Followed.** Source: `GET /follows`. Every active follow, including follows whose channel the owner has
since deleted. Row: title linked to `/channel/:id`, processed episode count, unread count, last ingestion as
relative time, **Unfollow**. A followed channel that is not currently available and non-deleted shows
"Unavailable: removed by the owner" instead of counts and is excluded from the digest. The row stays,
because the follow is the user's and restoration brings it back (`AGENTS.md`, restoration preserves
active follows). Sorted by most recent ingestion, then title.

**Available.** Source: `GET /channels`, filtered to `following === false`. Row: title linked to
`/channel/:id`, processed count, **Follow**. Sorted by title. Empty state for users: "The catalog is empty.
Request a channel below." For owners: "The catalog is empty. Add one from the Owner page."

**Your requests.** Source: `GET /channel-requests`. Row: channel title (captured from the RSS feed at
submission), `UC…` id, one status phrase, and the owner's explanation when present. The phrase combines request status with the approved
channel's processing state, computed server-side as `outcome` so the UI and tests agree:

| `outcome` | Shown as |
|---|---|
| `awaiting_review` | Waiting for owner review |
| `rejected` | Declined, plus the explanation |
| `importing` | Approved, importing |
| `import_failed` | Approved, import failed: `<reason>`; the owner can retry |
| `following` | Following, linked to `/channel/:id` |
| `approved_pending_follow` | Approved, you will follow it shortly |
| `channel_removed` | Approved, channel removed by the owner |

Below the list: **Request a channel**, an id input and a button, with one line of help: "On the channel's
page open About, then Share channel, then Copy channel ID." Accepted inputs are a bare `UC…` id or any URL
containing `/channel/UC…`; the route extracts the id offline. `@handle` and `/c/…` URLs are rejected with
400 and the same help line; there is no handle resolution (decision 2, §9.6). Before recording the request
the route fetches the id's RSS feed: a 404 means no channel has that id and returns 400; success supplies
the channel title, which is stored on the request and shown in every request list. Two non-error outcomes:

- The id is a channel that is **already available** in the catalog. No request is created. The
  API returns 409 with the channel id, and the form shows "Already in the catalog" with a **Follow**
  button (decision 6). This closes the `TODO(owner)` in the request store about auto-approving such
  requests: they are refused instead.
- The user has **already requested** this channel. The existing request is returned and shown in the list.

Poll `GET /channel-requests` every 15 seconds only while any request has outcome `awaiting_review`,
`importing`, or `approved_pending_follow`. Stop polling otherwise.

## 7. Screen: Owner `/owner`

```
Media Digest                                  you@example.com · owner · Switch account
Home · Owner (3)

Requests · Catalog · Needs attention

## Requests

### Waiting (2)
alice@example.com  Foo Channel   UCxxxx   Not in catalog       2h ago
                   [Approve] [Reject]   title: [ Foo Channel ]   note (optional): [              ]
bob@example.com    Bar Channel   UCyyyy   Available            1d ago   also requested by 1 other
                   [Approve] [Reject]

### Reviewed (12) ▸

## Catalog

Available 9 · Pending 2 · Failed 1 · Deleted 1  |  Episodes 61 processed / 70 tracked
Runs active 0  |  Last successful ingestion 3h ago

### Needs attention (2)
Foo Channel   Failed    No captions on any attempted episode · 2d ago · last run: initial, failed   [Retry]
Bar Channel   Pending   for 3 days with no run

### All channels (13)
Title          State      Episodes                 Last ingested  Latest run             Requesters
Some Channel   Available  12 / 12                  3h ago         scheduled · completed  2   Delete
Foo Channel    Failed     0 / 5 · 5 no captions    —              initial · failed       1   Retry · Delete
Old Channel    Deleted    4 / 5                    30d ago        —                      0   Restore

Add a channel  [ UC… channel id ] [ title (from feed) ] [ import count: 5 ] [Add]
```

### 7.1 Requests

Source: `GET /channel-requests?scope=all`. Two groups.

**Waiting.** Pending requests, oldest first, because the queue should drain in arrival order. Row: requester
email, channel title, id linked to its YouTube page, the id's **catalog state** (Not in catalog, Pending, Available, Failed,
Deleted), relative age, and "also requested by N other(s)" when other pending requests share the id.
Actions: **Approve** and **Reject**, each with an optional note that becomes `ownerExplanation`. Approve
and reject apply to one request; approving a second request for the same channel reuses the channel
(`approveRequest` already does this). Approve is disabled with the note "restore the channel first" when the
catalog state is Deleted. **This is a Registry behaviour change, not a mirror of an existing rule:** today
`approveRequest` reuses a deleted channel silently (its doc comment says so). It must instead throw
`INVALID_STATE`, the rule `retryChannel` already applies to deleted channels, and needs a test. The disabled
button only reflects the Registry's refusal; the Registry is the guard.

**Reviewed.** Approved and rejected requests, newest first, collapsed by default. Row adds reviewer,
review time, explanation, and for approved requests whether the automatic follow has been delivered.

### 7.2 Catalog health strip

Source: `GET /catalog`. Counts by channel state (available, pending, failed, deleted), episodes
processed over episodes tracked, active runs (queued or running), and the most recent successful ingestion
anywhere in the catalog. Numbers only; each links to the matching filter of the All channels table.

### 7.3 Needs attention

The failed-channel review the request asked for, plus one neighbour.

- **Failed, non-deleted channels.** Row: title linked to detail, humanized failure code, `failureDetail` when
  present, when it failed (`updatedAt`), and the latest run's kind and status. Action: **Retry**, which is
  `failed → pending`. Failure code wording:

  | Code | Shown as |
  |---|---|
  | `NO_TRANSCRIPTS` | No captions on any attempted episode |
  | `NO_EPISODES` | The feed had no episodes |
  | `INITIAL_IMPORT_FAILED` | Import failed for technical reasons |

- **Stuck pending channels.** Pending, non-deleted, and no queued or running run, regardless of age
  (decision 9). Shown without an action; the message says a run has not started and how long the channel
  has been pending. Until the ingestion Workflow exists (M3), every approved channel will sit here, which
  is the honest picture.

### 7.4 All channels

Source: `GET /channels?scope=all`; each row carries the owner-only `management` block. One row per channel in
every state, including deleted, with client-side
filter links from the health strip. Columns:

| Column | From | Notes |
|---|---|---|
| Title | `channels.title` | Links to `/owner/channels/:id`. |
| State | `channels.status`, `deleted_at` | Deleted overrides the processing state visually; the underlying state stays in the detail view. |
| Episodes | `episodes` grouped by status | `processed / tracked`, then non-zero counts of `no captions`, `failed`, `in progress`. |
| Last ingested | `channels.last_ingested_at` | Relative time. |
| Latest run | `ingestion_runs` | Kind and status of the newest run; failure code when failed. |
| Requesters | `channel_requests` | Count of pending or approved requests for the id. Not a follower count; see §9.3. |
| Actions | | Retry (failed only), Delete (non-deleted), Restore (deleted). Delete asks for confirmation once. |

**Add a channel** (in scope, decision 1). A `UC…` id or `/channel/UC…` URL, optional title, optional import count defaulting to 5. Calls
`POST /channels`, creating a pending channel. Without it, an owner on a fresh deployment could only
seed the catalog by requesting as a user and approving as the owner, which works but is a detour. The
title comes from the RSS feed with an override field, the same as approval (§9.5).

## 8. Screen: Owner channel detail `/owner/channels/:id`

```
← Owner

# Some Channel                                          Available since 2026-08-01
UCxxxxxxxxxxxxxxxxxxxxxx · youtube.com/channel/UCxxxx… · lifecycle v2 · import count 5
[Delete]

## Episodes (12)
Title                    Published   Status         Attempts  Summary      Processed
The big one              2d ago      processed      1         structured   2d ago
Short update             5d ago      no transcript  2         —            —
Broken upload            6d ago      failed         3         —            —      FETCH_FAILED

## Runs (4)
Kind        Status     Started  Finished  Limit  Failure                 Episodes
scheduled   completed  3h ago   3h ago    —      —                       ▸ 2 processed
initial     failed     9d ago   9d ago    5      INITIAL_IMPORT_FAILED   ▸ 3 failed · 2 no captions

## Requests (2)
alice@example.com  approved 2026-08-01 by owner@example.com · followed automatically
bob@example.com    approved 2026-08-03 by owner@example.com · follow not yet delivered
```

This is the "channel-level data" the request asked for suggestions on. Everything below is read from the
Registry DO; the source table is named so it is clear what is available today versus after M3.

**Header** (`channels`): title, canonical URL, id, state with failure code and detail, `available_at`,
`lifecycle_version`, `initial_import_count`, created and updated times. Actions: Retry, Delete, Restore as
applicable.

**Episodes** (`episodes`, `episode_summaries`): title linked to `youtu.be`, published, status, attempt count,
failure code, transcript check time, chunk count, vectorized and processed times, and whether a summary
exists and in which format. Sorted newest published first. This is where the owner sees that a channel
is "available but thin", say two processed out of five.

**Runs** (`ingestion_runs`, `ingestion_run_episodes`): kind, status, started, finished, episode limit,
lifecycle version, failure code and detail. Each run expands to its per-episode outcomes, which stay
historical even after a later retry changes the episode's current status. This is the audit trail for
"why did this fail and what did the retry do".

**Requests** (`channel_requests`): requester, status, reviewer, review time, explanation, and
`auto_follow_completed_at` as "followed automatically" or "follow not yet delivered".

Two things deliberately absent: follower count and read activity. §9.3 explains why.

## 9. Alignment with the Durable Object design

### 9.1 What each screen reads

| Screen or section | Registry DO | User DO | Composition |
|---|---|---|---|
| Header, nav | `ensureUser` via middleware | — | `GET /me`, exists. |
| Owner card, health strip | new `getCatalogSummary(actor)` | — | Owner-checked in the DO; returns the `Catalog` aggregate. |
| Digest | new `listDigest(channelIds, since)` | `activeChannelIds`, `readVideoIds`, `markRead` | Route intersects active follows with available non-deleted channels, fetches summaries, computes `wasUnread`, then marks read. |
| Followed | new `listChannelsByIds(ids)`, new `listProcessedVideoIds(ids)` | `listFollows`, `readVideoIds` | Unread per channel = processed ids minus read ids. |
| Available | `listAvailableChannels` | `listFollows` | Follow state merged in the route. |
| Your requests | `listOwnRequests`, `listChannelsByIds` | — | `outcome` computed in the route from request status plus channel state. |
| Request queue (`?scope=all`) | `listAllRequests`, `listChannels(actor)` | — | Channel state per request merged in the route. |
| All channels, attention | new `listChannelManagement(actor)` | — | Channel plus its `management` block: episode counts, latest run, requester count, stuck flag. |
| Channel detail | `getChannel` + new `listEpisodes`, `listRuns`, `listRequestsForChannel` | — | Four sub-resource reads; the owner's `processing` fields ride on the same episode rows. |

### 9.2 New Registry methods, all read-only and additive

Proposed modules follow the existing pattern of one store module per concern under `do/registry/`:

- `episodes.ts`: `listProcessedVideoIds(channelIds)`, `listDigest(channelIds, sinceMs)`,
  `countByChannelAndStatus(channelIds)`, `listByChannel(channelId)`. Digest items join `episodes`,
  `episode_summaries`, and `channels.title`; related ids are resolved to titles inside the method and
  filtered to the passed channel ids, so the route never sees titles from ineligible channels.
- `runs.ts`: `latestByChannel(channelIds)`, `listByChannel(channelId)` with run episodes, `countActive()`,
  `channelIdsWithActiveRun()`, `lastCompletedFinishedAt()`.
- `catalog.ts`: `summarize()`, the `Catalog` aggregate (channels by state, stuck pending, episodes, runs, pending
  requests, last successful ingestion) in a handful of small queries.
- `channels.ts` additions: `listChannelsByIds(ids)` in any state, for followed rows and request outcomes.
- Facade methods on `RegistryDO`: `listChannelsByIds`, `listProcessedVideoIds`, `listDigest`, `listEpisodes`
  (unscoped by role, scoped by the channel ids the caller passes), and owner-checked `getCatalogSummary`,
  `listChannelManagement`, `listRuns`, `listRequestsForChannel`. Internal names follow the entity vocabulary of
  §10; the plan (§15) is the authoritative list.

All `IN (...)` lists go through `lib/sql.ts` chunking; a reader following 20 channels with 50 processed
episodes each produces 1,000 video ids, which is well within the PRD's five-second Home target but over the
100-parameter cap per statement. M3 will add the write side to the same modules.

### 9.3 What the DOs cannot tell us, and what we show instead

- **Follower counts.** Follows live only in each User DO. The Registry has no way to count them without
  fanning out to every user object or maintaining a denormalized counter that follow and unfollow would
  have to write across DOs with no atomicity. Neither belongs in this slice. The owner view shows
  **requester count** from `channel_requests` instead, which the Registry owns and which approximates
  interest. If a real follower count is wanted later, the honest design is a counter in `channels`
  updated by the follow routes with an idempotency rule, decided separately.
- **Read and chat activity.** Private to User DOs by design (`AGENTS.md`: never expose another user's
  private DO data). The owner view never shows who has read what.
- **Whether ingestion is enabled.** The Registry does not know that the Workflow is not yet deployed.
  Pending channels with no run simply surface as stuck pending (§7.3).

### 9.4 What is empty until M3 and M4

The digest, unread counts, processed counts, episode lists, and run lists all read tables that ingestion
writes. Nothing writes them yet. This slice ships those screens with real empty states and tests them with
SQL-seeded fixtures, the way `test/helpers.ts` already drives channel state. When M3 lands, the screens
fill in without UI changes.

### 9.5 Write paths used by the light actions

| Action | Registry DO | User DO | Status |
|---|---|---|---|
| Follow, unfollow | `getChannel` for eligibility | `follow`, `unfollow` | Methods exist; routes new. |
| Request | RSS fetch to verify the id and capture the title, `getChannel` for the already-available refusal, then `submitRequest` with the title | — | Exist; the feed check, the `channel_title` column, and the refusal are new. |
| Approve | `approveRequest` | — | Exists; two changes: default the title from the request's stored `channel_title`, and refuse a deleted channel with `INVALID_STATE` (§7.1). |
| Reject | `rejectRequest` | — | Exists. |
| Retry | `retryChannel` | — | Exists; starting the run is M3. |
| Delete, restore | `deleteChannel`, `restoreChannel` | — | Exist. |
| Add channel | `configureChannel` | — | Exists; RSS verification of the id and the feed-title default are new. |

**Automatic follows stay with M3.** `AGENTS.md` delivers automatic follows "once the channel is
available" through a durable handoff: approved requests with `auto_follow_completed_at IS NULL` whose
channel is available are delivered to the User DO, then acknowledged in the Registry. That sweep is M3
work and this slice adds nothing to it. Because submission refuses requests for already-available
channels (decision 6), approval only ever meets a channel that is absent, pending, failed, or deleted, and
delivery happens when import makes it available. The one remaining shape, a request for a deleted channel
that the owner restores and then approves while it is available, leaves exactly the row M3's sweep
selects, so it is covered without special handling here.

**Approve needs a title** (decision 7, simplified by decision 2). `ApproveRequestInput.title` is required
when approval creates the channel. The request already carries the title captured from the RSS feed at
submission, so the approve form shows it prefilled and the owner may edit it; no fetch happens at approval.
Owner **Add a channel** takes the same path as submission: verify the id against its RSS feed
(`lib/youtube/rss.ts`, an allowed public endpoint) and take the feed title unless one was typed. If the
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
channel has that id. Success yields the channel title, stored as `channel_requests.channel_title`
(nullable, additive migration `0002`) so the requester's list, the owner queue, and the approve form all
show a name rather than an opaque id. `submitted_url` keeps whatever the user typed.

### 9.7 Consistency notes

- **Deleted but followed.** A follow row survives channel deletion. `GET /follows` reports the channel as
  unavailable; `GET /digest` and unread counts exclude it. Restoration makes it eligible again with no user
  action. Explicit unfollow stays unfollowed.
- **Read marking is a side effect of reading.** Every Home load marks the returned digest items read, per
  `AGENTS.md`. The NEW marker and the load order in §6.3 make that visible and consistent.
- **The owner is a normal reader.** Owner-only data comes only from owner routes; the reader routes never
  branch on role.

## 10. API contract

**The API is modelled on the system's entities, never on roles.** Resources are nouns: the catalog, channels,
episodes, ingestion runs, follows, the digest, channel requests. Authorization is a property of an operation
(and, for a few fields, of the representation), not of a URL namespace or a type name. There is no `/owner/*`
prefix and no `Owner*` type. Three conventions carry this:

- **Same representation for every caller**, plus caller-relationship fields (`following`, `wasUnread`,
  `unreadCount`) and, on channels only, a `management` block that is present when the caller is the owner.
- **Collections default to what the caller may act on.** `?scope=all` widens a collection to everything the
  system holds (every channel state including deleted; every user's requests) and is owner-only.
- **Owner-only operations** return 403 `NOT_OWNER` to anyone else. `requireOwner` in `middleware/owner.ts` is
  applied to those handlers; the Registry re-checks the role inside every owner-only method, so the middleware
  is a convenience, not the guard.

Rows marked *exists* are in the `AGENTS.md` target contract as originally written; rows marked *delta* were
proposed here and approved on 2026-09-07 (decisions 3, 4, 6, 7) and then re-shaped onto entities the same day
(decision 11). The `AGENTS.md` contract table carries the result (§16).

| Method and path | Who | Purpose | Status |
|---|---|---|---|
| `GET /me` | anyone | Email and role | Implemented |
| `GET /catalog` | owner | The catalog's aggregate state: channels by state, stuck pending, episodes processed/tracked, active runs, pending requests, last successful ingestion. Feeds the Home attention card and the health strip | **delta** |
| `GET /channels` | anyone | Available, non-deleted channels with `following` and `processedCount`. `?scope=all` (owner) returns every state including deleted, each with `management` | exists; `scope`, `management` are deltas |
| `POST /channels { channelId, title?, initialImportCount? }` | owner | Create a pending channel. The id is verified against its RSS feed and the feed title used unless given; 409 `INVALID_STATE` if the id is already in the catalog | exists; verification and 409 are deltas |
| `GET /channels/:id` | anyone | One channel. Readers get it only while available and non-deleted (404 otherwise); the owner gets any state, with `management` | exists; `management` is a delta |
| `DELETE /channels/:id`, `POST /channels/:id/restore` | owner | Soft delete, restore | exists |
| `POST /channels/:id/retry` | owner | `failed → pending`; run start is M3 | exists |
| `GET /channels/:id/episodes?limit=` | anyone | Episodes newest first. Followers (and the owner) receive `summary`, `related`, and `wasUnread`, and those summaries are marked read for the caller; non-followers receive episodes without summaries. The owner also receives `processing` per episode | **delta** (replaces the summaries in `GET /channels/:id`) |
| `GET /channels/:id/ingestion-runs` | owner | Runs newest first, each with per-episode outcomes | **delta** |
| `GET /channels/:id/requests` | owner | Requests for this channel, every requester | **delta** |
| `GET /follows` | anyone (own) | Active follows, each embedding its `channel` and carrying `unreadCount`; most recent ingestion first | exists |
| `PUT /follows/:channelId`, `DELETE /follows/:channelId` | anyone (own) | Follow or refollow an available channel (409 otherwise); retained unfollow | exists |
| `GET /digest?since=<iso>` | anyone (own) | Episodes with summaries from eligible follows, newest first, default 24 h, clamped to 7 days; returned summaries are marked read; each carries `wasUnread` | exists; `wasUnread` and the clamp are deltas |
| `GET /channel-requests` | anyone (own); `?scope=all` owner | Requests with `outcome` and the channel's current `state`; own by default, everyone's with `?scope=all` | exists; `scope`, `outcome`, `channel` are deltas |
| `POST /channel-requests { channelId }` | anyone | Request by `UC…` id or `/channel/UC…` URL. 400 `INVALID_INPUT` for handles, other URLs, or an id with no RSS feed; 409 `INVALID_STATE` with `channelId` when already available; records the feed title | exists; body, 400s, 409 body are deltas |
| `POST /channel-requests/:id/approve { title?, initialImportCount?, explanation? }` | owner | Approve; creates the channel with the request's stored title unless one is given; 409 `INVALID_STATE` while the channel is deleted | exists; stored-title default and the refusal are deltas |
| `POST /channel-requests/:id/reject { explanation? }` | owner | Reject | exists |

Response shapes live in `packages/shared` and are named after the entity they carry. Sketch of the ones with
new structure:

```ts
/** A catalog channel as any caller sees it; `management` is present for the owner only. */
export type Channel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: ChannelStatus;
  failureCode: ChannelFailureCode | null;
  deletedAt: number | null;
  available: boolean;              // status available and not deleted
  lastIngestedAt: number | null;
  processedCount: number;
  following: boolean;              // caller-relationship field
  management?: ChannelManagement;
};

export type ChannelManagement = {
  initialImportCount: number;
  failureDetail: string | null;
  availableAt: number | null;
  lastCheckedAt: number | null;
  lifecycleVersion: number;
  createdAt: number;
  updatedAt: number;
  episodes: { processed: number; pending: number; processing: number; noTranscript: number; failed: number };
  latestRun: IngestionRunSummary | null;
  requesterCount: number;          // pending or approved requests; stands in for follower count
  stuckPending: boolean;           // pending, not deleted, no queued or running run
};

export type Episode = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: number;
  status: EpisodeStatus;
  summary: EpisodeSummary | null;  // present for followers and the owner
  related: { videoId: string; title: string }[]; // already filtered to the caller's eligible channels
  wasUnread?: boolean;             // set when a summary was returned to a reader
  processing?: EpisodeProcessing;  // owner only
};
export type DigestResponse = { since: number; episodes: Episode[] };

export type Follow = {
  channelId: string;
  followedAt: number;
  unfollowedAt: number | null;
  origin: FollowOrigin;
  channel: Channel;                // embedded; `available` false for a deleted channel
  unreadCount: number;
};

/** One request as its requester and the owner both see it. */
export type ChannelRequest = {
  requestId: string;
  userEmail: string;
  channelId: string;
  channelTitle: string | null;     // feed title captured at submission
  submittedUrl: string;
  status: ChannelRequestStatus;
  reviewedAt: number | null;
  reviewedByEmail: string | null;
  ownerExplanation: string | null;
  autoFollowCompletedAt: number | null;
  createdAt: number;
  outcome: RequestOutcome;         // the requester's one-phrase view
  channel: { state: CatalogState; failureCode: ChannelFailureCode | null }; // the owner's decision inputs
};

/** 409 body when a request targets an already-available channel; the UI offers Follow. */
export type ChannelAlreadyAvailableResponse = ErrorResponse & { code: "INVALID_STATE"; channelId: string };

export type Catalog = {
  channels: { available: number; pending: number; failed: number; deleted: number; stuckPending: number };
  episodes: { processed: number; tracked: number };
  runs: { active: number };
  requests: { pending: number };
  lastSuccessfulIngestionAt: number | null;
};
```

`IngestionRun`, `IngestionRunEpisode`, `IngestionRunSummary`, `EpisodeSummary`, `EpisodeProcessing`, and the
enums join the existing types in `packages/shared`. Every response wraps its entity or list in a named field
(`{ channel }`, `{ channels }`, `{ episodes }`, `{ follows }`, `{ requests }`, `{ runs }`).

## 11. States, errors, polling, layout

- **Loading.** The word "Loading…" in place of each section. Sections load independently; a slow digest
  never blocks the channel list.
- **Errors.** Inline, per section: "Couldn't load the digest. Retry." with a retry link. No toasts, no
  modals. A 400 from a malformed `X-User-Email` returns the user to `/`.
- **Actions.** Buttons disable while in flight and the row re-renders from the response. Delete asks
  "Remove <title> from the catalog? Follows and content are kept." once. Retry, approve, reject, follow,
  and unfollow act immediately; their effects are reversible or recorded.
- **Polling.** Only the request list, only while a request is in flight (§6.4). The owner attention count
  refreshes on navigation, not on a timer.
- **Timestamps.** Relative in the row ("3h ago"); the absolute time in the element's `title`.
- **Layout.** Text only, one CSS file, no component library. Reader pages keep the current 42rem measure.
  Owner tables sit in a wider container (64rem) inside an `overflow-x: auto` wrapper, so the page never
  scrolls horizontally. Nav wraps on narrow screens.
- **Routing.** History mode (decision 8). Deep links and reloads are verified under `wrangler pages dev`
  before the web PR merges; if Pages does not serve `index.html` for unknown paths as expected, the
  fallback is hash mode, changed in one place.
- **Files.** Per the `AGENTS.md` layout: `main.tsx`, `api.ts` (the only `fetch` caller), `account.ts`,
  `session.tsx`, `lib/time.ts`, `lib/copy.ts`; screens `Account`, `Home`, `Channel`, `Owner`, `OwnerChannel`;
  components `Nav`, `OwnerCard`, `Digest`, `ChannelList`, `Requests`, `RequestQueue`, `CatalogHealth`,
  `CatalogTable`, `AddChannel`. `components/Chat.tsx` waits for M4. Small files over large ones.

## 12. Out of scope for this slice

Chats and preferences, the ingestion Workflow and cron, summary generation, the reader Channel screen's
details beyond what `AGENTS.md` already specifies, editing a channel's title or import count after creation,
bulk approve, follower counts, any notification.

## 13. Decisions made with the owner, 2026-09-07

1. **Cut line.** Ship the light actions with the read views: follow, unfollow, request, approve, reject,
   retry, delete, restore, add channel. Every one maps to an existing Registry method.
2. **Channel identity.** Users supply the `UC…` channel id, or a `/channel/UC…` URL, copied from the channel's
   About dialog. No handle resolution. Revised the same day from "resolve handles via the public channel
   page" once the owner asked whether users could simply provide the id: it is one copy away for anyone, and
   dropping resolution removes an InnerTube call from the request path. The id is verified against its RSS
   feed at submission and the feed title stored on the request. YouTube Data API v3 remains rejected as a
   credentialed Google dependency.
3. **`GET /catalog`.** New route: the catalog's aggregate state, feeding the Home attention card and the health
   strip. Proposed as `GET /owner/overview`, renamed the same day under decision 11.
4. **Channel sub-resources.** `GET /channels/:id/episodes`, `/ingestion-runs`, and `/requests` serve the detail
   view; the list route stays light. Proposed as one `GET /owner/channels/:id`, re-shaped under decision 11.
5. **Digest empty states.** Two: "Follow a channel to start your digest." with the catalog inline for
   readers with no follows; "Nothing new since yesterday." otherwise.
6. **Requests for already-available channels.** The owner's observation: nobody requests a channel they can
   see and follow. So submission refuses such a request with 409 and a Follow hint, no request row is
   created, and automatic-follow delivery stays entirely with M3's sweep. Closes the `TODO(owner)` in the
   request store.
7. **Channel title.** Captured from the RSS feed when a request is submitted, or when the owner adds a channel,
   and stored on the request. Approval uses the stored title and fetches nothing. The owner may override in
   either form; 400 with a prompt when a feed fetch fails and nothing was typed.
8. **Routing.** History mode, verified under `wrangler pages dev`; hash mode is the fallback.
9. **Stuck pending.** No age threshold. Any pending, non-deleted channel with no queued or running run is
   listed, with how long it has been pending.
10. **UI vocabulary.** "Owner".
11. **API modelled on entities, not roles** (owner correction after Step 1.1 of the plan). The owner is a role
    that authorizes operations; it is not a resource. No `/owner/*` namespace, no `Owner*` types. Owner-only
    operations are marked per route and return 403 to others; `?scope=all` widens collections for the owner;
    channels carry a `management` block for the owner; every other representation is identical for all callers.
    Step 1.1 was reverted and the contract rewritten (§10).

## 14. Acceptance criteria

- A new email selected on Account lands on Home with role `user`, sees no owner card or nav entry, and
  receives 403 `NOT_OWNER` from every owner-only operation: `GET /catalog`, any `?scope=all`, `POST /channels`,
  delete, restore, retry, approve, reject, `/ingestion-runs`, and `/channels/:id/requests`.
- The seeded owner email lands on Home with the owner nav entry; the card appears only when the attention
  count is nonzero and links to `/owner#attention`.
- A reader with no active follows sees the available catalog inside the digest section and can follow from
  there; after following, the digest shows "Nothing new since yesterday." until summaries exist.
- With seeded summaries: the digest lists the last 24 hours across eligible channels newest first, marks
  NEW on items without a receipt, records receipts for exactly the returned items, and excludes deleted and
  unfollowed channels. "Show last 7 days" widens the window.
- Followed rows show processed and unread counts consistent with the NEW markers on the same load; a
  deleted channel that is still followed shows as unavailable and disappears from the digest.
- Own requests show the correct `outcome` for each combination in §6.4, and polling stops when none is in
  flight.
- Submitting an id for an already-available channel creates no request and returns 409 with the channel
  id; the form offers Follow. Submitting an `@handle` or any URL without `/channel/UC…` returns 400 with the
  copy-the-id instructions; a well-formed id with no RSS feed returns 400 "no channel has that id"; a valid
  id records the request with the feed title, which appears in the requester's list and the owner queue.
- The owner request queue shows catalog state per request; approve creates or reuses the channel, uses the
  request's stored title unless one was typed, and records the explanation; reject records the explanation;
  approving a request for a deleted channel is refused by the Registry with `INVALID_STATE` and the UI shows
  the restore hint.
- Catalog health counts match seeded fixtures; failed channels list with humanized codes and Retry moves
  them to pending; every pending channel with no queued or running run appears under Needs attention.
- History-mode deep links to `/owner` and `/owner/channels/:id` survive a reload under `wrangler pages dev`.
- Channel detail shows episodes with summary format, runs with per-episode outcomes, and requests with
  auto-follow state.
- Two users with overlapping follows see independent unread counts and NEW markers for the same summaries.
- `pnpm check` passes; every route has been exercised under `wrangler dev` with a seeded local Registry.

## 15. Delivery

Sequencing, file lists, tests, and exit criteria live in `docs/specs/home-read-experience-plan.md`: Phase 1 is the
complete API, Phase 2 the complete web application, each mergeable on its own. The `AGENTS.md` and PRD edits in §16
were applied on 2026-09-07 before either phase starts.

## 16. `AGENTS.md` and PRD edits carrying the decisions (applied 2026-09-07)

- **Hard rule 2.** Name YouTube's allowed endpoints precisely: the RSS feed, and for transcripts one InnerTube
  `player` call as a mobile client plus the caption-track GET it returns. No watch-page scraping, no YouTube
  Data API. (A channel-page clause for handle resolution was added and removed the same day when decision 2
  was revised; the transcript mechanism was decided separately the same day, see the transcript contract.)
- **Catalog, requests, and follows.** Users supply the `UC…` id; no handle resolution; the id is verified by
  RSS at submission and the feed title stored on the request. A request for a channel that is already
  available and not deleted is refused with a follow hint and creates no request. Remove the auto-approve
  `TODO(owner)` from the request store when the route lands.
- **Web UI, Screens.** Replace the `/home` entry's three-section description with: owner attention card
  (owners only), Digest with the two empty states, Channels with Followed, Available, Your requests.
  Note that Chats joins Home in M4. Add `/owner` and `/owner/channels/:id`. Record history-mode routing.
- **Web UI.** Resolve "Owner catalog management is required, but a general admin dashboard is not… the
  management screens themselves are `TODO(owner)`" by pointing at `/owner` and this document.
- **API shape.** Replace the role-namespaced `/owner/*` rows with entity routes: `GET /catalog`,
  `?scope=all` on `/channels` and `/channel-requests`, `management` on channels, `POST /channels`, the channel
  sub-resources `/episodes`, `/ingestion-runs`, `/requests`, actions on `/channels/:id` and `/channel-requests/:id`.
  Note `outcome` and the 409 body on requests, the stored-title default on approve, the RSS verification on
  create, and the refusal of approval while a channel is deleted. State the entities-not-roles principle.
- **Open decisions.** Close "Owner management interface".
- **Repo layout.** API: `do/registry/episodes.ts`, `runs.ts`, `catalog.ts`; `lib/eligibility.ts`, `lib/outcome.ts`,
  `lib/channel-view.ts`, `lib/episode-view.ts`, `lib/body.ts`, `lib/ingestion.ts`; `middleware/owner.ts`; `routes/catalog.ts`, `channels.ts`, `follows.ts`, `digest.ts`,
  `channel-requests.ts`; migration `0002`. Web: `session.tsx`, `lib/time.ts`, `lib/copy.ts`, the screens and
  components listed in §11. Plus `docs/specs/`. The plan's steps 1.7 and 2.8 confirm the layout matches what exists.
- **PRD §7.** Mirror the screen changes; PRD §9 closes the management-interface open decision.
