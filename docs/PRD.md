# Product Requirements Document (PRD)

**Product:** Said on Air (multi-user personal media digest assistant; named 2026-09-12, §9)
**Status:** v4 (2026-09-12) — canonical product specification: shared catalog, owner approval, per-user follows and
multiple chats, independent channel discovery and episode recovery
**Precedence:** This document is the canonical product specification. `AGENTS.md` carries the engineering
conventions and working rules for coding agents (repo layout, toolchain, hard rules, testing, code style, git); where
it restates product behaviour it summarises this document and defers to it. The specs in `docs/specs/` record the
design reasoning, wireframes, acceptance criteria, and implementation plans behind these requirements:
`home-read-experience` for the Home and Owner screens (decided 2026-09-07), `channel-simplification` for channel
statuses, follows, and episode states (decided 2026-09-10), `m3-ingestion` for discovery, recovery, and transcripts
(revised 2026-09-12), `api-reference` for the generated API document (decided 2026-09-07, contract restated and approved 2026-09-12), and
`follows-single-owner` for follows living only in the Registry (decided 2026-09-13), and `design-phase` for the
visual system and the screens this phase rebuilds (written 2026-09-14). `docs/design.md` is the standing design
guide — principles, tokens, patterns, the scale playbook and the accessibility floor — and governs how a screen looks
and behaves the way this document governs what it does. Where a spec and this
document disagree, this document governs and the spec is due for revision.
**Implementation status:** This document defines the target requirements and logical schema, not completed
features. Items marked M4 are not yet built (§10); M3 shipped 2026-09-13. The Design phase between M3 and M4 (§10)
has its architecture approved and nothing built, so the screens described in §7 are the ones built during M2 and M3,
not the designed ones; three approved changes already contradict them and are marked where they apply (§9).

## 1. Summary

Said on Air is a personal, long-lived tool for a small, trusted set of users. One global YouTube channel catalog is
shared by everyone: anyone puts a channel in it by pasting the channel id, which also follows it, and the owner
approves or declines. The system ingests, vectorizes, and summarizes each episode once, sharing that content across
followers. Users receive personalized digests through their follows and can maintain multiple independent
conversations across all channels they currently follow.

The application runs entirely on Cloudflare with a designed web UI (decided 2026-09-14, §9). Maintainability and
privacy of user activity matter more than speed of delivery. Channel discovery and episode recovery each run on a
six-hour schedule (decided 2026-09-12). This is a long-lived personal tool, not a demo: maintainable beats clever.

### Goals

- Configure each channel once; retain one canonical transcript chunk/vector set and summary per episode.
- Let users discover catalog channels and add missing ones themselves, subject to owner approval.
- Present recent content from followed channels, with read/unread state private to each user.
- Answer questions using currently followed channels with video/timestamp citations.
- Preserve conversations through follow changes and through a channel being declined and approved again.
- Load Home in under five seconds for a user following 20 channels.

### Non-goals

Authentication, per-channel chat, non-YouTube sources, transcript generation for captionless videos, resolution of
`@handle` or `/c/…` channel URLs, notifications, email delivery, mobile apps, rate limiting, multi-region
deployment, and general admin dashboards beyond owner catalog management.

### External services and privacy constraints

- The only external services called are YouTube's public RSS feed, Cloudflare services, and DownSub's API for
  transcripts (owner decision 2026-09-08). DownSub receives nothing but a public YouTube video URL and is
  authenticated with the `DOWNSUB_API_KEY` secret. No other YouTube endpoint is used: no InnerTube calls, no
  watch-page scraping, no YouTube Data API or API keys. The feed endpoint
  `https://www.youtube.com/feeds/videos.xml` is read with either `channel_id=` (channel verification, §4.1) or
  `playlist_id=` (discovery, §4.2); both are the same public, unauthenticated endpoint, and neither is a new service.
  No other AI providers, scraping services, analytics SDKs, or proxies.
- Transcript text and chat content are never logged. Private user data (chats, preferences, read receipts) never
  leaves the user's own Durable Object except in that user's own responses.
- Shared episode vectors live in one Vectorize namespace, `shared-catalog`, never in a per-user namespace. Every
  vector operation carries an explicit namespace scope, and chat retrieval always filters to the caller's eligible
  channels and never falls back to an unfiltered query.

## 2. Users and ownership

- Identity is normalized email (trimmed, lowercase), supplied through `X-User-Email`. No authentication is added, and
  none should be: no login, sessions, JWTs, or Cloudflare Access. The UI says "Who is this for?", never "sign in".
  Unknown emails auto-register in the Registry DO.
- Browser clients on another origin (the Pages web app, Vite locally) are admitted by CORS from the `WEB_ORIGINS`
  configuration: comma-separated origins, with `scheme://*.host` matching any subdomain for Pages previews; unset
  means the local Vite origins. No credentials are involved, so this is hygiene, not a guard, and preflights never
  reach the identity layer.
- A user has zero or more follows and chats. Registration creates an identity, not an ingestion subscription: cron
  iterates shared catalog channels, not users, and registration triggers nothing.
- The web offers approve, decline, pause, resume, episode retry, and skip to the owner only; the API accepts every
  operation from any identity (decided 2026-09-12, §9). Anyone can add a channel to the catalog, request a declined
  one again, follow any requested or approved channel, and unfollow their own follows.
- The owner is the identity with `role = 'owner'` in the Registry's `global_users`, seeded from the `OWNER_EMAIL`
  secret each time the Registry DO starts. Seeding promotes and never demotes, so more owners can be granted later.
  The API enforces no authorization (decided 2026-09-12, §9): no route or Registry method checks the role, `GET /me`
  returns it for the web's rendering, and the acting email is recorded as reviewer, skipper, or requester whoever it
  is. The owner email is never committed. The management interface is the Owner screens in §7, which the web shows
  to the owner role only. This does not introduce authentication.
- Chats, preferences, and read receipts are private to the User DO. Global identity, the catalog, and every follow
  live in the Registry: one follower record per channel and email is the only record of who follows what (decided
  2026-09-13, replacing the two-store model of 2026-09-10), so the Registry can list a user's own follows, count a
  channel's followers, list who is waiting on a requested one, and compute eligibility in one place. Every channel in
  the catalog is visible to everyone. Another user's private DO data is never exposed.

## 3. Architecture

```text
Cloudflare Pages: Vite + Preact + TypeScript
    Account → Home (owner attention card · digest · followed and catalog channels · add a channel · chats in M4)
                 → Channel details
                 → Owner (approval queue · needs attention · catalog health) → Owner channel detail
                         |
              Hono Worker + X-User-Email
                         |
       +-----------------+------------------+
       |                                    |
Global Registry DO                    User DO per email
catalog, follows, episodes,            read receipts,
shared summaries, discovery runs,      chats/messages/sources, preferences
episode processing attempts
       |
First approval, Start, or channel cron → long-form RSS discovery run → new episodes
New episode, recovery cron, or Owner Retry → episode attempt → one Workflow
       stagger → transcript → classify → chunk → Workers AI embed → Vectorize (staged generation)
                              → verify → shared summary → publish: episode available in the Registry

Vectorize: media-rag, namespace shared-catalog
Chat query: current follows ∩ approved channels
           → channelId metadata filter → validate available episodes and active generation → Workers AI answer
```

### Stack

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo; `apps/api`, `apps/web`, `packages/shared` |
| Toolchain | Volta-pinned Node 22; `packageManager`-pinned pnpm |
| Runtime | Cloudflare Workers on the Workers Paid plan (decided 2026-09-11); `compatibility_date` pinned; `nodejs_compat`; three environments, dev, staging, production, each its own Worker with its own Durable Objects, index, and Workflow (decided 2026-09-13; `AGENTS.md` → Environments) |
| API | Hono, strict TypeScript, ESM only |
| Validation and API document | Zod 4 schemas in `packages/shared` with the types inferred from them; `hono-openapi` generates OpenAPI 3.1 at `GET /openapi.json`; Scalar test client at `GET /docs` |
| State | One SQLite Registry DO; one SQLite User DO per normalized email |
| Orchestration | Cloudflare Workflows, one instance per episode attempt; two Cron Triggers in the same Worker: discovery `0 */6 * * *` and recovery `30 */6 * * *` (UTC) |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Embeddings | Workers AI `@cf/baai/bge-base-en-v1.5`, 768 dimensions, 512-token input cap (the deployed model id carries `.5`, corrected 2026-09-08) |
| Vectors | Vectorize, cosine, explicit `shared-catalog` namespace, `channelId` and `videoId` metadata indexes; one index per environment: `media-rag` (production), `media-rag-staging`, `media-rag-dev` (decided 2026-09-13) |
| Transcripts | DownSub's API behind one transcript seam (`DOWNSUB_API_KEY` secret); a canned fake in tests |
| UI | Cloudflare Pages, Vite + Preact + TypeScript, `preact-iso` history routing; daisyUI 5 components over Tailwind CSS 4 with one custom theme, in the single `styles.css`; no state library (decided 2026-09-14, §9) |
| Tests | Vitest + `@cloudflare/vitest-pool-workers`; env-selected fakes for Workers AI, Vectorize, transcripts, Workflows, and YouTube feeds |
| Formatting | Biome |

