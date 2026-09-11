# Implementation plan — Home read experience

**Implements:** `docs/specs/home-read-experience.md` (the spec) under the rules in `AGENTS.md`.
**Written:** 2026-09-07, against the codebase at commit `c668729` plus the uncommitted doc changes of that day.
Revised the same day after the owner's correction that the API must be modelled on entities, not roles (spec
decision 11); Step 1.1 was reverted and restarts from this version.
**Status:** delivered. Phase 1 complete on 2026-09-07 (20 test files, 96 tests, walkthrough recorded in the PR notes
below). Phase 2 built the same day: every screen in spec §5–§8, `pnpm check` green, history-mode deep links verified
under `wrangler pages dev`.
**Superseded in part (2026-09-10):** this plan is the record of the first delivery and is not to be re-executed.
`docs/specs/channel-simplification-plan.md` (Tasks 1–12, merged to `main` at `6e075b1`) replaced everything here
about channel requests (`channel_requests`, migration `0002`, `channel_title`, `lib/outcome.ts`, `RequestOutcome`,
`routes/channel-requests.ts`, the `Requests` component and its polling), soft deletion and restore, channel failure
codes and channel retry, `CatalogState`, `requesterCount`, `stuckPending`, `FollowOrigin`, and the automatic follow.
Channels are now `requested | approved | declined` with a pause flag and a real follower record; episodes carry the
import outcomes. Steps below that name those things describe what was built on 2026-09-07, not what exists; the
revised spec (`docs/specs/home-read-experience.md`, 2026-09-10) describes the screens and routes on `main`. The owner's
browser walkthrough of the revised screens was completed on 2026-09-10.
**Shape:** two phases. Phase 1 delivers the complete API with the web app untouched. Phase 2 delivers the complete
web app against that API. Each phase ends in a state that can be merged and left alone: nothing in Phase 1 depends
on Phase 2 existing, and Phase 2 adds no API surface.

Every step is one logical change (one commit or PR), ends with `pnpm check` green, and anything that touches Workers
runtime behaviour is exercised under `wrangler dev`. No new dependencies in either phase. Where this plan makes a call
the spec left open, the call is marked **plan decision**; the owner can veto any of them before the step starts.

**API shape reminder (spec §10).** Resources are nouns: catalog, channels, episodes, ingestion runs, follows,
digest, channel requests. Owner-only operations are guarded per handler with `requireOwner` and re-checked in the
Registry. The owner receives the same representations as everyone, plus `management` on channels and `?scope=all` on
collections. No `/owner/*` routes, no `Owner*` types.

## Phase 1 — API

### Definition of complete

- Every route in spec §10 responds per contract: `GET /me` (exists), `GET /catalog`, `GET|POST /channels`,
  `GET|DELETE /channels/:id`, `POST /channels/:id/restore|retry`, `GET /channels/:id/episodes`,
  `GET /channels/:id/ingestion-runs`, `GET /channels/:id/requests`, `GET /follows`, `PUT|DELETE /follows/:channelId`,
  `GET /digest`, `GET|POST /channel-requests`, `POST /channel-requests/:id/approve|reject`.
- Registry migration `0002` adds `channel_requests.channel_title`; `submitRequest` stores it; `approveRequest`
  defaults the title from it and refuses deleted channels.
- Registry read modules for episodes, runs, and the catalog summary exist with tests driven by SQL-seeded fixtures.
- `lib/youtube/ids.ts` extracts ids from `/channel/UC…` URLs; `lib/youtube/rss.ts` verifies an id and returns the feed
  title and entries, verified against a real feed under `wrangler dev`.
- Required test coverage from `AGENTS.md` → Testing is in place for every new route and data path.
- A recorded `wrangler dev` walkthrough passes end to end with `curl`.
- `AGENTS.md` repo layout names every file that now exists. Ingestion hooks are log-only placeholders for M3.

### Step 1.1 — Shared types  (size: S)

**File:** `packages/shared/src/index.ts`.

Add the entity shapes the routes return, named after the noun they carry, so Phase 2 compiles against them
unchanged:

- Enums: `EpisodeStatus`, `SummaryFormat`, `IngestionRunKind`, `IngestionRunStatus`, `IngestionRunEpisodeStatus`,
  `CatalogState` (`not_in_catalog | pending | available | failed | deleted`), `RequestOutcome`.