Each DO owns its SQLite database. Local relationships use foreign keys and transactions; cross-DO references are
validated through DO methods. There are no cross-DO SQL joins or atomic transactions, and shared episodes and
summaries are never copied into a User DO. See
[Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## 4. Functional requirements

### 4.1 Catalog, approval, and declining

- Users supply the channel id, a bare `UC…` id or any URL containing `/channel/UC…`, copied from the channel's About
  dialog (Share channel, then Copy channel ID). `@handle` and `/c/…` URLs are rejected as `INVALID_INPUT` with those
  instructions; there is no handle resolution (decided 2026-09-07) and the YouTube Data API is not used. The id is
  validated offline, then verified by fetching its RSS feed, `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`:
  a 404 means no such channel (`INVALID_INPUT`); success supplies the channel title, which any caller may override at
  add and the owner at approval; the UI offers the override to the owner only (the API is promiscuous, §9).
  Verification always reads `channel_id=`, the only feed that tells an unknown channel apart from one with no
  long-form uploads; discovery reads a different feed of the same endpoint (§4.2 rule 1). Nothing else in the system
  talks to YouTube.
- Channel status is `requested`, `approved`, or `declined` (decided 2026-09-10). It records the owner's answer about
  catalog membership and nothing about imports; import outcomes are episode state (§4.2). Channels are never deleted,
  softly or otherwise, and there is no channel failure code, channel waiting code, channel retry, or restore. A
  channel whose every episode is skipped is simply an approved channel with no available episodes.
- Anyone adds a channel, which creates it `requested` and follows them, whoever they are; approval is always the
  separate approve call (the owner's add shortcut was removed on 2026-09-12, §9; the web keeps the owner's one-step
  experience by following the add with an approve). Channel creation is create-only, so an id already in the catalog is not an error: a `requested` or `approved`
  channel is simply followed, and a `declined` one is refused with `INVALID_STATE` carrying the channel id, status, the
  owner's note, and the review date so the interface can offer **Request again**.
- Requesting a declined channel again returns it to `requested`, keeps the review fields so the queue can show it was
  declined before, and follows the caller. It is the only way out of `declined` for a user and it is explicit: the
  user sees the note and date first and confirms once.
- Owner approval sets `approved`, the review fields, and the first-approval timestamp when it was null. Initial
  ingestion starts only at that first approval, whether or not anyone follows yet; approving a channel that had been
  approved before starts nothing, leaves the first-approval timestamp alone, and the channel waits for the next
  scheduled discovery. Approval recomputes the pause flag from the follower count.
- Owner decline sets `declined` and the review fields and clears the pause. It stops future RSS discovery for the
  channel but does not stop recovery of episodes discovered before the decline (§4.2). Episodes, summaries, vectors,
  follows, and read receipts are all kept; the API still returns the episodes to every caller, the Owner screens keep
  showing them, and the reader screens hide them (§7). Copy
  reads "Declined" when the channel was never approved and "Withdrawn" when it was. Declining an approved channel
  confirms once in the UI, naming its follower count.
- Requested and approved channels appear in everyone's catalog and can be followed; declined channels drop out of the
  catalog list, and their followers keep the row with the owner's note. There are no private requests: the owner queue
  is simply the requested channels, with their followers.

### 4.2 Episode lifecycle and ingestion

Channel discovery and episode processing are separate systems (owner decision 2026-09-12). Discovery reads a
channel's RSS feed and creates episode rows. Processing turns one episode into vectors and a summary through one
Workflow instance per attempt. Following a channel never launches per-user ingestion or duplicates vectors or
summaries. "Once" means one active canonical copy of each episode's vectors and summary, not a promise of
exactly-once execution against external APIs.

The state machine lives on episodes: `pending`, `available`, `failed`, `skipped`. A channel's status never records an
import outcome.

#### Discovery runs

1. The first approval, the owner's Start (`POST /channels/:id/runs`), or the channel cron
   performs one RSS discovery run for one channel and records it as completed feed history with its feed result. A
   run never fetches transcripts, checks the transcript provider, or waits for episode outcomes. Discovery reads
   YouTube's auto-generated **long-form uploads playlist**, `…/feeds/videos.xml?playlist_id=UULF<channel id without
   the UC prefix>` (decided 2026-09-14), so **Shorts and live streams are never discovered and never become
   episodes**. The three auto-playlists — `UULF` long-form, `UUSH` Shorts, `UULV` live — partition a channel's
   uploads exactly, and a stream stays in `UULV` permanently after it ends, so live content is dropped from the
   catalog by design and not merely deferred. Shorts also stop consuming the feed's fifteen-entry cap, which is what
   made an `initial` run import mostly Shorts on a Shorts-heavy channel. A feed that cannot be read is recorded
   `unavailable` like any other; there is no fallback to the channel feed.
2. A channel's run kind is `initial` until one of its runs has created an episode, and `scheduled` afterwards. An
   `initial` run creates at most the newest `initial_import_count` feed entries, whatever their dates; the default is
   five and the count is a positive value any caller may set at add and the owner at approval (the UI offers it to the
   owner only, §9). A `scheduled` run creates only
   untracked entries published after the channel's first approval. Discovery never selects an existing episode.
3. Each created episode stores the immutable `discovered_by_run_id` of the run that created it, so a run reports
   `N episodes discovered`, `nothing new`, or `feed unavailable`. There is no run-episode table.
4. The channel cron selects approved channels that are not paused. The initial import ignores pause: first approval
   discovers even when the new channel is already system-paused because nobody follows it. Later cron discovery
   honours pause. A successful feed read moves `last_checked_at`; an unavailable feed does not. DownSub status never
   blocks feed discovery. An approved channel with no run at all still needs the owner's attention.

#### Episode creation and attempts

5. A created episode starts `pending` with intent `publish`, a processing window from its creation time
   through 48 hours later, and `next_attempt_at` equal to its creation time. Every created episode starts processing
   immediately after the discovery write commits, through the same episode starter the crons and the owner use.
6. Every execution — first processing, scheduled recovery, or owner Retry — is one `episode_ingestion_attempts` row
   with trigger `channel_ingestion`, `scheduled_recovery`, or `owner_retry`, and one Workflow instance for that
   episode. Instances never fetch RSS or write channel or run records; they validate their own open ledger row rather
   than any channel-run state. An attempt's status is `running`, `available`, `failed`, `skipped`, `waiting`, or
   `blocked`.
7. Per instance: stagger, fetch the transcript, classify, chunk, embed into a staged vector generation,
   verify, summarize, publish. Each external call (transcript, AI, Vectorize) is its own retryable Workflow step.
   Every final result updates the attempt and the episode's open window.
8. Each batch of attempts a start point launches — a discovery's new episodes, or one recovery tick across every
   channel — is numbered, and the k-th instance sleeps k × 3 seconds before its first external call (decided
   2026-09-11, restored 2026-09-12). An owner Retry is a batch of one with no delay. A Workflow create failure
   finishes that attempt `failed WORKFLOW_LOST`, leaves the window open, and schedules the next attempt six
   hours later.

#### Pre-flight against the transcript provider

9. Every starter checks DownSub status once per batch. A rejected key or zero credits blocks the start, and every
   blocked start, automatic or owner, records one finished `blocked` attempt with no Workflow and the provider reason
   as its outcome code: `PROVIDER_AUTH` for a rejected key, `PROVIDER_LIMIT` for exhausted credits (decided
   2026-09-12, replacing the earlier rule that automatic blocks wrote nothing; the rows are bounded by the 48-hour
   window, and the deadline needs a latest attempt to copy from). Before the deadline a blocked automatic start
   leaves the episode due six hours later; at or after the deadline the block closes the window as a timeout
   (rule 14). A blocked owner Retry returns its attempt and leaves the episode and any existing processing window
   unchanged. An unreachable status endpoint does not block. Blocked attempts never launch, so they never increment
   `attempt_count` (rule 13).

#### Waiting and skipping

10. Content state and the processing window are separate. an `intent`, `publish` or `replace`, carries a start,
    48-hour deadline, next-attempt time, and staged vector generation. A `publish` window belongs to a `pending`
    episode; a `replace` window belongs to an `available` one whose current summary and vectors stay readable
    throughout. Both use the same scheduler.
11. Reasons live on attempts only (decided 2026-09-12). An attempt may finish `waiting` for one of two reasons
    (three until 2026-09-14, when `LIVE_OR_UPCOMING` was retired with the move to the long-form feed, rule 1).
    The API derives a pending episode's `waitReason` from its latest attempt for every caller (a `waiting`
    attempt's code; a `blocked PROVIDER_LIMIT` attempt reads `PROVIDER_LIMIT`; anything else is null) and gives
    the owner the whole attempt; the episode row carries no reason during recovery:

| Waiting code | Meaning |
|---|---|
| `CAPTIONS` | The latest attempt found no captions, or a caption track with no usable cues |
| `PROVIDER_LIMIT` | The latest attempt found transcript credits exhausted |

12. Deterministic content classifications end the attempt at once and never reach the owner's queue. Under
    intent `publish` they skip the episode, reversibly. Under intent `replace` they finish the attempt
    `skipped` with the reason, close the window, and leave the episode `available` with its current summary and
    vectors (rule 16), because only a successful replacement may change readable content:

| Skip reason | Meaning |
|---|---|
| `SHORT` | Under 180 seconds; nothing is stored |
| `NON_ENGLISH` | Captions exist but none is an English track (decided 2026-09-08) |
| `UNPLAYABLE` | The provider reports the video cannot be played, reports it live or upcoming, or errors with no reason on a body that still describes a video. All four end the attempt at once (decided 2026-09-14, replacing the live wait); `failure_detail` distinguishes them |
| `OWNER` | The owner skipped a failed episode by hand |

There is no `waiting` count on channels or the catalog (decided 2026-09-12): episode counts are `available`,
`pending`, `failed`, and `skipped`, and the reason a pending episode is not summarised yet appears only on that
episode's row, phrased from its latest attempt.

#### The one 48-hour rule

13. Every unsuccessful, non-skipped result keeps the window open and schedules the next episode attempt six hours
    later: caption and live waits, provider limit, provider authentication, HTTP, rate-limit and parse failures,
    oversized transcripts, embedding, Vectorize, summary, and lost-Workflow outcomes all follow the same rule.
    `attempt_count` counts attempts that actually launched a Workflow since the processing window last started, so a
    `blocked` attempt leaves it unchanged; it remains diagnostic history and never makes an episode terminal. There
    is no three-attempt rule.
14. At or after the deadline, the recovery cron starts one final due attempt when pre-flight permits, rather than
    failing on elapsed time alone; when pre-flight blocks, it records the blocked attempt (rule 9), so a latest
    attempt always exists and names the real cause. If that block happens, or the final attempt does not succeed, an
    unfinished
    publication becomes `failed INGESTION_TIMEOUT` with the latest attempt's reason preserved as `failure_detail`;
    an unfinished replacement closes its window, records the timeout on its attempt, and leaves the episode
    `available` with its previous summary. Only failed publications enter Needs attention.
15. Reconciliation runs before recovery selection: running attempts older than one hour are checked against the
    Workflow engine, and gone or missing instances are closed `failed WORKFLOW_LOST`, leaving the episode due within
    its existing processing window. Discovery runs need no reconciliation, because a run exists only once complete.

#### Owner Retry and Skip

16. Owner Retry is channel-independent episode work. It accepts any episode state in an approved, paused, requested,
    or declined channel, requiring only that the episode belongs to the named channel. A `pending`, `failed`, or
    `skipped` episode returns to `pending` with intent `publish`; an `available` episode opens a `replace` window, leaving the current
    summary, active vector generation, `processed_at`, and read receipts untouched until a replacement succeeds. A
    deterministic classification during replacement, such as a video that has since become unplayable or lost its
    English track, finishes the attempt `skipped` with that reason and closes the window but never changes the
    episode's status or content (decided 2026-09-12). When pre-flight permits work, Retry resets the 48-hour window
    and starts immediately without fetching RSS or writing a channel or run row. The promise is a retry, not a
    better summary.
17. Retry is refused with `INVALID_STATE` only while the episode has a running attempt. On a running attempt older
    than an hour, the route asks the Workflow engine first and reconciles a gone or missing instance `WORKFLOW_LOST`
    inline, then proceeds, so a dead instance never holds Retry until the next tick (decided 2026-09-12). An active
    instance keeps the refusal.
18. Owner Skip is `failed → skipped OWNER` in any channel status. Neither action reads RSS, creates a channel run,
    writes a channel field, or inspects channel-run state.

#### Transcript source

19. Transcripts come from DownSub's API (decided 2026-09-08). The InnerTube approach of 2026-09-07 was built,
    measured, and dropped: it passes from a residential IP but is bot-checked from Cloudflare's egress in every client
    tested (30 player calls: 21 `LOGIN_REQUIRED`, 4 hard 403s, 5 OKs on one video), and no unsigned caption endpoint
    exists any more. It must not be reintroduced. The source sits behind one seam so it can change without ingestion
    noticing.
20. A transcript result reports the segments, the video duration, and a caption status of `english`, `none`, or
    `non_english`. Segments are present only for English, and `english` always
    carries at least one segment: a chosen track whose file has no usable cues is reported as `none` (decided
    2026-09-11), so the 48-hour rule applies and nothing downstream meets an empty transcript. Duration drives the
    classification in rules 11 and 12; liveness no longer does, because a live or upcoming video is reported as the
    `UNPLAYABLE` failure of rule 22 rather than as a result (decided 2026-09-14, rule 1).
21. Track choice (decided 2026-09-10): a manual `en` or `en-*` track, else an `en_auto` or `en-*_auto` track; if
    captions exist but neither qualifies, the result is `non_english` without downloading a non-English track, and the
    episode is `skipped NON_ENGLISH`. Track labels are unreliable and never matched; codes are. Machine translations
    are discarded. There is no translation fallback; non-English channels are out of scope.
22. Provider failures are distinct diagnostics on the attempt: `UNPLAYABLE` (skip, rule 12), `PROVIDER_AUTH`
    (HTTP 401), `PROVIDER_LIMIT` (HTTP 403, a wait), `PROVIDER_RATE_LIMIT` (HTTP 429), `PROVIDER_HTTP` (other non-2xx),
    `PROVIDER_PARSE` (unparsable body or caption file). The adapter never retries; the Workflow step does, with a
    generous timeout, because the provider's error states are slow. A playable video with no captions remains
    recoverable until timeout.
23. Provider economics: one credit per video with or without captions, none for errors, status checks, or the caption
    file download; 2,000 credits a month. The provider's status endpoint returns the remaining credits, which the
    catalog health strip shows in M3. Verified 2026-09-08 with a trial key: uploads one to two hours old are served,
    and a video's captions parsed to exactly the segments YouTube's own caption data yields.

#### Publication and vector generations

24. Vector IDs include a generation. Attempts write only the episode's staged generation, recording the staged chunk
    count when embedding begins. After the last upsert, the verify step reads the ids back in batches and retries
    until every expected id is present, absorbing Vectorize's asynchronous processing; only after those retries does a
    missing id count as `VECTORIZE_INCOMPLETE`. Availability is never based on an accepted upsert alone.
25. On success, one Registry publication writes the summary, switches `active_vector_generation` to the staged
    generation, closes the window, sets `processed_at` only when it was null, and returns the previous
    generation with its chunk count. `processed_at` is first availability and is never reset.
26. One generation rule: the attempt deletes the previous generation right after activation, and an attempt that
    follows a failed one deletes the abandoned staged generation, whose chunk count the failed attempt recorded,
    before writing its own. The index therefore holds one active generation per episode plus whatever one attempt is
    staging. Retrieval verifies each vector's generation, parsed from its id, against the episode's active one and
    fetches more to fill any gap, so a failed available replacement cannot damage current retrieval and a retry never
    leaves duplicate passages behind. A failed cleanup is logged and leaves publication standing.

#### Derived facts and channel state

27. `last_checked_at` remains a stored channel fact because it describes a feed read. The API derives channel
    `lastIngestedAt` from that channel's newest episode `processed_at`, and catalog `lastSuccessfulIngestionAt` from
    the global maximum. There is no stored channel ingestion timestamp, so episode Retry never needs a channel write.
28. Declining or pausing a channel stops future discovery but never active episode recovery. Eligibility keeps any
    completed result out of digest and chat until re-approval; the channel's episodes route still returns it to every
    caller, and the reader screens hide it while the Owner screens show it (§7).

### 4.3 Follows, followers, and pause

- Explicit follow/refollow is allowed for any `requested` or `approved` channel; following a `declined` one is refused
  with the owner's note, and the interface offers Request again instead. Unfollow works on a channel in any status.
- Follow membership is recorded once, in the Registry's follower record per channel and email (decided 2026-09-13).
  The same row serves the user's own list, the follower count, the owner's queue, the automatic pause, and
  eligibility, so there is nothing to keep in step and no failure can leave a follow half-recorded. A follow or
  unfollow is one Registry write; adding a channel and requesting one again perform that same write. The User DO
  holds no follow rows.
- Unfollow retains a tombstone using `unfollowed_at`, which an explicit refollow clears. It neither deletes global
  content nor changes other users.
- There is no automatic following. Adding a channel or requesting one again follows the caller in the same call, so
  requesters are followers from the start and nothing is handed off between the Durable Objects.
- Pause is a flag on approved channels, `paused_by` with `paused_at`, either `owner` or `system`. When the last active
  follower of an approved channel leaves, the system pauses it in the same Registry operation that records the
  unfollow, unless the owner has paused it; the next follow lifts a system pause and never an owner one. An owner
  pause is lifted only by owner resume, which clears either kind. Declining clears the flag and approving recomputes
  it, so a channel nobody follows is paused as soon as it is approved while its one initial import still runs. A
  requested or declined channel is never paused.
- Pause stops future RSS discovery selection only. Existing episode recovery continues, and the channel's existing
  summaries stay readable and searchable in digest, channel history, and chat: a paused channel is still eligible.
- Eligibility, used by digest, follows, episodes, and chat, is the user's active follows intersected with `approved`
  channels. Requested channels have no content yet; a declined channel is excluded by status, and its followers keep
  the row; the reader screens show them episode titles with no summaries, though the API returns the summaries (§7).
- Declining removes a channel from digest and future retrieval while preserving episodes, summaries, vectors, follows,
  read receipts, and historical citations. Approving it again restores access for its remaining active followers;
  explicitly unfollowed users stay unfollowed, and no new initial import runs.

### 4.4 Shared summaries, digests, and unread state

- Store one summary per episode: an executive summary the prompt asks to keep to three sentences, takeaways each with
  the timestamp of the moment it comes from, and topic tags. **How many takeaways is a function of the episode's
  runtime**, about one per eight minutes between 5 and 20: one number cannot serve a nine-minute clip and a
  two-and-a-half-hour interview. A long episode is read in sections of at most twenty minutes, one model call each,
  and **which takeaways survive is decided in code, not by the model** — a quota spread across every section, because
  a model asked to choose across sections fills the list from the earliest and stops (measured 2026-09-14). A second
  call then writes the three sentences and consolidates the tags over the takeaways already chosen.
- The model is asked for JSON in JSON mode — a `response_format` whose schema mirrors the validator's bounds — with
  `[h:mm:ss]` markers in the prompt; a takeaway's timestamp is taken from those markers and is null when absent or out
  of range. The platform does not guarantee the schema is met, so validate the JSON shape by hand anyway, though not
  the sentence count (owner decision 2026-09-13: a structured summary that runs long serves the reader better than the
  raw text a rejection would leave). Retry invalid output once. A failed second call costs the episode its three
  sentences and nothing else, since the takeaways never depended on it; raw text with a `raw_fallback` flag is kept
  only when no section produced a valid answer at all.
- Summaries publish automatically after that validation, retry, and raw fallback. There is no manual approval and no
  summary-quality review gate (owner decision 2026-09-10). Prompts are versioned; changing one is a product decision.
- User preferences affect chat answers only, not shared summaries.
- Cross-references are optional enrichment: shared related-video IDs computed in the shared namespace, excluding the
  current video, deduplicated to at most five available related videos. A lookup failure or no qualifying result
  stores an empty list and never blocks publication. Display only related titles belonging to the reader's eligible
  channels; the UI omits an empty section.
- Digest ordering and grouping use the summary's first availability time, `episodes.processed_at` exposed as
  `summaryAvailableAt`, not the video's publication time (owner decision 2026-09-10; carried by the digest route since
  M3.5, 2026-09-13). The reader has two views over one list. **Unread is the queue**: only summaries with no receipt,
  grouped by the **day** they became available, newest day first, within eligible followed channels — a summary marked
  done leaves it. **History is the library**: every summary the reader has been eligible for, over the same days,
  navigated by a calendar, and the one place a receipt can be undone. Neither has a time window and **every day is
  kept** (decided 2026-09-14, §9; the built route still defaults to 24 hours and clamps at seven days). One receipt
  serves both views; no second piece of per-user state exists or is needed. Day boundaries are the reader's local ones, so
  the route takes a range and never a timezone, and a day's address carries its year: `/history/2026-09-12`. Reads,
  refollows, re-approval, enrichment and replacement summaries never reset availability, so **a summary's day is
  permanent** — its membership of that day is a fact about the summary and never moves. **A day's contents are not**:
  History renders the reader's current eligible follows, so following or unfollowing a channel changes which rows a
  past day shows, and receipts change how they read. Publication time stays separate metadata and is shown beside the
  day the summary arrived; channel history stays publication-ordered.
- Channel pages show recent episodes to followers, with a summary on the available ones and a phrase on the rest.
- **Unread means not dealt with, not unseen.** A read receipt is recorded only when an eligible caller — an active
  follower of an approved channel — explicitly marks a summary done, from its own screen or from its queue row. No
  read records one: not returning it in a list, not opening it, not arriving by deep link, not paging back through
  history. Every read route is a pure read, and one explicit write records the receipt. Absence of a receipt means
  unread. **Changed 2026-09-14 (§9); the built digest route still marks on return, and the Design phase changes it.**
- Existing summaries start unread on first follow. Preserve read receipts through unfollow, refollow, decline, and
  re-approval. Unread counts span all currently eligible summaries, while NEW markers apply only to the items a
  response returned; no shared summary row contains `read_at`.

### 4.5 Chats and retrieval

- A user can have zero or more independent chats. Each chat has an optional title and its own ordered messages.
  Retain all chats/messages; no chat deletion or archive functionality is required now, and there are no per-channel
  chats.
- Every message searches all channels the user currently follows that are approved, paused or not. There is no
  fixed channel selection at chat creation and no chat-to-channel membership table.
- Following a new channel expands retrieval for existing chats; unfollow or a decline excludes future retrieval, and
  re-approval restores it. Previous messages/citations remain visible and may still be used as conversation context.
  Do not scrub history.
- Chat creation, message submission, and history are never disabled for lack of follows. When no eligible channels
  exist, store the assistant response "Chat requires following at least one approved channel." with no sources;
  do not call AI or Vectorize for that response.
- Otherwise embed the question, retrieve the best three eligible chunks (§6), combine their exact text with the user's
  preferences and this chat's recent history, and ask Workers AI to answer with video/timestamp citations.
- Store citation snapshots (video/channel IDs, titles, start time) with each reply. Link to
  `https://youtu.be/<videoId>?t=<startSec>`; later catalog changes must not erase historical sources.

## 5. Logical database schema

This is the target schema for SQLite-backed DO migrations. It does not authorize destructive changes to existing data.
Every table includes `created_at INTEGER NOT NULL` (Unix milliseconds), including each DO's `_migrations` table.
IDs and emails are `TEXT`; all fields are required unless marked `?`. Timestamps, counters, sequence/position values,
limits, and versions are `INTEGER`, except `start_sec`, which is `REAL` to preserve fractional transcript timing.
Other fields are `TEXT`; `_json` columns contain validated JSON text. `PK` and `FK` mean primary and foreign key.
Tables and columns are `snake_case`.

### 5.1 Global Registry DO

| Table | Columns in addition to `created_at` | Keys and relationships |
|---|---|---|
| `global_users` | `email`, `role DEFAULT 'user'`, `last_seen_at` | PK `email`, normalized |
| `channels` | `channel_id`, `title`, `canonical_url`, `status`, `initial_import_count DEFAULT 5`, `approved_at?`, `reviewed_at?`, `reviewed_by_email?`, `review_note?`, `paused_by?`, `paused_at?`, `last_checked_at?`, `updated_at` | PK `channel_id` (YouTube `UC…` ID); FK `reviewed_by_email → global_users.email`; API `lastIngestedAt` is derived from episodes; there is no `last_ingested_at` column |
| `channel_followers` | `channel_id`, `user_email`, `followed_at`, `unfollowed_at?`, `updated_at` | Composite PK `(channel_id, user_email)`; FKs to `channels.channel_id` and `global_users.email`; an active follow is `unfollowed_at IS NULL` |
| `episodes` | `video_id`, `channel_id`, `discovered_by_run_id`, `title`, `published_at`, `status`, `intent?`, `window_started_at?`, `window_deadline_at?`, `next_attempt_at?`, `attempt_count DEFAULT 0`, `failure_code?`, `failure_detail?`, `skip_reason?`, `skipped_at?`, `skipped_by_email?`, `transcript_checked_at?`, `chunk_count?`, `vectorized_at?`, `processed_at?`, `active_vector_generation?`, `staged_vector_generation?`, `updated_at` | PK `video_id`; FKs to channel, discovery run, and skipping owner |
| `episode_summaries` | `video_id`, `format`, `executive_summary?`, `takeaways_json?`, `topic_tags_json?`, `raw_text?`, `related_video_ids_json`, `model`, `prompt_version` | PK/FK `video_id → episodes.video_id`; `prompt_version` is a TEXT identifier |
| `ingestion_runs` | `run_id`, `channel_id`, `kind`, `feed_status`, `discovered_count DEFAULT 0`, `episode_limit?`, `started_at`, `finished_at` | PK `run_id`; FK `channel_id → channels.channel_id`; a completed feed-discovery record, so no status or Workflow columns |
| `episode_ingestion_attempts` | `attempt_id`, `video_id`, `trigger`, `intent`, `generation_id?`, `staged_chunk_count?`, `workflow_id?`, `requested_by_email?`, `status`, `outcome_code?`, `failure_detail?`, `started_at`, `finished_at?` | PK `attempt_id`; unique nullable `workflow_id`; FKs to episode and optional owner; all episode executions |

`channel_followers` is the only record of follows: a user's own list is `WHERE user_email = ? AND unfollowed_at IS
NULL`, eligibility joins it to approved channels, and the same rows count followers, list who is waiting on a
requested channel, and pause a channel nobody follows.
`approved_at` is set at the first approval and never reset; the review fields hold the latest review only and are kept
when a declined channel is requested again. An episode's `discovered_by_run_id` is immutable and supplies the exact
membership of a discovery run. Processing history is entirely in `episode_ingestion_attempts`; `staged_chunk_count`
is set when embedding starts so the next attempt can delete an abandoned generation.
`related_video_ids_json` is an array of shared episode IDs, validated in the Registry and filtered at read time.

### 5.2 Per-user DO

| Table | Columns in addition to `created_at` | Keys and relationships |
|---|---|---|
| `summary_reads` | `video_id`, `read_at` | PK `video_id`; no row means unread |
| `chats` | `chat_id`, `title?`, `updated_at` | PK `chat_id` |
| `chat_messages` | `message_id`, `chat_id`, `sequence_number`, `role`, `content`, `status`, `failure_code?`, `reply_to_message_id?`, `channel_id?`, `updated_at` | PK `message_id`; FK `chat_id → chats.chat_id`; self-FK for reply; unique `(chat_id, sequence_number)` |
| `chat_message_sources` | `source_id`, `message_id`, `position`, `video_id`, `channel_id`, `video_title`, `channel_title`, `start_sec` | PK `source_id`; FK to message; unique `(message_id, position)` |
| `user_preferences` | `id`, `system_rules`, `updated_at` | Singleton PK constrained to `id = 'default'` |

Email is implicit in the owning User DO, not repeated in each row. The User DO holds no follows: those are Registry
rows (§5.1, decided 2026-09-13). Shared channel and video IDs are cross-DO references validated through Registry
methods, not SQLite foreign keys. A reply must belong to the same chat as its
referenced message. The nullable `chat_messages.channel_id` is retained for a possible future scoped view and stays
null for current global chats; it does not define retrieval scope. Sources capture the actual per-reply channel IDs.
Message content may be empty while an assistant reply is pending. Update chat ordering when messages are added.

### 5.3 Constraints and indexes

Use `CHECK` constraints for these enums:

| Column | Values |
|---|---|
| `global_users.role` | `owner`, `user` |
| `channels.status` | `requested`, `approved`, `declined` |
| `channels.paused_by` | `owner`, `system` |
| `episodes.status` | `pending`, `available`, `failed`, `skipped` |
| `episodes.intent` | `publication`, `replacement` |
| `episodes.failure_code` | `INGESTION_TIMEOUT` |
| `episodes.skip_reason` | `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`, `OWNER` |
| `episode_summaries.format` | `structured`, `raw_fallback` |
| `ingestion_runs.kind` | `initial`, `scheduled` |
| `ingestion_runs.feed_status` | `read`, `unavailable` |
| `episode_ingestion_attempts.trigger` | `channel_ingestion`, `scheduled_recovery`, `owner_retry` |
| `episode_ingestion_attempts.intent` | `publication`, `replacement` |
| `episode_ingestion_attempts.status` | `running`, `available`, `failed`, `skipped`, `waiting`, `blocked` |
| `episode_ingestion_attempts.outcome_code` | null, or one of the fourteen `AttemptOutcomeCode` values below (since 2026-09-13, M3.7; `LIVE_OR_UPCOMING` retired 2026-09-14) |
| `chat_messages.role` | `user`, `assistant` |
| `chat_messages.status` | `pending`, `completed`, `failed` |

`episode_ingestion_attempts.outcome_code` carries the attempt's reason, a closed set since 2026-09-12: a `waiting`
attempt has `CAPTIONS` or `PROVIDER_LIMIT`; a `skipped` attempt has `SHORT`, `NON_ENGLISH`, or `UNPLAYABLE` (Owner
Skip is an episode write, not an attempt, §4.2 rule 6); a `failed` attempt has a technical
code — `PROVIDER_AUTH`, `PROVIDER_RATE_LIMIT`, `PROVIDER_HTTP`, `PROVIDER_PARSE` (§4.2 rule 22),
`TRANSCRIPT_TOO_LARGE`, `EMBEDDING_FAILED`, `VECTORIZE_INCOMPLETE`, `SUMMARY_FAILED`, or `WORKFLOW_LOST`; a
`blocked` attempt has `PROVIDER_AUTH` or `PROVIDER_LIMIT`, the pre-flight reason; `running` and `available` attempts
carry none. `EMBEDDING_FAILED` is an embedding step that exhausted its retries or returned the wrong dimension;
`SUMMARY_FAILED` is a summary map or reduce call that exhausted its retries (invalid JSON is not a failure: it
retries once, then falls back to raw text and publishes). The API exposes the set as the `AttemptOutcomeCode` enum,
and since 2026-09-13 (M3.7) the column carries the matching `CHECK`, added once every outcome had run for real or
through the fakes (`docs/specs/m3-7-owner-ux-plan.md`); the enum and the constraint are one contract.

- Positive import limits; nonnegative timestamps, attempt/chunk counts, sequence/position values,
  and source offsets. An available episode requires positive `chunk_count`, `vectorized_at`, and `processed_at`.
- Channel checks: an approved channel requires `approved_at`; any status other than `requested` requires `reviewed_at`
  and `reviewed_by_email`; `paused_by` and `paused_at` are both set or both null, and only on an approved channel.
- Episode checks, all table checks in the rewritten `0001` (2026-09-12): `failure_code` is `INGESTION_TIMEOUT`
  exactly when `failed` and null otherwise, with the latest attempt's reason as `failure_detail`; intent and its
  three scheduling timestamps are all set or all null; a `publish` window requires `pending` and a `replace`
  window requires `available`; `staged_vector_generation` is set only while a window is open; an available
  episode also requires `active_vector_generation`; `skipped` and `skip_reason` imply each other, a skipped episode
  requires `skipped_at`, and `skipped_by_email` is present exactly for an `OWNER` skip. There is no waiting code on
  the episode; reasons live on attempts. Attempt checks: `running` has no `finished_at` and every other status has
  one; `blocked` has no `workflow_id`; `owner_retry` has a requester and the other triggers none.
- Structured summaries require executive summary, takeaways, and tags; raw fallback requires `raw_text`. Validate JSON
  shape at the application boundary as well as JSON validity. Mark episode processed and store summary in one local
  transaction after vector completion. SQLite cannot atomically commit with Vectorize.
- Registry indexes: `channels(status, paused_by)` for cron selection;
  `channel_followers(channel_id, unfollowed_at)` for follower counts and the owner queue;
  `channel_followers(user_email, unfollowed_at)` for a user's own list and eligibility;
  `episodes(channel_id, status, published_at)`; `episodes(next_attempt_at)` for recovery;
  `episodes(discovered_by_run_id)`; `episodes(channel_id, processed_at)` for the derived ingestion time;
  `ingestion_runs(channel_id, created_at)`; `episode_ingestion_attempts(video_id, created_at)` and
  `episode_ingestion_attempts(status, started_at)`. No index on open runs: a discovery run exists only once complete.
- User indexes: `chats(updated_at)`. The unique chat/message sequence and message/source position indexes also
  support ordered reads.

### 5.4 Migration governance

- Schema lives in numbered SQL files, one directory per DO class: `apps/api/migrations/registry/` and
  `apps/api/migrations/user/`, named `0001_init.sql`, `0002_add_x.sql`, and so on.
- Each DO has `_migrations(version TEXT PRIMARY KEY, created_at INTEGER NOT NULL)` and runs pending numbered
  migrations on first access under `blockConcurrencyWhile`. Running the migrations twice is a no-op.
- Migration governance beyond numbering is deliberately open (owner decision 2026-09-12, §9): there is no
  additive-only rule and no frozen-file rule, so a migration may drop, rename, or retype a column, and a committed
  migration file may be edited in place. An edited file re-runs only on storage that has not recorded its version in
  `_migrations`, so local Durable Object state is wiped after such an edit (nothing is deployed). The owner will
  revisit governance; until then this section states no further rule.
- Both `0001_init.sql` files were rewritten on 2026-09-10 before first deployment, and the Registry's again on
  2026-09-12, when the owner chose to start over on the schema, the Registry DO's store modules, and the API contract
  for M3 rather than carry deprecated tables, columns, and enum values (`docs/specs/api-reference-plan.md` Step 4);
  `0002_drop_lifecycle_version.sql` of 2026-09-11 was folded into that rewrite and deleted. The Registry lists
  `0001_init` alone; the User DO's file was edited on 2026-09-13 to drop `channel_follows` (§9). No rule prevents a
  further edit.
- Retention: chats, messages, follow tombstones, episodes, summaries, and vectors are all retained. Deletion is soft
  where it exists at all; channels are never deleted.

## 6. Vector storage and retrieval boundaries

- Store transcript text only as shared Vectorize chunk metadata, not duplicated in each user database or namespace.
  Metadata `text` is what the LLM reads at query time, so it is exact.
- Namespace: `shared-catalog`. ID: `${videoId}:${generationId}:${chunkIndex}`. Metadata:
  `{ videoId, channelId, generationId, channelTitle, title, startSec, endSec, text, publishedAt }`. `channelId` and
  `videoId` are required on every vector because retrieval filters on them.
- Chunking is a hybrid time/token strategy: group consecutive segments into about 60 seconds of speech; split a group
  over about 400 tokens (approximated as `chars / 4`) on segment boundaries; overlap consecutive chunks by 1–2
  segments so a point straddling a boundary is still retrievable; never emit a chunk over 480 tokens, because the
  embedding model truncates silently at 512. Handle overlong individual segments without exceeding the cap.
- Every Vectorize helper requires explicit namespace scope. For ID-based methods, enforce that scope in the helper
  even if the underlying API does not accept a namespace parameter. No user-specific private text goes into this index.
- Chat uses `filter: { channelId: { $in: eligibleChannelIds } }`, `topK: 3`, and all metadata. Never send an empty or
  unfiltered fallback query. Split channel lists into filters below Vectorize's 2048-byte limit and merge by score;
  never drop the channel filter to accommodate limits.
- Validate returned episodes are available, channels remain eligible, and the vector generation equals the episode's
  `active_vector_generation` before using retrieved text. Fetch additional candidates as necessary when rejecting
  inactive or partial generations; the generation comes from the vector id, and there is no generation metadata
  index or per-episode filter. Never publish availability based only on accepting an asynchronous upsert; verify
  the complete staged generation and switch it active with the summary publication, then delete the previous
  generation (§4.2 rules 24–26).
- Declining a channel does not require vector deletion or rewriting every vector. Current catalog eligibility excludes
  the retained vectors; approving the channel again reuses them.
- The owner must create the index and its `channelId` and `videoId` metadata indexes before the first upsert; vectors
  inserted earlier are not filterable on those fields and would have to be re-upserted. See
  [Cloudflare metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

## 7. UI and target API

### Screens

The UI is web based: images, avatars, thumbnails, and rich embeds are permitted; structured text (lists, headings) is fine.
Routing is history mode, and deep links and reloads must work. Section navigation within a page uses anchors, not
client-side tab state. Assistant messages render as plain text with newlines preserved; only `youtube.com` URLs are
linkified, and a chat source with a start time links to `https://youtu.be/<videoId>?t=<startSec>`. The owner label is
"Owner" throughout. Owner controls render only when `GET /me` returns the owner role; the client's role is for
rendering, and the web is the only gate: the API enforces no authorization (§9). Where this document says the owner
sees something readers do not, that is the web's rendering; the API returns the same representation to every identity. The user-facing phrases for channel statuses, skip reasons, and
wait reasons live in one place in the web app.

- **Account `/`:** "Who is this for?" email input and a list of previously used emails from local storage for
  one-click selection. If an email is already selected the page goes straight to `/home`; "Switch account" remains
  visible on every other screen. The remembered account is the default for the next page load, not the source of
  truth for requests: a tab sends exactly the account it displays, and tabs do not synchronise, so two tabs may act as
  two people (decided 2026-09-08).
- **Home `/home`:** one page for everyone, with section jump links. The header shows the email, the word `owner` when
  applicable, and "Switch account"; the nav shows **Home** and, for owners, **Owner (n)** where `n` is the attention
  count. Owners see an attention card first ("2 channels waiting for review · 1 episode failed · 1 channel approved
  but never started", from `GET /catalog`) linking to `/owner#attention`; users never see it and it is hidden when the
  count is zero. Then:
  1. **Today's digest** — **superseded 2026-09-14 (§9): the queue is grouped by day with no window, and filtered by
     channel rather than by time.** Eligible followed channels only; summaries first available in the last 24 hours, newest
     availability first (the basis since M3.5), as a flat list with the channel as
     byline: shared summary, takeaways with `youtu.be/<id>?t=<startSec>` links where a timestamp exists, tags, and
     related titles filtered to eligible channels. Items with no read receipt at fetch time are marked NEW, and
     returning them records the receipt. "Show last 7 days" widens the window; "Refresh" re-fetches the lists
     and then the digest, since polling stops at approval and the first summaries land minutes later. Load follows and
     channels before the digest so unread counts and NEW markers agree. Empty states (owner decision 2026-09-10): with no active follows, "Follow a channel to start your digest." with the catalog and its
     follow controls rendered inline; with follows but none approved yet, explain that no summaries are available yet
     and point to the channel rows; otherwise "No new summaries in the last 24 hours." or "No new summaries in the
     last 7 days."
  2. **Channels** — two subsections and one input. **Followed**: approved rows show summarised count, unread count,
     and last ingestion and link to the channel; requested rows read "Awaiting owner approval"; paused rows add
     "paused"; declined rows read "Declined" or "Withdrawn" with the owner's note and date and a **Request again**
     button that confirms once. Unfollow on every row, and a followed channel that is declined stays listed but drops
     out of the digest. **Catalog**: approved channels the reader does not follow with summarised counts and Follow;
     requested channels with "awaiting approval · N following" and Follow. Below both, one **Add a channel** input
     for a `UC…` id or `/channel/UC…` URL with a line saying where to copy it: a new id creates and follows (for the owner role the web follows the add with an approve, since the API has no
     owner shortcut), an id
     already in the catalog follows, and a declined id shows "Declined on <date>: '<note>'" with Request again.
     Poll about every 15 seconds only while a followed channel is still awaiting the owner's decision.
  3. **Chats** — **superseded 2026-09-14 (§9): chats are their own destination, `/chats` and `/chats/:id`, not a
     section of Home**, which no longer exists in that form. List, create, and select independent
     conversations; preserve each chat's messages and source links. Chat controls are never disabled for lack of
     follows; the fixed follow-required response of §4.5 applies instead.
- **Channel `/channel/:id`:** any status. Requested shows the header, "Awaiting owner approval", and Follow or
  Unfollow, with no episodes. Approved shows shared summaries newest first for followers, with per-user read status,
  and pending, skipped, and failed episodes by title with their phrase, a pending one phrased from its latest attempt
  with a `blocked` attempt reading as the same wait as the matching in-flight provider reason; viewing marks returned
  summaries read for this user. Declined shows the owner's note, the date, and the follower count, Unfollow for a follower (Follow is refused
  with 409), and Request again, with episode titles and no summaries when it had been approved. Follow control for
  non-followers. No per-channel chat input; conversations live on Home. Back link to Home.
- **Owner `/owner`:** owner only in the web; users are sent back to `/home` with a note. The API itself accepts every
  call from any identity.
  One page with sections **Queue**, **Catalog**, and **Needs attention** and jump links `#requests`, `#catalog`,
  `#attention`.
  - **Queue:** requested channels oldest first with title, id linked to its YouTube page, active followers by email,
    "nobody is waiting" when there are none, "previously declined on <date>: '<note>'" when re-requested, and Approve
    (title, import count, note) and Decline (note) forms; reviewed history collapsed to reviewer, time, and note.
  - **Needs attention:** publication recoveries that exhausted 48 hours, grouped by channel with
    `INGESTION_TIMEOUT`, the last reason, attempts, Retry, and Skip; episode actions do not depend on channel-run or
    channel status. Then approved channels with no ingestion run at all, each row carrying Start (`POST
    /channels/:id/runs`); a run's absence of episodes says the tick found nothing or could not read the feed. "Never started" means approved and no run, with no age window. Every other
    problem reaches the owner as a `failed` episode or on the health strip.
  - **Catalog:** the health strip from `GET /catalog` (channels by status, paused and declined counts, episodes by
    status, last successful ingestion, and the transcript credits and key status), then an all-channels table
    with status, paused, available over tracked episodes with skipped and failed counts, follower count, last
    ingestion, latest discovery run result, and the actions the status allows: Approve or Decline (confirming once
    with the follower count for an approved channel), Pause or Resume, and Start on every approved channel,
    paused or not, so a system-paused channel whose first fetch failed can be checked by hand. Follower counts are
    real; the emails behind them appear only in the queue.
- **Owner channel detail `/owner/channels/:id`:** status, pause, approval and review fields, import count, follower
  count; episodes with content status, open window's intent with next attempt and deadline, the count of launched
  attempts beside the latest outcome and attempt (a blocked latest attempt explains a count of zero), summary format,
  Retry on every row, and Skip on failed ones. Retry is disabled while that
  episode's attempt has been running under an hour and enabled after that, the route reconciling a dead instance
  inline (§4.2 rule 17). Initial and scheduled feed runs show feed status and discovered count, and each episode names the run that
  discovered it, so a run's episodes are a client-side join; followers by email.
  Never shows any user's read or chat activity.
- Owner management is limited to what supports approve, decline, pause, resume, and per-episode retry and skip; there
  is no general admin dashboard.

### Target resource contract

All endpoints except `/health`, `/openapi.json`, and `/docs` require `X-User-Email` and return 400 `INVALID_INPUT` for a missing or
malformed email. Everything exchanges JSON, with one exception: `GET /docs` serves the Scalar test client as HTML
(owner decision 2026-09-07). No endpoint checks the caller's role: the API enforces no authorization (decided
2026-09-12, §9), and the web offers owner controls to the owner role only. Resolve chats only inside the caller's User DO. Shared request/response types live in
`packages/shared` as Zod schemas with their types inferred beside them; the web fetch wrapper remains the sole web
`fetch` caller and imports types only.

The API is modelled on entities, not roles: there is no owner namespace, no role-named type, and no 403. Every
operation is accepted from any identity; `?scope=all` widens a collection for any caller; every channel carries its
`management` block and every episode its `processing` block, summaries and related items included, for every caller.
A representation differs per caller only through the caller's own relationships: `following`, `unreadCount`,
`wasUnread`, and the read receipts recorded for an eligible caller (§4.4). The API is promiscuous about input too: it
accepts optional fields from any caller. Which fields and controls a given user is offered is the UI's decision (§9).

Typed domain errors map to HTTP: `INVALID_INPUT` 400, `NOT_FOUND` 404, `INVALID_STATE` 409,
`UPSTREAM_UNAVAILABLE` 502. Optional text fields (`title`, `explanation`) are omitted or non-blank: an empty string,
whitespace only, and `null` are `INVALID_INPUT`, never a silent default (owner decision 2026-09-08); the web app
strips blanks before sending.

The API documents itself: every route carries a description (one entity tag, a summary, the success schema, and the
error responses it can produce) and validates body, query, and params against the shared schemas. `GET /openapi.json`
is generated from those at request time and must list exactly the registered routes, so a new route cannot ship
undocumented. Scalar's script is pinned to one version and its request proxy is off.

| Method and path | Who | Purpose |
|---|---|---|
| `GET /me` | anyone | Caller's normalized email and role (`owner` or `user`); the UI uses it to show owner controls |
| `GET /catalog` | anyone; UI: owner | Aggregate catalog state: `channels { requested, approved, paused, declined }`, `episodes { available, pending, failed, skipped }` (no `waiting` count; wait reasons live on episode rows), `attention { failedEpisodes, neverStarted, requested }`, `lastSuccessfulIngestionAt` (`MAX(episodes.processed_at)`), and `transcripts { remainingCredits, status: ok | auth_failed | unreachable }` |
| `GET /channels` | anyone | Requested and approved channels, each with `status`, `paused`, `following`, `followerCount`, episode counts, and derived `lastIngestedAt`; every caller receives a `management` block whose `latestRun` reports the feed result and number of episodes discovered; `?scope=all` (any caller) adds declined ones |
| `POST /channels` `{ channelId, title?, initialImportCount? }` | anyone | Creates a `requested` channel and follows the caller (201), whoever calls; there is no owner shortcut (2026-09-12), the web's owner add follows with an approve. An existing `requested` or `approved` id is followed and returned (200); a `declined` id is 409 `ChannelDeclinedResponse` with the owner's note. A handle or an id with no feed is 400. `title` and `initialImportCount` are honoured from any caller; the UI offers them to the owner only |
| `GET /channels/:id` | anyone | One channel in any status, so a declined one can show its note; the owner also gets `management` |
| `POST /channels/:id/request` | anyone | `declined → requested`, keeping the review fields; follows the caller |
| `POST /channels/:id/approve` `{ title?, initialImportCount?, explanation? }` | anyone; UI: owner | `requested → approved` with the one initial import, or `declined → approved` without one; recomputes pause from the follower count |
| `POST /channels/:id/decline` `{ explanation? }` | anyone; UI: owner | `requested → declined`, or `approved → declined` with the pause cleared; stops new discovery, not existing episode recovery |
| `POST /channels/:id/pause` / `POST /channels/:id/resume` | anyone; UI: owner | Owner pause; resume clears either kind of pause. Approved channels only |
| `GET /channels/:id/episodes?limit=` | anyone | Episodes newest first; every caller gets `status`, a top-level `skipReason`, on a pending episode a top-level `waitReason` derived from its latest attempt (§4.2 rule 11), the available summary and related items, and the `processing` block with the active intent and window, next attempt, latest attempt, and diagnostic outcome; an eligible caller (active follower of an approved channel) also gets read state, and the summaries returned to them are marked read (§4.4) |
| `POST /channels/:id/episodes/:videoId/retry` | anyone; UI: owner | Any episode state in any channel status; opens a fresh 48-hour window when pre-flight permits and returns the new attempt, never a channel run. An available episode keeps its summary and active vector generation until replacement succeeds; a blocked Retry records a `blocked` attempt and leaves the episode unchanged; 409 while an attempt is running |
| `POST /channels/:id/episodes/:videoId/skip` | anyone; UI: owner | `failed → skipped OWNER`, regardless of channel status |
| `GET /channels/:id/runs` | anyone; UI: owner | Initial and scheduled RSS discovery runs newest first with feed status and discovered count (each owner episode carries `discoveredByRunId`; there is no per-run episode list); all processing history lives on episode attempts |
| `POST /channels/:id/runs` | anyone; UI: owner | Checks an approved channel's feed now, ignoring pause (409 `INVALID_STATE` for any other status): 200 with the completed discovery run, including nothing new; 502 `UPSTREAM_UNAVAILABLE` when YouTube does not answer, after the `feed unavailable` run is recorded |
| `GET /channels/:id/followers` | anyone; UI: owner | Emails and follow times of the channel's active followers |
| `GET /follows` | anyone (own) | Own active follows, each embedding its `channel` — any status, including declined — and carrying `unreadCount` |
| `PUT /follows/:channelId` / `DELETE /follows/:channelId` | anyone (own) | Follow or refollow a `requested` or `approved` channel (409 `ChannelDeclinedResponse` for a declined one) / retain an unfollow tombstone on a channel in any status; the Registry's follower record is the follow |
| `GET /digest?since=<iso>` | anyone (own) | Eligible followed-channel summaries selected and ordered by `summaryAvailableAt` (since M3.5); default last 24h, clamped to 7 days; marks returned items read and reports `wasUnread` per item. **Changing (§9):** gains an end bound and a cursor, loses the clamp, and stops recording receipts |
| `POST /chats` / `GET /chats` | anyone (own) | Create an empty chat / list own chats |
| `GET /chats/:id/messages?limit=50` | anyone (own) | Selected chat history with citation snapshots |
| `POST /chats/:id/messages` `{ message }` | anyone (own) | Reply and sources using current eligible follows |
| `GET /preferences` / `PUT /preferences` | anyone (own) | Chat preference rules |