- Channels: `Channel` (public fields, `available`, `processedCount`, `following`, optional `management`),
  `ChannelManagement`, `EpisodeCounts`, `IngestionRunSummary`, `ChannelsResponse { channels }`,
  `ChannelResponse { channel }`, `CreateChannelBody`.
- Episodes: `EpisodeSummary` (structured or raw fallback), `RelatedEpisode`, `EpisodeProcessing`, `Episode`
  (with optional `summary`, `wasUnread`, `processing`), `EpisodesResponse { episodes }`, `DigestResponse { since, episodes }`.
- Ingestion runs: `IngestionRunEpisode`, `IngestionRun`, `IngestionRunsResponse { runs }`.
- Follows: `Follow` (embeds `channel`, carries `unreadCount`), `FollowsResponse { follows }`, `FollowResponse { follow }`.
- Channel requests: `ChannelRequest` (one type for requester and owner, with `outcome` and `channel.state`),
  `ChannelRequestsResponse { requests }`, `ChannelRequestResponse { request }`,
  `ApproveChannelRequestResponse { request, channel, channelCreated }`, `CreateChannelRequestBody`,
  `ApproveChannelRequestBody`, `RejectChannelRequestBody`, `ChannelAlreadyAvailableResponse`.
- Catalog: `Catalog`, `CatalogResponse { catalog }`.

Registry-internal types in `do/registry/types.ts` stay internal; routes project them onto these entities. Every
type carries a one-line comment naming its route, as `MeResponse` does today.

**Done when:** `pnpm typecheck` passes; nothing at runtime changes.

### Step 1.2 — Migration 0002  (size: S)

**Files:** `apps/api/migrations/registry/0002_channel_request_title.sql`, `apps/api/migrations/registry/index.ts`,
`apps/api/src/do/registry/requests.ts`, `apps/api/src/do/registry/types.ts`.

- `ALTER TABLE channel_requests ADD COLUMN channel_title TEXT;` Additive, nullable, so existing rows are valid.
- Register it after `0001_init`. Add `channel_title` to `RequestRow`, `REQUEST_COLUMNS`, `toRequest`, and
  `ChannelRequest.channelTitle: string | null` (the Registry-internal type). `SubmitRequestInput` gains
  `channelTitle?: string` (trimmed, stored null when empty).

**Tests:** extend `registry-migrations.test.ts`: a fresh DO records both versions, a second run applies nothing, the
column exists. Extend `registry-requests.test.ts`: `submitRequest` stores and returns the title.

### Step 1.3 — Registry read modules and request changes  (size: L)

**Files:** new `do/registry/episodes.ts`, `do/registry/runs.ts`, `do/registry/catalog.ts`; edits to
`do/registry/channels.ts`, `do/registry/requests.ts`, `do/registry.ts`, `do/registry/types.ts`; `test/helpers.ts`.

All `IN (...)` lists go through `lib/sql.ts` chunking (100-parameter cap). Every query filters on the channel ids
the caller passes, so nothing leaks across eligibility.

`channels.ts`
- `listChannelsByIds(sql, ids)`: any state, including deleted. For follows, request outcomes, and channel views.

`episodes.ts`
- `listProcessedVideoIds(sql, channelIds)`: `{ channelId, videoId }[]` where `status = 'processed'`.
- `countByChannel(sql, channelIds)`: per channel `{ processed, pending, processing, noTranscript, failed }`.
- `listDigest(sql, channelIds, sinceMs)`: processed episodes with `published_at >= since`, joined to
  `episode_summaries` and `channels.title`, newest first. Parses the `_json` columns. Resolves
  `related_video_ids_json` to titles with a second query restricted to processed episodes in the same channel ids,
  so ineligible titles never leave the DO.
- `listByChannel(sql, channelId, limit)`: every episode in every status, newest published first, left-joined to its
  summary and carrying the processing fields. One row shape serves both the reader (route strips `processing`,
  and `summary` for non-followers) and the owner. **Plan decision:** default 20, max 200.