Routes that deliberately do not exist: `/channel-requests/*` (requests are channels), `DELETE /channels/:id` and
`POST /channels/:id/restore` (channels are never deleted), `POST /channels/:id/retry` (retry is per episode), chat
deletion, and per-channel chats. The on-demand discovery route is `POST /channels/:id/runs` (M3.4); there is no other.

## 8. Verification and success criteria

- Two users following one channel produce one shared episode/summary/vector set with independent read receipts.
- Users cannot inspect another user's chats, messages, preferences, or read receipts. Follow membership is shared with
  the Registry so any caller can list a channel's followers and counts, which the web shows on the Owner screens only;
  that is the explicit exception, not private conversation access.
- Approve, decline, pause, resume, episode retry, and skip are accepted from any identity and offered by the web to
  the owner only; the acting email is recorded; handles and ids with no feed are rejected. Requesters follow at the moment they request, so several followers share one ingestion pipeline and
  nothing is auto-followed later. Adding an existing channel follows the caller and creates nothing; a declined id is
  409 with the note, and requesting again makes it requested and follows the caller. A follow is one Registry write, so
  `following`, `followerCount`, the owner's follower list, and eligibility always agree; there is no second store to
  drift.
- Initial discovery selects five episodes by default and runs once, at the first approval, whether or not anyone
  follows yet; later approvals start none and leave `approved_at` alone. The first-approval discovery ignores pause
  while later discovery skips paused channels; the first scheduled discovery after approval imports nothing published
  before `approved_at`; discovery never selects a known episode or checks the transcript provider. Each newly
  discovered episode points to the run that created it and starts processing immediately with increasing start
  delays. Every unfinished, non-deterministic outcome remains recoverable for 48 hours, regardless of attempt count,
  retrying every six hours with its reason on the attempt and no waiting code on the episode, before an unpublished
  episode becomes `failed INGESTION_TIMEOUT` and needs the owner. Recovery continues for paused and declined channels.
  Immediate system skips are only `SHORT`, `NON_ENGLISH`, and `UNPLAYABLE`.
- Every blocked start, automatic or owner, records a finished blocked attempt with `PROVIDER_AUTH` or `PROVIDER_LIMIT`
  and changes no content and no window; an episode blocked for its whole window times out with that reason in
  `failure_detail`, never an empty one, and `attempt_count` stays at the number of launched attempts. Catalog and
  channel episode counts carry no `waiting` number. A lost Workflow is recorded on its attempt and remains
  recoverable; a Retry on a running attempt
  older than an hour whose instance is gone reconciles it inline and starts, while an active one is refused.
- Owner Retry creates an episode attempt and no channel run or channel write. A Retry that starts work resets the
  processing window; an available Retry preserves its summary, first availability, read receipts, and active vector
  generation unless and until a replacement succeeds; a deadline leaves it available, and so does a replacement
  attempt that classifies the video `UNPLAYABLE`, `NON_ENGLISH`, or `SHORT`, which only records a `skipped` attempt
  and closes the window. Declining an approved channel
  changes no run or episode row. Channel and catalog ingestion times equal the relevant episode `processed_at`
  maximum; owner overview and channel-health counts match the underlying episodes and runs.
- Unfollowing to zero followers pauses an approved channel; the next follow lifts a system pause, an owner pause
  survives it, a requested channel is never paused, and a paused channel's summaries stay readable while cron skips it.