`runs.ts`
- `latestByChannel(sql, channelIds)`, `listByChannel(sql, channelId)` with `listRunEpisodes(sql, runIds)`,
  `countActive(sql)` (queued or running), `channelIdsWithActiveRun(sql)`, `lastCompletedFinishedAt(sql)`.

`catalog.ts`
- `summarize(sql)`: channels by state excluding deleted plus a deleted count; `stuckPending` = pending, not
  deleted, no active run; episodes processed and tracked; active runs; last completed run's `finished_at`; pending
  request count. Several small aggregate queries, one method.

`requests.ts`
- `approveRequest`: when the channel exists and `deletedAt !== null`, throw `INVALID_STATE`
  ("channel is deleted; restore it first"). Title for a new channel is `input.title ?? request.channelTitle`;
  neither present → `INVALID_INPUT` ("title is required"). `ApproveRequestInput.title` becomes optional. Rewrite
  the doc comment, which currently promises the opposite.
- `countRequestersByChannel(sql, channelIds)`: pending or approved, for `management.requesterCount`.
- `listByChannel(sql, channelId)`: for `GET /channels/:id/requests`.

`registry.ts` facade
- Scoped by the ids passed, any caller: `listChannelsByIds`, `listProcessedVideoIds`, `listDigest`,
  `listEpisodes(channelId, limit)`.
- Owner-checked: `getCatalogSummary(actor)`, `listChannelManagement(actor, channelIds?)` (channels joined to
  counts, latest run, requester count, and `stuckPending` inside the DO, so `GET /channels?scope=all` and the
  `management` block on `GET /channels/:id` are one RPC each), `listRuns(actor, channelId)`,
  `listRequestsForChannel(actor, channelId)`.

`test/helpers.ts`
- `seedEpisode`, `seedSummary`, `seedRun` (with run episodes) via `runInDurableObject` SQL, the way
  `setChannelState` already drives channel state. Ingestion does not exist yet; fixtures stand in for it.

**Tests:** new `registry-episodes.test.ts` (window and ordering, eligibility filtering, related-title filtering,
1,000 ids to prove chunking), `registry-runs.test.ts`, `registry-catalog.test.ts` (every count including stuck
pending); extend `registry-requests.test.ts` (approve a deleted channel → `INVALID_STATE`; approve uses the stored
title; approve with no title anywhere → `INVALID_INPUT`; every owner-checked method rejects a user with `NOT_OWNER`).

### Step 1.4 — YouTube id extraction and RSS  (size: M)

**Files:** `lib/youtube/ids.ts`, new `lib/youtube/rss.ts`, `lib/errors.ts`, `middleware/errors.ts`.

- `extractChannelId(input)`: trims; a bare `UC…` id or a URL whose path contains `/channel/UC…` returns the id;
  anything else, including `@handle` and `/c/…`, throws `INVALID_INPUT` with the instruction text from the spec
  ("open About on the channel's page, then Share channel, then Copy channel ID"). Pure.
- `rss.ts`: `feedUrl(channelId)`; `parseFeed(xml)` → `{ channelId, title, entries: { videoId, title, publishedAt }[] }`,
  pure, entity-decoding, tolerant of attribute order (workerd has no `DOMParser`, so this is a small tag scanner
  over `<entry>` blocks, not a regex over the whole document); `fetchChannelFeed(channelId, fetchImpl = fetch)`
  returns `null` on 404 and throws on any other non-2xx, network error, or unparsable body. M3 will use the same
  parser for episode selection, so entries are parsed now rather than title only.
- **Plan decision:** add `UPSTREAM_UNAVAILABLE` to `DomainErrorCode`, mapped to 502 in `middleware/errors.ts`, for
  "YouTube did not answer" as distinct from "bad input".

**Tests:** `youtube-ids.test.ts` (ids, URLs with and without query strings, handles, junk); `youtube-rss.test.ts`
with fixture XML (real feed saved once, entities, an empty feed, a 404 → `null`, a 500 → throws). Route tests in
later steps use the `YOUTUBE_FEEDS_FAKE` binding (canned feeds per channel id, set only in `vitest.config.ts`), so no
test ever reaches YouTube. The pool's `fetchMock` no longer exists in the pinned version; see plan decision 4.