- Partial or replacement vector generations cannot become chat context until the corresponding summary is ready and
  the generation is atomically activated. Inactive generations never enter retrieval, a replacement leaves only the new
  generation in the store, and a failed cleanup leaves publication standing. A related-lookup failure still publishes
  the summary.
- Existing chats include newly followed channels and exclude unfollowed or declined ones from new retrieval.
  Historical messages and sources remain intact. Approving a declined channel again restores access for its remaining
  active followers, not for explicit unfollows. Every Vectorize call uses `shared-catalog`, and chat queries carry only
  eligible channel IDs.
- With no eligible follows, chats remain usable and persist the fixed response without calling AI/Vectorize.
- Read receipts apply only to summaries returned to that user. First-follow summaries start unread; declining and
  approving again keeps prior read status. Digest windows use first availability, ordered strictly by it. Shared
  cross-references are filtered at display time.
- Migrations run idempotently on a fresh DO, and the check constraints reject what they are meant to reject: an
  approved channel with no `approved_at`, a paused channel that is not approved, a skipped episode with no reason, an
  owner skip with no email. `GET /openapi.json` lists exactly the registered routes, and each route's responses parse
  against the shared schemas, so the document and the Worker cannot disagree about a shape.
- Real DO SQLite tests cover migrations and isolation. Workers AI, Vectorize, transcripts, Workflows, and YouTube feeds
  are replaced by env-selected fakes so no test reaches the network; retain pure-function tests for chunking, RSS/URL
  parsing, and summary validation. Do not add tests for UI components, Hono plumbing, or Workflow step ordering.
- `pnpm check` is the finish gate. Runtime behavior, especially transcript fetching, must also be exercised under
  `wrangler dev`. Follow the engineering constraints and setup commands in `AGENTS.md`.

## 9. Decisions and retention

- **Lucide icons, and monograms where artwork is missing — decided 2026-09-14.** The icon set is Lucide, shipped as
  `lucide-preact` (the dependency approved 2026-09-15): one stroke weight, one grid, and a name for every glyph, so a
  screen never invents its own. The two type families are self-hosted rather than fetched from a font CDN, which would
  tell a third party when each reader sat down to read. Channel avatars are **deterministic
  monograms** — two letters on a tint derived from the channel id — because nothing in the product stores channel
  artwork and no permitted source for it exists; if one is ever added, the monogram becomes the fallback rather than
  the design. Adding a channel is three steps rather than one field: paste an id, verify it against the long-form feed
  (the title, the count of long-form videos, when the newest landed), then decide — a reader files a request there,
  and the owner gets the title, the import count and the note in the same step, which is the one-step approval §7
  already describes.
- **Owner operations are desktop only — decided 2026-09-14.** Curate and channel review have no phone breakpoint and
  no phone entry point: a phone shows no Curate item at all, and Account tells the owner how many things are waiting
  and that they need a larger screen. Approving, declining, retrying, skipping and the catalog table are dense,
  consequential and rare; designing them twice would cost more than it returns. Every **reader** screen has a phone
  breakpoint — queue, reading, history, sources, one source, account, the nothing-waiting state, and the channel and
  date pickers as sheets.
- **The design carries its own accessibility floor — decided 2026-09-14.** Four rules, checked at both sizes and both
  breakpoints, because the paper-and-ink palette makes it easy to drift pale. Text meets 4.5:1 against the page — the
  tertiary grey that carried most secondary labels sat at 2.8:1 and the meta grey at 4.0:1, and both moved. Nothing
  bearing meaning is smaller than 12px, uppercase labels included, which are the hardest to read small. Every control
  a finger reaches is 44px, and owner-table actions, which are text, carry the vertical padding and the weight to be
  found. And **state is never colour alone**: a read summary says "read" and an unread one says "unread" in the same
  ink, a calendar day still holding something is bold and underscored before it is tinted, and no row is dimmed with
  opacity to mean anything. This is the concrete half of the state-mapping work the daisyUI decision below left open.