**Verify under `wrangler dev`:** fetch a real feed once through a temporary log line, then remove it.

### Step 1.5 — Channels and catalog routes  (size: L)

**Files:** new `routes/channels.ts`, `routes/catalog.ts`, `middleware/owner.ts`, `lib/eligibility.ts`,
`lib/channel-view.ts`; edit `index.ts`.

- `middleware/owner.ts`: `requireOwner`, 403 `NOT_OWNER` from `c.var.identity.role`, applied per handler (Hono
  accepts middleware before a handler on the same route). The Registry still re-checks in every owner method.
- `lib/eligibility.ts`: `eligibleChannels(registry, user)` = active follows ∩ available, non-deleted catalog. Used
  by the digest, follows, episodes, and later by chat retrieval, so it is written once.
- `lib/channel-view.ts`: `toChannel(catalogChannel, { following, processedCount, management? })`, the single
  projection from the Registry type onto the shared `Channel`. Adding a Registry column never leaks into the API by
  accident.
- `GET /catalog` (owner) → `getCatalogSummary` → `{ catalog }`.
- `GET /channels`: default `listAvailableChannels` + the caller's follows + processed counts. `?scope=all` (owner;
  403 otherwise) → `listChannelManagement` → every channel with `management`. Any other `scope` value → 400.
- `POST /channels` (owner): `extractChannelId` → `getChannel` exists → 409 `INVALID_STATE` "already in the catalog"
  → `fetchChannelFeed` (`null` → `INVALID_INPUT`; title defaults to the feed title) → `createChannel` → 201
  `{ channel }`. Log `{ event: "ingestion.start_requested", channelId }`: the Workflow is M3.
- `GET /channels/:id`: readers get 404 unless available and non-deleted; the owner gets any state with `management`
  (one `listChannelManagement(actor, [id])` call). `following` and `processedCount` for everyone.
- `DELETE /channels/:id`, `POST /channels/:id/restore`, `POST /channels/:id/retry` (owner) → the existing Registry
  methods → `{ channel }`; retry logs the ingestion hook.
- `GET /channels/:id/episodes?limit=`: 404 for readers unless the channel is available and non-deleted; the owner
  may read any state. `listEpisodes` → for the caller: followers and the owner keep `summary` and `related` and get
  `wasUnread` from `readVideoIds`, then `markRead` of exactly the returned video ids; non-followers get episodes with
  `summary: null` and no `wasUnread`; only the owner keeps `processing`. **Plan decision:** the owner's own read
  receipts are recorded like anyone's when summaries are returned to them.
- `GET /channels/:id/ingestion-runs` (owner) → `listRuns` → `{ runs }`.
- `GET /channels/:id/requests` (owner) → `listRequestsForChannel` + `listChannelsByIds` → `{ requests }` with
  `outcome` and `channel.state` (shared with 1.6 through `lib/outcome.ts`; write that file in this step).

**Tests** (`SELF.fetch`, two emails): a user gets 403 on every owner-only operation and 400 on `?scope=bad`; the
owner's `?scope=all` includes deleted and pending channels with `management`, the default list does not; a reader's
`GET /channels/:id` is 404 for pending and deleted channels while the owner's is 200; episodes strip `processing` for
readers and `summary` for non-followers; a follower's read receipts are recorded for exactly the returned episodes
and never for another user; create → 201, duplicate → 409, handle → 400, no feed → 400 (canned 404); retry,
delete, restore transitions and their `INVALID_STATE` refusals; catalog counts match seeded fixtures, including
stuck pending.

### Step 1.6 — Channel requests, follows, digest routes  (size: L)

**Files:** new `routes/channel-requests.ts`, `routes/follows.ts`, `routes/digest.ts`, `lib/outcome.ts` (if not
already written in 1.5); edit `index.ts`.

- `lib/outcome.ts`: `deriveOutcome(request, channel | null): RequestOutcome` (the seven-row table in spec §6.4)
  and `catalogState(channel | null): CatalogState`. Pure, tested exhaustively.
- `GET /channel-requests`: default `listOwnRequests`; `?scope=all` (owner) `listAllRequests`. Both join
  `listChannelsByIds` and return `ChannelRequest[]` with `outcome` and `channel.state`.
- `POST /channel-requests { channelId }`: `extractChannelId` → `getChannel`: available and non-deleted → respond
  409 with `ChannelAlreadyAvailableResponse` directly from the route (this body carries `channelId`, which
  `DomainError` cannot) → `fetchChannelFeed`: `null` → `INVALID_INPUT` "no YouTube channel has that id" →
  `submitRequest` with `submittedUrl` = the raw input and `channelTitle` = feed title → 201 `{ request }`.
- `POST /channel-requests/:id/approve { title?, initialImportCount?, explanation? }` (owner) → `approveRequest` →
  `{ request, channel, channelCreated }`; log the ingestion hook when created. `POST …/reject { explanation? }`
  (owner) → `{ request }`.
- `GET /follows`: active follows → `listChannelsByIds` → processed ids → `readVideoIds` → per-channel unread →
  `Follow[]` each embedding `toChannel(...)`; sorted by last ingestion, then title.
- `PUT /follows/:channelId`: 404 if unknown, `INVALID_STATE` (409) unless available and non-deleted, else
  `user.follow` → `{ follow }`. `DELETE`: `user.unfollow` (404 if never followed) → `{ follow }` with `unfollowedAt`.
- `GET /digest?since=`: ISO parse, default now − 24 h, invalid → `INVALID_INPUT`. **Plan decision:** `since` is
  clamped to at most 7 days back, matching "Show last 7 days" with no further paging. Eligible → `listDigest` →
  `readVideoIds` → `wasUnread` → `markRead` of exactly the returned ids → `{ since, episodes }`.

**Tests:** requests stay isolated between two emails while the owner's `?scope=all` sees both; a user's
`?scope=all` is 403; submission covers handle → 400, no feed → 400 (canned 404), already available → 409 body,
success stores the title and returns 201; approve on a deleted channel → 409, approve defaults the stored title;
`deriveOutcome` and `catalogState` tables; follows and unfollows isolated, ineligible follow → 409; the digest
marks exactly the returned items and only for the caller; a deleted channel drops out of digest and unread while
its follow row stays with `channel.available === false`.

### Step 1.7 — Wire-up, walkthrough, docs sync  (size: S)

- `index.ts` mounts every router; owner-only handlers carry `requireOwner`.
- Run the walkthrough below under `wrangler dev` with `OWNER_EMAIL` from `.dev.vars` and record the result in the PR.
- The `AGENTS.md` repo layout already lists the planned files (`do/registry/catalog.ts`, `lib/eligibility.ts`,
  `lib/outcome.ts`, `lib/channel-view.ts`, `routes/catalog.ts`, the entity routes, `middleware/owner.ts`); confirm it
  matches what exists and add anything that drifted; confirm the `approveRequest` doc comment was fixed.

**Walkthrough (curl, two emails):**
1. Owner `POST /channels` with a real `UC…` id → 201, title from the feed, `status: pending`; again → 409.
2. User `POST /channel-requests` with the same id → 201 pending (the channel is pending, not available, so no 409).
3. User `POST /channel-requests` with `@handle` → 400 with instructions; with a fake `UC…` id → 400 no channel.
4. Owner `GET /channel-requests?scope=all` → row with title and `channel.state: "pending"`; user's `GET /channel-requests`
   → only their own; approve → 200, `channelCreated: false`.
5. Owner `GET /catalog` → `channels.stuckPending: 1`, `requests.pending: 0`; user `GET /catalog` → 403.
6. Owner `GET /channels?scope=all` → the pending channel with `management`; user `GET /channels` → empty;
   user `GET /channels/<id>` → 404; owner → 200 with `management`.
7. Flip the channel to available with the test helper's SQL through a one-off script (or the retry path once M3
   exists) → user follows it → `GET /follows` shows it with `unreadCount: 0` → `GET /digest` returns no episodes.
8. Owner `DELETE /channels/:id` → user's `GET /follows` shows `channel.available: false`; a new request for it is
   allowed; approving that request → 409; `POST …/restore` brings it back.

**Phase 1 exit checklist:** the definition of complete above, every test in this phase green, `pnpm check` green,
walkthrough recorded, no web changes.

## Phase 2 — Web application

### Definition of complete