- **The queue keeps every day, and splits from the library — decided 2026-09-14.** The digest's 24-hour window is
  dropped, and what was one list becomes two views over the same data. **Unread** answers "what still needs me" and
  holds nothing else: no greyed-out rows, no calendar, only the days that still carry something. **History** answers
  "what arrived, and when": every day kept, newest first, each day its own address, navigated by the calendar, and the
  only place a receipt can be undone. The first draft conflated them, showing done rows under a filter labelled
  Unread, and called the second view "Everything" — a name that says what it contains rather than what it is for. Both
  run off the single read receipt: no `archived_at` and no second pile. The first calendar was also unusable as a
  calendar: its cells showed counts without dates, so no one could find Saturday the 12th in it. And the first owner
  wireframe offered Skip on a pending episode, which §7 does not allow — Skip belongs to failed episodes alone, and a
  pending one offers Retry with the wait named. The window was never a decision anyone took — "the last 24
  hours" is in the founding PRD, in the paragraph that defines the word digest, and the seven-day expansion was added
  with the Home read-experience spec (2026-09-07) as an escape hatch. Its one real effect was loss: because `since` is
  clamped at seven days (`apps/api/src/routes/digest.ts`), an episode a reader did not get to became unreachable from
  the queue and survived only on its channel page. A day is the right unit because this product's content genuinely
  arrives in daily batches, because availability never resets so a day never changes once written, and because a
  bounded day is a natural page where an unbounded list is not. **Channel becomes the only other filter** — time
  within a day is not something a reader triages by — and at any catalog size it is one control opening a searchable
  list sorted by what is unread, never a row of chips, which is four lines of chrome at thirty follows. Filters are
  never sticky across sessions, so a quiet queue is never a filter someone forgot. Days are navigated by a
  **calendar of the last five weeks** rather than a list, because a calendar's height is fixed whatever the depth of
  the history and it shows where a week went; a day with nothing costs a pale cell instead of being skipped. The
  calendar belongs to History: in Unread it would be mostly empty cells, so that view carries only the days still
  holding something and a way through to browse by date. **A calendar cell is a date first**: the day of the month is
  the glyph, what arrived that day is the number beneath it, and a tint marks a day still holding something unread.
  Today, the open day, a day with nothing, and keyboard focus are four distinct treatments; each cell carries its full
  date and counts as its accessible name, and arrow keys walk the grid. A **density switch** trades the excerpt away, never the
  title, so a heavy day fits one screen. Counts can be switched off entirely, for a reader who would rather the queue
  did not keep score. **Every screen is designed at two sizes** — a handful of follows and thirty, a few chats and
  forty — because volume, not layout, is what breaks these screens: the controls that carry a long list (search, a
  sort order, status tabs, pagination, a sheet on a phone) are invisible at the size a mockup flatters. This also retires Archive as a separate idea: with days kept,
  permanence comes from the structure and triage from the read receipt, so the reading view's button is **Done** and
  no `archived_at` is needed. Cost: `GET /digest` gains an end bound and a cursor and loses `MAX_WINDOW_MS`.

- **Reading is a place, and reading is an act — decided 2026-09-14.** Three decisions settle the Design phase's
  architecture before its spec is written, and the wireframes for both roles are drawn against them. **One:** a
  summary is read only when the reader says so (§4.4). The digest's return-marks-read rule was right for a page that
  expanded every summary inline and is wrong for a queue, which would empty itself the moment it was glanced at. The
  first version of this decision had *opening* a summary mark it read as well, which left the Done button with
  nothing left to do by the time it could be pressed; revised the same day. So **Done is the only write**, it is
  available on the queue row as well as on the summary's own screen so nothing has to be opened to be dismissed, and
  it advances to the next unread. Every read route stays a pure read, which is the simpler API and the testable one,
  and an accidental open or a shared link cannot cost a reader an item. **Two:** a summary gets its own screen and its own URL,
  `/read/:videoId` — a measured column, the executive summary, the takeaways with their timestamps as the body, and
  nothing else — so the API gains a single-episode read, since deep links and reloads must work (§7). **Three:**
  Home splits in two. `/queue` is what is waiting to be read, one row per episode with the executive summary as the
  excerpt; `/sources` holds following, the catalog, and adding a channel, and M4's chats become `/chats` rather than
  a third section of Home. §7's one-page Home with jump links is retired. The reading experience is modelled on Instapaper: a queue rather than a wall, one screen per piece,
  type and theme controls, archive as the act that clears an item.
- **The owner does not choose a role — decided 2026-09-14.** There is no role selection at sign-in and no reader/owner
  mode. The owner is a reader who also curates: one nav, one extra destination (`/curate`, holding Needs you, Catalog,
  and the reviewed history) whose nav item carries a count only when something is waiting, and owner controls beside
  the objects they govern — approve, decline, pause, resume, and start a run on the channel's own page. A role gate
  would tax a daily act for a weekly one, duplicate the account switch the product already has, and invent a mode to
  explain when a screen looks empty. Owner-ness attaches to objects, not to sessions. The API still answers every
  identity the same way; this hierarchy is the web's rendering, and the web is the only gate.

- **Nothing is owed outside §10 — recorded 2026-09-14.** Four items were reading as work in flight. Two had in fact
  been settled the same day and the specs had not caught up; two are now skipped. **Settled:** the summary
  regeneration (`summary-coverage-plan.md` Step 5) ran — thirteen episodes retried, eleven republished, three
  sentences held 9/9 against 6/11 untouched, no republished summary opens by narrating the recording against 6 of 11,
  median coverage gap 49% to 25% — and the owner accepted it as v1; and attribution (`summary-quality.md` §4.3) was
  built, A/B'd against the live model and discarded uncommitted, because `llama-3.3-70b` keeps writing "The guest"
  whether or not it is handed the name, 30% anonymous falling only to 22%. **Skipped:** M3.7's owner click-through of
  the four screens and the long-form feed plan's Step 5 walkthrough, both of which exercise screens the Design phase
  rebuilds, so they are walked through against the design instead; the feed split keeps its `YOUTUBE_FEEDS_FAKE`
  coverage meanwhile. Two episodes of the regeneration failed `VECTORIZE_INCOMPLETE` under twelve simultaneous
  retries, kept their old summaries, and want a manual Retry run on its own. The next work is the Design phase (§10),
  with nothing trailing it.

- **Twenty-minute sections, and the takeaways chosen in code — decided 2026-09-14.** A 146-minute episode's summary
  reached 1:56:41 and stopped, losing 29 minutes that contained several concrete, quotable claims. Two independent
  causes were measured and both are fixed. Sections of 45 minutes were too long: a model call trails off in its own
  last third whatever its length, so a long section leaves a long hole. Across two episodes, 45-minute sections left
  the last half hour unrepresented and touched 7 of 10 deciles, while 20-minute sections lost about a minute, touched
  every decile, halved the widest gap, and — unexpectedly — repeated run to run where the 45-minute split had varied
  by ten minutes. Twenty is the knee: thirty recovers most of the benefit for two fewer calls, twelve buys nothing and
  makes the tail worse. And the model would not distribute: asked to select 15 to 18 takeaways across its sections it
  filled the list from the earliest and stopped, twice measured, discarding whole sections. That selection now happens
  in code — a quota round-robined across sections and spread within each — and the second model call is demoted to
  writing the three sentences and consolidating the tags, which is what it is good at. Two consequences worth naming:
  a failed second call no longer destroys the summary, because the takeaways were chosen before it ran, so
  `raw_fallback` now means "no section parsed at all" rather than "the reduce failed"; and the cost of a long episode
  roughly doubles, eight or nine model calls where there were four. Sections are divided by chunk count rather than by
  filling each to a time target, because filling by time left a 2-minute remainder at some lengths that would have
  drawn a full call and a full share of the budget. Reasoning and measurements: `docs/specs/summary-coverage.md`.
- **Summary prompt v2, and both summary calls in JSON mode — decided 2026-09-14.** On 2026-09-13, the first day
  summaries existed, two episodes fell back to raw text. One was our own three-sentence cap, since relaxed. The other
  was the model's: a news clip came back as JSON whose `executiveSummary` value carried no quotation marks, twice, so
  the validator could not read it and the reader saw JSON under "unformatted summary". Three changes answer that. The
  map and reduce prompts are rewritten around a literal JSON skeleton with the rules numbered below it, because a model
  copies a skeleton more reliably than it follows prose. Both calls now ask Workers AI for JSON mode, a
  `response_format` carrying a JSON Schema built from the validator's own bounds, so the platform shapes the answer
  before we see it and the two constraints cannot drift apart; Cloudflare does not guarantee conformance, so the hand
  validation of §4.4, the one stricter retry, and the raw fallback all stay exactly where they were. And the takeaway
  bound widens from 3–5 to 3–8, the map prompt asking for 3–6 and the reduce for 5–8: a three-minute clip cannot
  honestly give five distinct points, while the reduce runs only on episodes past 45 minutes and has earned the room.
  The sentence count is still not validated (the 2026-09-13 decision stands). The same edit fixes a latent defect the
  reduce prompt had hidden since M3.5: the section summaries handed to the reduce call carried raw seconds where the
  prompt promised `[h:mm:ss]` markers, so no multi-section episode could have kept its timestamps. `PROMPT_VERSION`
  becomes `2026-09-14` and names the whole output contract, the texts and the schema together. Existing summaries are
  not regenerated; owner Retry per episode is the path, one transcript credit each. A probe against the live model that
  day recorded two platform behaviours worth keeping: in JSON mode the answer arrives as a parsed object rather than a
  string, and a schema the model cannot satisfy produces no "JSON Mode couldn't be met" error but a best-effort answer
  truncated at the token ceiling — which reaches us as an invalid answer, so the retry and the fallback are what handle
  it. Reasoning and the probe record: `docs/specs/summary-json-mode.md` and its plan.
- **daisyUI over Tailwind is the component library — decided 2026-09-14.** `daisyui` 5, `tailwindcss` 4, and
  `@tailwindcss/vite` join the approved dependencies (`AGENTS.md`), and the rule requiring one plain CSS file with no
  component library and no CSS framework is withdrawn (§3). daisyUI is pure CSS with no JavaScript bundle and is
  framework agnostic, so it raises none of the Preact compatibility questions that ruled out the React-based
  libraries: the web's JavaScript does not grow at all, and its CSS grows from about 1 kB compressed to an expected
  12 to 20 kB. Its components cover what §7 already asks for, notably `badge` and `status` for the attempt-outcome
  vocabulary, `stat` for the catalog health strip, `table` for the owner catalog, `collapse` for the reviewed
  history, `skeleton` for the per-section loading states, `avatar` for channel avatars, `chat` for M4 conversations,
  and `modal` on the native `<dialog>` element. Four conditions are rules rather than preferences and live in
  `AGENTS.md`: one custom theme with all 35 built-ins excluded, so the product inherits no recognisable default look;
  the native `<dialog>` modal method only, never the checkbox or anchor variants, which drop escape-key closing and
  focus containment; the `tabs` component unused, because §7's section navigation is anchors and that rule stands;
  and `lib/copy.ts` stays the single home for user-facing phrases, so daisyUI supplies form and our code supplies
  words. Not installed yet: Tailwind's preflight reset would restyle the five screens built during M2 and M3 before
  there is a design to rebuild them to, so the install is the Design phase's first step (§10). The library supplies
  parts, not a system; mapping the channel, episode, wait, skip, and outcome states onto daisyUI's handful of
  semantic colours is design work the phase still owes.