- Every screen in spec §5 to §8 is implemented against the Phase 1 API: Account, Home (owner card, Digest,
  Channels with three subsections), Channel, Owner (Requests, Catalog with health strip, Needs attention, All
  channels, Add a channel), Owner channel detail.
- History-mode routing verified under `wrangler pages dev`: deep links and reloads render.
- Every state in spec §11: loading per section, inline errors with retry, in-flight buttons, delete confirmation,
  polling only while a request is in flight, relative timestamps with absolute titles, no horizontal page scroll.
- `pnpm check` green (`apps/web` has typecheck and lint only, per `AGENTS.md`). No component tests.
- A browser walkthrough with two emails covers every UI-observable acceptance criterion in spec §14.

The UI pages keep their `/owner` and `/owner/channels/:id` paths: those are screens for the owner's job, which is a
legitimate UX grouping. Only the API is entity-shaped.

### Step 2.1 — Foundation  (size: M)

**Files:** `src/account.ts`, `src/api.ts`, `src/main.tsx`, `src/session.tsx`, `src/components/Nav.tsx`,
`src/components/Time.tsx`, `src/lib/time.ts`, `src/lib/copy.ts`, `src/lib/use-load.ts`, `src/styles.css`.

- `account.ts`: selected email and up to five recent emails in `localStorage`, normalized (trim, lowercase) and
  shape-checked before storing; every read and write in `try/catch`, so a blocked storage still renders.
- `api.ts`: the only `fetch` caller. Base URL from `import.meta.env.VITE_API_URL`, **plan decision:** defaulting to
  `http://127.0.0.1:8787` in dev. Sets `X-User-Email`. Throws `ApiError { status, code?, body }`. One typed function
  per operation, named by entity: `getMe`, `getCatalog`, `listChannels({ scope })`, `createChannel`, `getChannel`,
  `deleteChannel`, `restoreChannel`, `retryChannel`, `listEpisodes`, `listIngestionRuns`, `listChannelRequests({ scope })`,
  `createChannelRequest`, `approveChannelRequest`, `rejectChannelRequest`, `listFollows`, `follow`, `unfollow`,
  `getDigest`. Every shape imports from `@media-digest/shared`.
- `session.tsx`: loads `GET /me` once, exposes `{ email, role }` by context; no email or a 400 → navigate to `/`.
- `main.tsx`: `preact-iso` `LocationProvider` + `Router` in history mode with `/`, `/home`, `/channel/:id`,
  `/owner`, `/owner/channels/:id`, and a fallback to `/home`.
- `Nav.tsx`: site name, email, `owner` when applicable, "Switch account"; **Home**, and **Owner (n)** for owners
  where `n` comes from `GET /catalog` and refreshes on navigation.
- `lib/time.ts`: relative time with the absolute value for `title`. `lib/copy.ts`: the failure-code and
  `RequestOutcome` phrase tables from spec §6.4 and §7.3, so copy lives in one place.
- `styles.css`: 42rem reader measure, 64rem owner measure, `.table-wrap { overflow-x: auto }`, a NEW marker, a
  muted "unavailable" row style. One file, no framework.

### Step 2.2 — Account  (size: S)

`screens/Account.tsx`: "Who is this for?" input, recent emails as one-click buttons, redirect to `/home` when an
email is already selected. Never the words "sign in".

### Step 2.3 — Home  (size: L)

**Files:** `screens/Home.tsx`, `components/OwnerCard.tsx`, `components/Digest.tsx`, `components/ChannelList.tsx`,
`components/Requests.tsx`.

- **Load order:** `GET /follows` and `GET /channels` in parallel, then `GET /digest`, so unread counts and NEW
  markers agree (spec §6.3). Requests load alongside the first pair. The owner card loads `GET /catalog` only when
  role is owner.
- `OwnerCard`: hidden when the attention count is zero; one line; links to `/owner#attention`.
- `Digest`: episodes per spec §6.3 (title → `youtu.be`, channel → `/channel/:id`, relative time, summary, takeaways,
  tags, related, raw fallback note, NEW). "Show last 7 days" re-queries with `since` = now − 7 d. Two empty states:
  zero active follows renders the Available list inline with Follow buttons; otherwise the fixed sentence.