- **A designed web UI, and a Design phase before M4 — decided 2026-09-14.** The UI is no longer text only. Images,
  avatars, thumbnails, and rich embeds are permitted (§7), and rich media stops being a non-goal (§1). A Design phase
  takes the place between M3 and M4 (§10): it produces the visual system and a design for every screen of §7, then
  rebuilds the five screens built during M2 and M3 to match, so M5 keeps conversations alone. It is deliberately
  unnumbered so that every existing `M4`, `M5`, and `M6` reference in the specs stays correct; renumbering would have
  touched forty-three of them, sixteen inside closed records of past decisions. This entry originally recorded that
  the stack was unchanged and the design had to be executable in hand-written CSS; that constraint was reversed
  later the same day by the decision above. The screens of §7 describe what is built today; the Design phase's own
  spec will carry the designed replacements, and neither the spec nor its plan is written yet.
- **Follows have one owner — decided 2026-09-13.** The Registry's `channel_followers` is the only record of follows;
  the User DO's `channel_follows` table is dropped (its `0001` edited in place, local state wiped). Since 2026-09-10
  every follow was written twice, User DO first, with the promise that a failed second write would be corrected by
  the next write of the same pair. That left two silent failure modes, a followed channel that stays system-paused
  and never discovers, and a phantom follower that keeps a channel discovering for nobody, with nothing detecting
  either. The copy bought nothing: both rows carried the same two timestamps, follows were already Registry data by
  design, and every Home load already goes through the Registry. Eligibility becomes one SQL join there. Read
  receipts, chats, and preferences stay private to the User DO. Spec: `docs/specs/follows-single-owner.md`.
- **Channel state simplification — decided 2026-09-10** (`docs/specs/channel-simplification.md`). A channel is an
  approval container with three statuses, `requested`, `approved`, and `declined`, and carries no import outcome.
  Anyone adds a channel by pasting its id, which also follows it; the owner approves or declines. Declining is the one
  answer to "no, not this channel" and "we are withdrawing this one": it stops scheduling, hides the channel from the
  catalog list, keeps everything it produced, and is undone by the owner approving it again or a user requesting it
  again after reading the note. Channels are never deleted. Pause is a flag on approved channels, set by the system
  when the last follower leaves and by the owner by hand. Episodes carry the state machine — `pending`, `available`,
  `failed`, `skipped` — with every unfinished, non-deterministic outcome retried for one 48-hour processing window and
  deterministic outcomes skipped automatically, reversibly. Follows are recorded in the Registry as well as the User
  DO, so follower counts are real. The initial import runs once, at the first approval, regardless of followers. Gone
  with this decision: the request entity and its outcome phrases, automatic follows, channel failure codes, channel
  retry, the channel waiting code, channel soft delete and restore, and the follow eligibility guard. Because nothing
  was deployed, both `0001_init.sql` files were rewritten once, with owner approval, instead of extended (§5.4).
  Merged the same day; the owner's browser walkthrough of the four screens passed.
- **Transcript source — decided 2026-09-08: DownSub's API.** The InnerTube mechanism of 2026-09-07 was built and
  measured and is bot-checked from Cloudflare's egress (§4.2 rule 19). The owner weighed a home relay behind a
  Cloudflare Tunnel, Bright Data's Web Unlocker, and DownSub, and chose DownSub after a probe with a trial key passed
  every check (`docs/specs/m3-ingestion.md` §2). The InnerTube code was removed and survives only on the throwaway
  branch `spike/transcript-remote`.
- **M3 execution model — decided 2026-09-12** (`docs/specs/m3-ingestion.md` §2). Channel ingestion and episode
  recovery are independent. A channel discovery run is completed RSS history: it fetches one approved, unpaused
  channel's feed, creates new episodes with immutable `discovered_by_run_id`, and starts their first attempts. It does
  not own later episode outcomes. One episode Workflow instance represents one durable attempt, whether immediate,
  scheduled, or owner-requested. The episode recovery scheduler ignores channel status and pause, and retries every
  unfinished non-deterministic outcome for 48 hours with no three-attempt rule. DownSub pre-flight gates episode
  attempts only, not discovery, and every blocked start is a recorded attempt (2026-09-12 review). Publication uses
  staged vector generations so failed first publication exposes nothing
  and failed replacement leaves current content readable. Lost running attempts reconcile after one hour and remain in
  the same 48-hour window; "approved, never started" has no age window. A tick staggers the attempts it starts by
  three seconds each. The schema, the Registry DO's stores, and the API contract were restarted for this model rather
  than evolved (§5.4); the `lifecycle_version` fence is gone.
- **Product name — decided 2026-09-12: Said on Air.** The name states what the product delivers: what was said on
  the air, in text, with the minute it was said. It replaces the working title "Media Digest Assistant". When the name
  was chosen, `saidonair.com`, `.app`, `.dev`, and `.io` were unregistered at their registries (RDAP and whois,
  2026-09-12) and a web search found no product, company, or podcast using the name; no trademark database was
  searched. The web brand text and the API document title follow the name. Whether the repository name, the
  `@media-digest/*` package scope, the Worker name, and the browser storage keys follow it needs an owner decision.
- **Cron cadence — decided 2026-09-12:** channel discovery runs at `0 */6 * * *` UTC and episode recovery at
  `30 */6 * * *` UTC; both have a six-hour cadence. The triggers exist in production only (2026-09-13, below).
- **Environments — decided 2026-09-13: three, dev, staging, production.** Local `wrangler dev` runs as dev against
  dev-only remote resources (its own Vectorize index, its own secrets), so nothing local can touch what production
  or the deployed staging preview holds. Staging is the default target of a bare deploy, so a forgotten flag can never
  reach production. Cron triggers run in production only; staging and dev are driven by hand. Per-environment
  resources are named `x`, `x-staging`, `x-dev`. The mechanics are `AGENTS.md` → Environments.
- **Workers plan — decided 2026-09-11: Workers Paid.** Per-step CPU and the concurrent-instance cap both fit.
- **Owner management interface — decided 2026-09-07:** the Owner screens in §7 and
  `docs/specs/home-read-experience.md`. Identification: `global_users.role` seeded from the `OWNER_EMAIL` secret.
- **API reference — decided 2026-09-07:** the API is entity-modelled, documents itself through the shared Zod schemas
  as OpenAPI 3.1 at `GET /openapi.json`, and serves Scalar at `GET /docs` (`docs/specs/api-reference.md`). The
  contract was restated from this PRD with no legacy member and the spec and plan approved on 2026-09-12.
- **Discovery-run collection name — decided 2026-09-12: `runs`.** `GET /channels/:id/runs` lists a channel's
  completed discovery runs and `POST /channels/:id/runs` performs one now; the `GET` was `ingestion-runs` until
  then. One resource, one name; the table and schemas keep `ingestion_runs` and `IngestionRun`.
- **Reader-safe wait reason — decided 2026-09-12: `waitReason`.** A pending episode carries `waitReason` for every
  caller, derived from its latest attempt (§4.2 rule 11), beside the reader-safe `skipReason`; the attempt itself is
  in `processing.latestAttempt`, also for every caller since the same day. This resolves the Channel screen in §7, which phrases a pending episode from its latest attempt,
  against the route row, which had given readers `status` and `skipReason` only. Chosen over owner-only copy so a
  follower asking why there is no summary yet gets an answer.
- **Attempt outcome codes — decided 2026-09-12: `EMBEDDING_FAILED` and `SUMMARY_FAILED`.** The two failed-attempt
  codes §5.3 had left open, named in the style of `WORKFLOW_LOST` and `VECTORIZE_INCOMPLETE`; `TRANSCRIPT_TOO_LARGE`
  from the M3 spec is mirrored at the same time. The set is closed, so the API document lists it as an enum and the
  web's owner copy can be exhaustive.
- **Processing window vocabulary — decided 2026-09-12: `intent` (`publish` | `replace`), `window_started_at`,
  `window_deadline_at`, `staged_vector_generation`.** They replace `recovery_mode` (`publication` | `replacement`),
  `recovery_started_at`, `recovery_deadline_at`, and `recovery_vector_generation` on episodes, and `recovery_mode` on
  attempts; the API names are `ProcessingIntent`, `intent`, `windowStartedAt`, `windowDeadlineAt`. The window opens
  when an episode is created, not after a failure, so "recovery" named the wrong thing and "mode" named nothing;
  the value states what the open window is for. The recovery cron and the `scheduled_recovery` trigger keep their
  names: they do only ever pick up episodes whose earlier attempt did not finish. Edited into `0001` in place
  (§5.4); local Durable Object state is wiped by the owner.
- **Migration governance — decided 2026-09-12: no additive-only rule and no frozen-file rule, until revisited.** The
  rules that migrations only create tables, add columns, and create indexes, and that a committed migration file is
  never edited, are withdrawn from every document, and `DROP` is struck from hard rule 4 in `AGENTS.md`. A migration
  may contain any DDL and a committed file may be edited in place; an edited file re-runs only on storage that has
  not applied it. The owner will revisit governance later.
- **No authorization in the API — decided 2026-09-12.** The API enforces no authorization at all: no route or
  Registry method checks the caller's role, there is no 403 and no `NOT_OWNER`, every operation is accepted from any
  identity, `?scope=all`, the catalog, followers, and runs are readable by anyone, and every caller receives the full
  representation (`management`, `processing`, summaries). Optional fields (`title`, `initialImportCount`) are honoured
  from any caller. The web is the only gate: it offers owner controls and the Owner screens to the owner role from
  `GET /me`. Read receipts are recorded only for eligible callers (§4.4). Kept as they are: the names `OWNER` (skip reason) and
  `owner_retry` (attempt trigger), which now mean "by hand through the API". Replaces the 2026-09-07 rule that the
  Registry re-checks the role inside owner-only methods.
- **Owner add shortcut removed — decided 2026-09-12.** `POST /channels` creates a `requested` channel for every
  caller and starts nothing; approval is always `POST /channels/:id/approve`, so the API reads the role nowhere. The
  web keeps the owner's one-step experience by following the add with an approve carrying the title and import
  count the owner entered.
- Retain all chats and all shared/user records for now. A future retention policy needs an owner decision.
- Whether Home's chat input should be pinned to the bottom when the digest is long remains a UI decision.

## 10. Milestones

```text
M1 Foundation    pnpm/Turbo/Volta scaffold · Hono · identity · Registry/User DO migrations
M2 Catalog       anyone adds a channel · owner approve/decline · pause · follows and followers
M3 Ingestion     discovery runs · episode attempts · RSS/transcripts · chunking · embeddings · staged vector
                 generations · shared summaries · one Workflow instance per episode attempt · two six-hour crons ·
                 Start route · Retry/Skip · availability-ordered digest
   Design        visual system · a design for every screen of §7 · the five built screens rebuilt to match
M4 Intelligence  unread receipts · multiple chats · filtered retrieval/citations
M5 UI            conversations
M6 Hardening     isolation/lifecycle tests · wrangler verification · docs
```

The Design phase sits between M3 and M4 and carries no number on purpose (decided 2026-09-14, §9): forty-three `M4`,
`M5`, and `M6` references across `docs/specs/` and this document keep their meaning, and none has to be rewritten.
It is a milestone in every other respect, with its own spec, plan, and owner approval before any web change. It
rebuilds the Account, Home, Channel, Owner, and Owner channel detail screens against the new design, which is why M5
now holds conversations alone: every other screen it once listed is built, and the Design phase is where it is
rebuilt. Its first step is the daisyUI and Tailwind install (§3, §9), which no screen can be rebuilt without.