- `ChannelList`: Followed (last ingestion desc, then title; a follow whose `channel.available` is false renders
  muted with the reason and no link), Available (title order). Follow and Unfollow disable while in flight and
  re-render from the response; following from either list refreshes follows, channels, and the digest's empty state.
- `Requests`: rows from `outcome` copy plus the owner's explanation. Form: id input, help line, Request button.
  400 → inline message from the API; 409 → "Already in the catalog" with a Follow button that follows and
  refreshes; success → refresh the list. Poll every 15 s while any row is `awaiting_review`, `importing`, or
  `approved_pending_follow`; stop otherwise; clear the timer on unmount.

### Step 2.4 — Channel  (size: S)

`screens/Channel.tsx`: `GET /channels/:id` for the header and follow control, `GET /channels/:id/episodes` for the
list. Followers see summaries newest first (the API marks them read); non-followers see titles only and a Follow
control. Back link to `/home`. A 404 renders "This channel is not available." with the back link.

### Step 2.5 — Owner  (size: L)

**Files:** `screens/Owner.tsx`, `components/RequestQueue.tsx`, `components/CatalogHealth.tsx`,
`components/CatalogTable.tsx`, `components/AddChannel.tsx`.

- Guard: a non-owner is sent to `/home` with a one-line note.
- Anchors `#requests`, `#catalog`, `#attention`: scroll into view on load and on hash change.
- `RequestQueue` (`GET /channel-requests?scope=all`): Waiting, oldest first: requester, title, id linked to
  `youtube.com/channel/UC…`, `channel.state`, "also requested by N", Approve and Reject. Approve expands to a title
  field prefilled from `channelTitle`, an import count, and a note; disabled with "restore it first" when the state
  is deleted. Reject expands to a note. Reviewed collapsed in a `<details>` with reviewer, time, explanation, and
  auto-follow delivery.
- `CatalogHealth` (`GET /catalog`): the strip; each count sets the table filter.
- Needs attention (from the `?scope=all` rows): failed non-deleted rows with humanized code, detail, latest run,
  Retry; `management.stuckPending` rows with "pending for 3 days, no run".
- `CatalogTable` (`GET /channels?scope=all`): columns from spec §7.4 read from `management`, client-side filter by
  state, Retry / Delete / Restore per row, Delete behind `window.confirm` with the spec's wording. Wrapped for
  horizontal scroll.
- `AddChannel` (`POST /channels`): id, optional title, import count defaulting to 5; errors inline; 409 says the
  channel is already in the catalog.

### Step 2.6 — Owner channel detail  (size: M)

`screens/OwnerChannel.tsx`: four calls, `GET /channels/:id`, `/episodes`, `/ingestion-runs`, `/requests`. Header
from `management` with actions; episodes table including `processing`; runs with a `<details>` per run showing
per-episode outcomes; requests with auto-follow state. Back link to `/owner`.

### Step 2.7 — States and polish  (size: S)

Loading text per section; inline "Couldn't load X. Retry." per section; a 400 from identity returns to `/`; a 403
navigates home; nav wraps on narrow screens; `pnpm lint -- --write` before finishing.

### Step 2.8 — Verification  (size: S)

- `pnpm check`.
- `pnpm build`, then `pnpm --filter api exec wrangler pages dev ../web/dist`: open `/owner/channels/UC…` directly and
  reload. Both must render. If Pages serves a 404 instead, switch the router to hash mode (decision 8) in
  `main.tsx` only, and record it in `AGENTS.md`.
- Browser walkthrough against `wrangler dev` with the owner email and a user email, in two tabs, following the
  Phase 1 curl walkthrough: the user sees no owner card and is bounced from `/owner`; the owner sees the card only
  when the count is nonzero; the zero-follow digest shows the catalog inline; requesting a handle shows the copy-
  the-id text; requesting an available channel shows the Follow button; approve on a deleted channel is disabled
  with the restore hint; Needs attention lists the pending channel.
- Digest content and unread counts cannot be exercised in a browser until M3 writes summaries. `TODO(owner):`
  either accept that (Phase 1 tests cover the rendering inputs) or approve a dev-only seed skill under `skills/`
  that inserts fixture episodes into the local Registry. The plan assumes the former.

- Confirm the `AGENTS.md` web layout matches the files created (`session.tsx`, `lib/time.ts`, `lib/copy.ts`, the
  screens and components); it was written ahead of time from this plan, so only drift needs fixing.

**Phase 2 exit checklist:** the definition of complete above, `pnpm check` green, the Pages reload test recorded,
the browser walkthrough recorded in the PR.

## Acceptance criteria map (spec §14 → step)

| Criterion | Satisfied by |
|---|---|
| New email → `user`, no owner card, 403 on every owner-only operation | 1.5, 1.6 tests, 2.1, 2.3, 2.5 |
| Owner nav entry; card only when count nonzero | 1.5, 2.1, 2.3 |
| Zero-follow digest embeds the catalog; follow from there | 2.3 |
| Digest window, NEW, receipts for exactly the returned items, exclusions | 1.6 tests, 2.3 |
| Followed rows consistent with NEW; deleted channel unavailable and out of the digest | 1.6 tests, 2.3 |
| Own request outcomes; polling stops | 1.6 (`lib/outcome.ts`), 2.3 |
| 409 for available channel; 400 for handles and missing feeds; title stored | 1.6 tests, 2.3 |
| Owner queue; approve stored title; reject; deleted → refused | 1.3, 1.6 tests, 2.5 |
| Health counts; failed with Retry; every stuck pending listed | 1.3, 1.5 tests, 2.5 |
| Detail: episodes, runs with outcomes, requests | 1.3, 1.5, 2.6 |
| Two users, independent unread and NEW | 1.5, 1.6 tests |
| `pnpm check`; every route under `wrangler dev` | 1.7, 2.8 |
| History-mode reload under `wrangler pages dev` | 2.8 |

## Plan decisions to veto or confirm

1. `GET /channels/:id/episodes` serves both the reader Channel screen and the owner detail; non-followers receive
   episodes without summaries rather than a 403.
2. A new `UPSTREAM_UNAVAILABLE` error code mapped to 502, for when YouTube's feed does not answer.
3. Digest `since` is clamped to 7 days; episodes default 20 and max 200 per channel; no paging anywhere in this slice.
4. Route tests stub YouTube through the test-only `YOUTUBE_FEEDS_FAKE` binding read by `lib/youtube/rss.ts`
   `feedFetcher`, the same env-selected-fake pattern AGENTS.md prescribes for Workers AI and Vectorize. (Revised
   during Step 1.5: `@cloudflare/vitest-pool-workers` 0.22 no longer exports `fetchMock`, and `vi.mock` does not
   reach modules the Worker loads for `SELF` requests.) The RSS parser is tested on an inline fixture.
5. `api.ts` defaults the base URL to `http://127.0.0.1:8787` when `VITE_API_URL` is unset.
6. The three ingestion start points (`POST /channels` created, approve created, retry) are structured log lines until M3.
7. The owner's own read receipts are recorded like any reader's when summaries are returned to them.
8. `POST /channels` on an existing id is 409; reconfiguring a channel after creation stays out of this slice.

## Risks and how the plan handles them

- **Home load time.** PRD asks for under five seconds at 20 follows. Owner aggregates are computed inside the
  Registry in one RPC each; reader routes make at most four DO calls. Chunking keeps every statement under the
  100-parameter cap; the 1,000-id test in 1.3 proves it.
- **Empty data until M3.** Every summary-dependent surface is built and tested against fixtures; in the browser it
  shows empty states. That is the honest picture and is noted in 2.8.
- **History routing on Pages.** Verified in 2.8 with a one-line fallback.
- **YouTube RSS shape.** Public and stable for a decade; the parser tolerates attribute order and entities and is
  fixture-tested. Datacenter behaviour of the transcript endpoint is a separate, recorded `TODO(owner)` and does
  not affect this slice.
- **Field-level authorization.** `management` and `processing` are attached only in `lib/channel-view.ts` and the
  episodes route, behind an explicit `isOwner` check, and tests assert their absence for readers.

## Out of scope, restated

Ingestion Workflow and cron, summaries, Vectorize, chats and preferences, editing a channel after creation, bulk
approve, follower counts, notifications, the transcript fetcher's Cloudflare-IP verification.
