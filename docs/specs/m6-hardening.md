# Feature spec — M6 Hardening: a sweep of §8

**Status:** **complete 2026-09-22.** The sweep ran, the plan's steps landed, and §8's own rule against
testing UI components was reversed mid-flight, which turned two accepted gaps into two more closures.
**Owns:** the verdict on every criterion in `docs/PRD.md` §8, the gaps that sweep found, and the PRD edits it owes.
**Depends on:** nothing. Every milestone it reads is complete.

M6 is the last milestone and it is a read, not a build (`docs/PRD.md` §10, redefined 2026-09-17). §8 holds the
product's verification criteria and nobody has ever walked them end to end. This spec is that walk: every criterion
marked **tested**, **structural**, or **unverified**, with its evidence named.

## 1. Summary

§8's sixteen bullets carry **91 atomic claims** once each sentence is split into the separate things it asserts.
Swept against the 417 tests `pnpm test` runs across `apps/api/test` and `apps/web/test`, and against the code
that makes the rest true, they fall out as:

| Verdict | At the sweep | After the closures | What it means |
|---|---|---|---|
| **tested** | 75 | **81** | A named test asserts it. The test is named in §3 so a rename is a visible edit here. |
| **structural** | 8 | 8 | No test, and none is owed: the shape of the code makes the claim impossible to violate, and §3 says what shape. |
| **unverified → close** | 4 | 0 | All four closed; §6 says how each one's test is shaped. |
| **unverified → accept** | 3 | **1** | Two of the three were accepted only because §8 forbade component tests. That rule was reversed on 2026-09-22 (PRD §9), so they were closed instead. One remains. |
| *not a criterion* | 1 | 1 | Claim 14.4 was the standing instruction that accepted those two. Half of it is now withdrawn. |

**The sweep changed the rules it was auditing.** Two gaps — the web offering the owner's operations
to the owner alone, and the scope chip's dismissal — were marked *accept* for one reason only: §8
bullet 14 forbade tests for UI components. Writing that down made it obvious that the reason was
the rule rather than the risk, and the owner reversed the rule the same day. A list read against
reality is supposed to produce that.

**The sweep's headline is not a gap; it is a stale claim.** `docs/PRD.md` §10 says §8's first line — "two users
following one channel produce one shared episode/summary/vector set with independent read receipts" — "has no
test", and offers it as the emblem of the whole milestone: *true by construction is exactly what stops being true
after a refactor.* It has had a test since the Auth phase. `apps/api/test/isolation.test.ts` was written in
`5d9f234` and its header says in so many words that it closes PRD §8's first two criteria. The line that named M6's
purpose was answered four days before this sweep started, by a phase that was not looking for it.

That makes **five** documents now found to have outlived their work — after the M4 unread-receipts line, the empty
M5, `chat-origin-scope.md` §5's criterion describing something the product could not do, and the Chats nav item.
The pattern holds: each was found by reading a list against reality, never by running one.

## 2. What a verdict requires

The three words are not opinions, and each has a bar.

**tested** names a test. Not a file — a test, by the string in its `it(...)`. A criterion satisfied by three tests
names three. The bar is that the named test *fails* if the criterion stops holding; a test that merely touches the
same code is not evidence, and where a test covers part of a claim, §3 says which part and the rest gets its own row.

**structural** says what makes the claim impossible to violate, in a sentence a reader can check. "There is no user
dimension on the row" is structural. "We are careful about it" is not. The bar is that violating the claim would
require an edit to a named piece of code, not merely a mistake in using it — a claim that a mistake could break is
unverified, whatever the intent behind the code.

**unverified** is the honest remainder, and it is the category the milestone exists for. It splits by disposition,
not by severity: **close** means a test is owed and the plan writes it; **accept** means no test will be written
and §6 records why, so the next reader inherits the reason rather than the silence.

Nothing is marked by how confident anyone feels. A claim with no named test and no named shape is unverified even
when everybody believes it.

## 3. The ledger

Claims are numbered `B.n` — bullet, then claim within it, in the order §8 writes them. Test names are quoted from
the `it(...)` string; the file is given once per group. Where §8's own wording is wrong, the row says so and §5
carries the edit.

### 3.1 Bullet 1 — two users, one catalog

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1.1 | Two followers of one channel get one shared episode and summary | **tested** | `isolation.test.ts` "shares one episode and summary between followers, with receipts of their own" |
| 1.2 | …with independent read receipts | **tested** | same; `user-reads.test.ts` "keeps receipts through unfollow and isolates them per user" |
| 1.3 | …and one shared **vector** set | **tested** (2026-09-22) | `isolation.test.ts` "retrieves both readers' answers from one shared vector set, keyed to no one" |

### 3.2 Bullet 2 — private state, and the one fact that is public

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 2.1 | No user can inspect another's chats, messages, preferences or receipts | **tested** | `isolation.test.ts` "keeps one reader's chats, messages, preferences and receipts from another"; `routes-chats.test.ts` "keeps one caller's chats out of another's, hence 404 and never 403"; `user-chats.test.ts` "validates content and hides other users' chats"; `routes-preferences.test.ts` "keeps them private per caller" |
| 2.2 | `followerCount` is a fact any caller receives; the addresses are the owner's | **tested** | `authorization.test.ts` "refuses both for a signed-in stranger, and writes nothing" / "answers the owner, and still gives them the addresses"; `visibility.test.ts` "answers following false, read absent and related empty, with followerCount intact" |

### 3.3 Bullet 3 — the owner's operations, and how a channel is added

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 3.1 | The seven catalog operations answer 403 to a non-owner and write nothing | **tested** | `authorization.test.ts` "refuses all seven for a signed-in stranger, and writes nothing" / "allows the owner the same seven" |
| 3.2 | The web offers them to the owner only | **tested in part** (2026-09-22) | `channel-actions.test.tsx`, four cases over `ChannelStatusActions` — the one component that renders these operations — pinning which of them each status and scope offers. The route-level gate (`Guard ownerOnly`) needs a DOM and stays hand-verified; see §6, A1. |
| 3.3 | The acting `user_id` is recorded | **tested** | `registry-channels.test.ts` "records whoever approved"; `routes-channels.test.ts` "approve, decline, pause, and resume are the owner's, and record who acted"; `registry-episodes.test.ts` "records whoever skipped" |
| 3.4 | Handles and ids with no feed are rejected | **tested** | `youtube-ids.test.ts` "rejects handles, other URLs, and junk with the copy-the-id instructions"; `routes-channels.test.ts` "creates a channel only for a real feed" |
| 3.5 | Requesters follow at the moment they request; nothing is auto-followed later | **tested** | `routes-channels.test.ts` "a user's add creates a requested channel and follows them…" |
| 3.6 | Adding an existing channel follows the caller and creates nothing | **tested** | same; `registry-channels.test.ts` "every add creates a requested channel, whoever asks, never twice" |
| 3.7 | A declined id is 409 with the note | **tested** | `routes-channels.test.ts` same test, asserting `ChannelDeclinedResponseSchema` |
| 3.8 | Requesting again makes it requested and follows the caller | **tested** | `registry-channels.test.ts` "decline from requested records the note; request again reopens and keeps it" |
| 3.9 | A follow is one Registry write, so `following`, `followerCount`, the owner's list and eligibility agree | **structural** | `channel_followers` is the only follow record and `do/registry/followers.ts` the only module that writes it; the User DO holds no follow rows. All four reads derive from that one table, so there is no second store to drift. |

### 3.4 Bullet 4 — discovery and the recovery window

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 4.1 | Initial discovery selects five by default and runs once, at first approval, followers or not | **tested** | `ingestion-discovery.test.ts` "performs the initial run at first approval, answers with it, and does nothing on re-approval" / "discovers even when approval pauses the channel for having no followers" |
| 4.2 | Later approvals start none and leave `approved_at` alone | **tested** | `registry-channels.test.ts` "approve sets approved_at once…"; `ingestion-discovery.test.ts` as above |
| 4.3 | First-approval discovery ignores pause | **tested** | `ingestion-discovery.test.ts` "discovers even when approval pauses the channel…" |
| 4.4 | Later discovery skips paused channels | **tested** | `ingestion-discovery.test.ts` "checks approved, unpaused channels only, and one unreadable feed does not stop the others" |
| 4.5 | The first scheduled discovery imports nothing published before `approved_at` | **tested** | `registry-discovery.test.ts` "selects only untracked entries published after the first approval on a scheduled run"; `ingestion-discovery.test.ts` "creates only untracked entries published after the first approval on a later run" |
| 4.6 | Discovery never selects a known episode | **tested** | same ("untracked"); `registry-discovery.test.ts` "dedupes ids within one feed and orders the created episodes newest first" |
| 4.7 | Discovery never checks the transcript provider | **structural** | `recordDiscovery` is a Registry method and has no provider to reach; the one pre-flight lives in `startEpisodeAttempts`, which runs *after* selection and decides only whether to launch. Selection cannot depend on provider health without a new argument. |
| 4.8 | Each newly discovered episode points to the run that created it | **structural** | `episodes.discovered_by_run_id` is `NOT NULL REFERENCES ingestion_runs (run_id)`; an episode with no run cannot be inserted. Foreign keys are asserted on by `registry-migrations.test.ts` "enforces foreign keys and CHECK constraints". |
| 4.9 | Each starts processing immediately, with increasing start delays | **tested** | `ingestion-attempts.test.ts` "spaces a batch three seconds apart, reports a running one, and records a lost launch" |
| 4.10 | Every unfinished non-deterministic outcome stays recoverable 48 h regardless of attempt count, retried six-hourly, reason on the attempt, no wait code on the episode | **tested** | `registry-attempts.test.ts` "keeps an unfinished publication in its window, schedules it six hours later…" / "counts launched attempts only, never making the episode terminal" |
| 4.11 | Then an unpublished episode becomes `failed INGESTION_TIMEOUT` and needs the owner | **tested** | `registry-attempts.test.ts` "schedules at deadline − 1 ms and times out at the deadline, for a publication and for a replacement" |
| 4.12 | Recovery continues for paused and declined channels | **tested** | `ingestion-recovery.test.ts` "starts every due episode under every channel status and pause state, skips the rest, and staggers across channels" |
| 4.13 | Immediate system skips are only `SHORT`, `NON_ENGLISH`, `UNPLAYABLE` | **tested** | `workflow-ingest.test.ts` "orders duration before captions, and never calls an unknown duration short" / "maps provider failures: unplayable skips, exhausted credits wait, the rest fail"; the `skip_reason` CHECK admits only those three and `OWNER` |

### 3.5 Bullet 5 — blocked starts and lost Workflows

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 5.1 | Every blocked start records a finished blocked attempt with `PROVIDER_AUTH` or `PROVIDER_LIMIT`, changing no content and no window | **tested** | `registry-attempts.test.ts` "records blocked starts: automatic ones move the episode or settle it at the deadline, owner ones leave it untouched"; `ingestion-attempts.test.ts` "records a blocked attempt per episode when the provider refuses work, and launches nothing" |
| 5.2 | An episode blocked for its whole window times out with that reason in `failure_detail`, never an empty one | **tested** | `registry-attempts.test.ts` same test, asserting `failureDetail: "PROVIDER_LIMIT"`; `ingestion-recovery.test.ts` "…moving it before the deadline and closing the window at it" |
| 5.3 | `attempt_count` stays at the number of launched attempts | **tested** | `registry-attempts.test.ts` "counts launched attempts only, never making the episode terminal" |
| 5.4 | Catalog and channel episode counts carry no `waiting` number | **structural** | No such field exists to be wrong: `EpisodeCountsSchema` names four statuses and says so in its description, and `do/registry/catalog.ts` derives them from the episode rows. A `waiting` count would be a schema edit, not a bug. |
| 5.5 | A lost Workflow is recorded on its attempt and stays recoverable | **tested** | `ingestion-attempts.test.ts` "…and records a lost launch"; `ingestion-recovery.test.ts` "reconciles running attempts older than an hour: gone and missing finish WORKFLOW_LOST inside the window…" |
| 5.6 | A Retry on a running attempt over an hour old whose instance is gone reconciles inline and starts | **tested** | `ingestion-attempts.test.ts` "refuses a running attempt under an hour old, asks the engine about an older one, and reconciles a lost instance inline" |
| 5.7 | An active one is refused | **tested** | same |

### 3.6 Bullet 6 — Retry, replacement, and derived times

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 6.1 | Owner Retry creates an episode attempt and no channel run or channel write | **tested** | `registry-attempts.test.ts` "works under requested, paused, and declined channels: Retry then a start, channel untouched" |
| 6.2 | A Retry that starts work resets the processing window | **tested** | `ingestion-attempts.test.ts` "reopens the window and starts one attempt at once, in any channel status" |
| 6.3 | An available Retry preserves summary, first availability, receipts and active generation until a replacement succeeds | **tested** | `registry-attempts.test.ts` "replaces content atomically, preserving first availability and handing back the previous generation"; `workflow-ingest.test.ts` "replaces content atomically: old summary and vectors stay until the new generation is verified, then only the new one remains" |
| 6.4 | A deadline leaves it available | **tested** | `registry-attempts.test.ts` "schedules at deadline − 1 ms and times out at the deadline, for a publication and for a replacement" |
| 6.5 | A replacement classified `UNPLAYABLE`/`NON_ENGLISH`/`SHORT` records a skipped attempt and closes the window | **tested** | `registry-attempts.test.ts` "skips a publication on a deterministic result and leaves a replacement's content alone" |
| 6.6 | Declining an approved channel changes no run or episode row | **tested** (2026-09-22) | `registry-channels.test.ts` "declining is a catalog decision: not one run or episode row moves" — both tables snapshotted whole and compared, so any column changing fails it |
| 6.7 | Channel and catalog ingestion times equal the relevant episode `processed_at` maximum | **tested** | `registry-management.test.ts` asserts `lastSuccessfulIngestionAt` and `lastIngestedAt` against seeded `processed_at`, including the null cases, in "summarizes the catalog" / "is empty-safe before anything exists" / "joins channels to their management facts" |
| 6.8 | Owner overview and channel-health counts match the underlying episodes and runs | **tested** | `registry-management.test.ts` "summarizes the catalog" / "counts a failed episode as attention only while its channel is approved" |

### 3.7 Bullet 7 — pause

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 7.1 | Unfollowing to zero followers pauses an approved channel | **tested** | `registry-followers.test.ts` "pauses an approved channel when its last follower leaves and resumes on the next follow" |
| 7.2 | The next follow lifts a system pause | **tested** | same; "recomputes pause on approve: a channel nobody follows reads pausedBy system, and a follow resumes it" |
| 7.3 | An owner pause survives it | **tested** | `registry-followers.test.ts` "never overrides an owner pause and never pauses a requested channel" |
| 7.4 | A requested channel is never paused | **tested** | same; and the CHECK `paused_by IS NULL OR status = 'approved'` |
| 7.5 | A paused channel's summaries stay readable while cron skips it | **tested** | readable: `registry-followers.test.ts` "eligibility is active follows that are approved, paused or not"; skipped: `ingestion-discovery.test.ts` "checks approved, unpaused channels only…" |

### 3.8 Bullet 8 — vector generations

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 8.1 | A partial or replacement generation cannot become chat context until the summary is ready and the generation is atomically activated | **tested** | `registry-attempts.test.ts` "replaces content atomically…"; `workflow-ingest.test.ts` "publishes an English episode: transcript, stage, verify, summarize, related, publish" |
| 8.2 | Inactive generations never enter retrieval | **tested** | `chat.test.ts` "skips a stale generation and promotes a deeper candidate in its place" |
| 8.3 | A replacement leaves only the new generation in the store | **tested** | `workflow-ingest.test.ts` "…then only the new one remains"; "deletes exactly the abandoned generation of a failed attempt before staging its own" |
| 8.4 | A failed cleanup leaves publication standing | **tested** | `workflow-ingest.test.ts` "publishes even when cleanup or the related lookup fails"; `registry-attempts.test.ts` "hands back every generation a past cleanup failed to remove, oldest first" |
| 8.5 | A related-lookup failure still publishes the summary | **tested** | `workflow-ingest.test.ts` same test |

### 3.9 Bullet 9 — scoped messages

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 9.1 | A scoped message retrieves only from its episode | **tested** | `chat.test.ts` "sizes the query by scope and never sends one unfiltered"; `vectorize.test.ts` "keeps only the named episode, across channels the caller also follows" |
| 9.2 | …and only while that episode's channel stays eligible | **tested** | `chat.test.ts` "says an ineligible scope out loud rather than widening to everything" |
| 9.3 | An ineligible hint produces §4.5's explicit reply and never a global answer | **tested** | same; `chat.test.ts` "answers the scoped sentence for a scoped question, naming the episode and not the follows" |
| 9.4 | Dismissing the chip returns the next message to every eligible channel | **tested in part** (2026-09-22) | API half: `user-chats.test.ts` "leaves both messages unscoped when no hint is given". Rendered half: `scope-chip.test.tsx` — no chip at all without a scope, and the line naming every channel the reader follows. The click itself needs a DOM; see §6, A2. |
| 9.5 | A stored hint is never rewritten by later follow changes | **tested** | `chat.test.ts` "a stored hint outlives the follow it was asked under" → "is unchanged after the reader unfollows and follows again" |

### 3.10 Bullet 10 — chats across follow changes

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 10.1 | Existing chats include newly followed channels and exclude unfollowed or declined ones from new retrieval | **structural** | Eligibility is not stored on the chat. It is recomputed per message and passed in as `deps.eligible`, and it gates twice — the query filter and the post-query validation both read that one set. A chat has nothing to go stale. |
| 10.2 | Historical messages and sources remain intact | **structural** | Messages and their citation snapshots are append-only rows in the User DO; no path updates a completed message. The one write after creation is `completes a pending reply … exactly once` (`user-chats.test.ts`). |
| 10.3 | Approving a declined channel restores access for its remaining active followers, not for explicit unfollows | **tested** | `registry-followers.test.ts` "eligibility is active follows that are approved, paused or not" — it declines C, unfollows D, then re-approves C and asserts C returns for its remaining follower while D stays out |
| 10.4 | Every Vectorize call uses `shared-catalog` | **tested** | `vectorize.test.ts` "writes exactly one namespace, which is what lets `clean-local` wipe the dev index whole" / "refuses every other namespace, ids that do not match their metadata, and an oversized topK" |
| 10.5 | Chat queries carry only eligible channel IDs | **tested** | `chat.test.ts` "sizes the query by scope and never sends one unfiltered"; `vectorize.test.ts` "makes a filter naming neither field unrepresentable" |

### 3.11 Bullet 11 — no eligible follows

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 11.1 | With no eligible follows chats stay usable and persist the fixed response without calling AI or Vectorize | **tested** | `chat.test.ts` "answers the fixed reply with no follows, touching neither AI nor Vectorize" |

### 3.12 Bullet 12 — receipts and the digest

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 12.1 | Receipts apply only to summaries returned to that user | **tested** | `routes-channels.test.ts` "answers one episode, and records or undoes its receipt for an eligible caller only" |
| 12.2 | First-follow summaries start unread | **tested** | `routes-follows-digest.test.ts` "refuses only declined channels and lists follows with counts, unread, and status" — a fresh follow reads `unreadCount: 3` |
| 12.3 | Declining and approving again keeps prior read status | **tested** (2026-09-22) | `routes-follows-digest.test.ts` "refuses only declined channels and lists follows with counts, unread, and status" — the round trip now ends by asserting the reader who had read all three still reads zero unread |
| 12.4 | Digest windows use first availability, ordered strictly by it | **tested** | `registry-episodes.test.ts` "orders the digest by first availability, not publication, and bounds the range on it" |
| 12.5 | Shared cross-references are filtered at display time | **tested** | `registry-episodes.test.ts` asserts `relatedScope` narrowing related titles to the caller's channels, and `[]` emptying them |

### 3.13 Bullet 13 — migrations, constraints, and the document

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 13.1 | Migrations run idempotently on a fresh DO | **tested** | `registry-migrations.test.ts` "creates every Registry table on first access and records both migrations" / "is a no-op when run a second time"; `user-migrations.test.ts` the same pair |
| 13.2 | A CHECK rejects an approved channel with no `approved_at` | **tested** | `registry-migrations.test.ts` "ties channel columns to status" |
| 13.3 | A CHECK rejects a paused channel that is not approved | **tested** | same |
| 13.4 | A CHECK rejects a skipped episode with no reason | **tested** | `registry-migrations.test.ts` "ties episode columns to status and the processing window to itself" |
| 13.5 | A CHECK rejects an owner skip with no **email** | **tested, wording stale** | The constraint is `(skip_reason IS 'OWNER') = (skipped_by_user_id IS NOT NULL)` and the test asserts it. There is no email column on that table and has not been since the Auth rekey. §5 carries the edit. |
| 13.6 | `GET /openapi.json` lists exactly the registered routes | **tested** | `openapi.test.ts` "is public and describes every registered route, and nothing else" — enumerated from `app.routes` |
| 13.7 | Each route's responses parse against the shared schemas | **tested** (2026-09-22) | `openapi.test.ts` "builds every success body from the shared schemas, with two flat exceptions" — enumerated from the document, not from a list |

### 3.14 Bullet 14 — what the suite is made of

These four are claims about the test suite rather than about the product, and one of them is an instruction.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 14.1 | Real DO SQLite tests cover migrations and isolation | **tested** | `registry-migrations.test.ts`, `user-migrations.test.ts`, `isolation.test.ts`, all over real DO storage in the Workers pool |
| 14.2 | AI, Vectorize, transcripts, Workflows and YouTube feeds are env-selected fakes; no test reaches the network | **structural** | Each seam refuses to run without a binding or its fake — four "requires a binding or the fake" tests say so — and `vitest.config.ts` sets the pool's `remoteBindings: false`, so a remote binding is not reachable from a test even by mistake |
| 14.3 | Pure-function tests for chunking, RSS/URL parsing and summary validation are retained | **tested** | `chunk.test.ts`, `youtube-rss.test.ts`, `youtube-ids.test.ts`, `summary.test.ts`, `transcripts-vtt.test.ts` |
| 14.4 | Do not add tests for UI components, Hono plumbing, or Workflow step ordering | **not a criterion** | This is a standing instruction, not something to verify. It is also the rule that accepts A1 and A2 in §6, which is why it matters that it lives in §8 rather than only in `AGENTS.md`. |

### 3.15 Bullet 15 — route visibility

The newest bullet (2026-09-21) and the best covered: it was written with its tests.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 15.1 | With no `Authorization` header the five public reads answer 200 | **tested** | `visibility.test.ts` "answers 200 to a caller with no Authorization header at all" |
| 15.2 | `management` is absent from the channel list and detail | **tested** | `visibility.test.ts` "omits management from the channel list and the channel detail" |
| 15.3 | `processing` is absent from every episode shape while `waitReason`, `status`, `skipReason` stay | **tested** | `visibility.test.ts` "omits processing from every episode shape, and keeps what a reader is owed" |
| 15.4 | `following` false, `followerCount` unchanged, `read` absent, `related` empty | **tested** | `visibility.test.ts` "answers following false, read absent and related empty, with followerCount intact" |
| 15.5 | With any session all four reappear — `management` is not owner-only | **tested** | `visibility.test.ts` "gives all four back to any session, not only the owner's" |
| 15.6 | A stale or malformed token gets the anonymous view, not a 401 and not a 500 | **tested** | `visibility.test.ts` "treats a stale or malformed token as anonymous rather than refusing it" |
| 15.7 | `GET /catalog` and `GET /channels/:id/followers` answer 403 to a signed-in non-owner and 200 to the owner, writing nothing | **tested** | `authorization.test.ts` "the two owner reads" — both cases |
| 15.8 | `GET /openapi.json` marks exactly nine operations public and nine owner-only, listed rather than counted | **tested** | `openapi.test.ts` — `PUBLIC` is `PUBLIC_BY_NECESSITY` (4) ∪ `PUBLIC_READS` (5), and `OWNER_ONLY` lists nine; "documents 403 on the nine owner operations and nowhere else" |
| 15.9 | Every non-public route still answers 401 with no session, enumerated from the router | **tested** | `visibility.test.ts` "still answers 401 to a caller with no session — every one of them" |
| 15.10 | `GET /channels/feed` still reads the feeds rather than being swallowed by the public `GET /channels/:id` | **tested** | `visibility.test.ts` "still reads the feeds, rather than being swallowed by the public /channels/:id" |

### 3.16 Bullet 16 — the gates

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 16.1 | `pnpm check` is the finish gate | **structural** | A process rule, enforced by `AGENTS.md` and `CLAUDE.md` and by `turbo run typecheck lint test` being one command. Nothing in the repo can assert that a human ran it. |
| 16.2 | Runtime behavior, especially transcript fetching, is also exercised under `wrangler dev` | **unverified → accept** | Most chunks carry a walkthrough record in their plan; several were explicitly skipped, and the record is prose in scattered files rather than a list. See §6, A3. |

## 4. What the sweep found, beyond the ledger

**The emblem was already answered.** §1 covers it: `isolation.test.ts` closed §8's first two criteria during the
Auth phase, and `docs/PRD.md` §10 still names the first as M6's reason for existing. The milestone's own
justification had outlived its work — which is, precisely, the thing the milestone was defined to find.

**§8 is in better shape than its reputation.** 75 of the 90 verifiable claims carry a named test, and the eight
structural ones are genuinely structural rather than hopeful. The bullets written alongside their implementation — route visibility,
the attempt ledger, vector generations — are covered claim for claim. The gaps cluster in two places: the seams
between two subsystems (a decline's effect on episodes; a receipt's survival across a channel's status change),
and the places where a list is trusted rather than enumerated.

**Both remaining kinds of gap are the same mistake.** G2, G3 and G4 are all "nobody checked the thing next door":
a decline is tested for what it changes and not for what it leaves, a receipt is tested through unfollow and not
through decline, and route shapes are checked one at a time with no list saying which. `openapi.test.ts` already
knows the cure and applies it to routes — enumerate from the router, not from a list someone keeps.

**One criterion describes a column that does not exist.** 13.5's "an owner skip with no email" survived the Auth
rekey, which replaced `skipped_by_email` with `skipped_by_user_id`. The constraint is right and tested; only §8's
sentence is wrong. It is a small edit and a familiar shape: the rekey's spec claimed the PRD needed no change.

## 5. The PRD edits this sweep owes

| # | Where | Edit | Status |
|---|---|---|---|
| E1 | §8 bullet 13 | "an owner skip with no email" → wording naming a user, the column being `skipped_by_user_id` since the Auth rekey (2026-09-20) | **applied** 2026-09-22 |
| E2 | §10, the M6 paragraph | Strike "§8's **first line** has no test"; it has had one since `5d9f234`. Recorded as the fifth document to outlive its work, keeping the argument — true by construction is what stops being true after a refactor — because it is still why 1.3 got a test. | **applied** 2026-09-22 |
| E3 | §9 | Record the sweep: the counts, the gaps closed, the one accepted, and the date. | **applied** 2026-09-22 |
| E4 | §10, the milestone block | Mark M6 complete. | **applied** 2026-09-22 |
| E5 | §8 bullet 14, §9 | **Added mid-flight:** reverse "do not add tests for UI components". The sweep had accepted two gaps for that reason alone. | **applied** 2026-09-22 |

**Seven more corrections came out of the same read**, once "feature development is complete" made
every document fair game. They are not §8's and are recorded in the commit rather than here: PRD §3
said "User DO per email" while its own Stack table said `user_id`; §1 still admitted "the Pages web
app" through CORS a day after the web left Pages; §7 headed a bullet "Sign in `/`" against its own
prose; `AGENTS.md`'s repo layout named five web screens that no longer exist and omitted eleven
specs; `wrangler.jsonc` named "the Pages preview origin"; `index.ts` said twice that nothing
consumes the session yet; and `ScopeChip.tsx` described a `?about=` URL parameter that appears
nowhere in the codebase.

## 6. The gaps, and their disposition

Four to close and three to accept, at the sweep. Then §8 bullet 14 was reversed and two of the
three became closures too: **six closed, one accepted.** The disposition rule the owner set on
2026-09-22: close it with a test where closing is cheap; accept where a test would be theatre, and
record the reason.

### Closed

**G1 — 1.3, the vector half of §8's first line.** Two followers share one episode and one summary,
both tested; the vector set was asserted nowhere. Closed by a third case in `isolation.test.ts`:
both readers ask the same question, and the test wraps the store to capture every namespace and
filter it is asked for. It asserts the sources match, the episode's one `activeVectorGeneration` is
what both read, and — the point — that the filter names channels and contains neither reader's
address. A per-user namespace would have given both of them answers too, and broken the promise
silently.

**G2 — 6.6, declining changes no run or episode row.** Closed in `registry-channels.test.ts` by
snapshotting `ingestion_runs` and `episodes` whole, declining, and comparing the whole snapshot.
The criterion claims an absence, so the test looks at the absence rather than at a column somebody
thought of; any change to any row fails it.

**G3 — 12.3, read status across decline and approve.** One assertion, added where the existing
round trip ends: the reader who had read all three still reads zero unread once the channel comes
back. The unread side was already there.

**G4 — 13.7, every success shape, enumerated.** **The plan's shape for this was wrong and the step
found it**, which is why it was given a step of its own. The plan assumed each success response
would be a `$ref` to a shared component; the document actually **inlines each route's wrapper
object** — `{ channels: [...] }` — and `$ref`s the entities inside it. So the honest rule is not
"the response is a component" but "the response is *built from* components", and it is enumerable:
**31 operations reference a shared component, two are flat, two answer only 302.** The two flat
ones still come from `packages/shared` — `HealthResponse` is a status string and
`SessionExchangeResponse` is the token — they simply have no member worth a component. Both lists
are named rather than counted, so a route that invents an entity shape inline appears as a new name
somebody has to justify. The test also checks that every component a success body names is one the
document declares.

**G5 — 3.2, the web offers the owner's operations to the owner only.** Was A1; closed once the rule
allowed it. `ChannelStatusActions` is the only component that renders approve, decline, pause,
resume and Check feed, so what it offers *is* what the product offers.
`apps/web/test/channel-actions.test.tsx` pins that across status and scope: nothing at all beside a
channel that is not approved, the two reversible knobs beside an approved one, the decisions only
where the scope is `everything`, and every glyph carrying its name. **Not covered:** the
route-level `Guard ownerOnly` on Curate, which resolves through context and an effect and needs a
DOM — see A1 below.

**G6 — 9.4, dismissing the scope chip.** Was A2. The API half was already tested; the rendered half
is now `apps/web/test/scope-chip.test.tsx` — the chip renders to the empty string with no scope
(the dismissed state is the *absence* of the control, not an empty one), it names its episode and
offers a labelled way out, it escapes a title that is YouTube's rather than ours, and the line
beneath the composer says which of the two searches is in force. **Not covered:** the click.

### Accepted

**A1 — the route-level owner gate, and interaction generally.** `Guard ownerOnly` redirects a
non-owner through a `useEffect`, which render-to-string does not run, and `useSession` needs a
context the module does not export. Testing it would mean either exporting internals for the test
or taking the DOM dependency the owner declined on 2026-09-22. **Accepted:** the consequence is a
bad screen, never an unauthorized write — the API answers 403 to anyone but the owner, and
`authorization.test.ts` covers all nine operations. Interaction stays hand-verified under
`pnpm dev`, which `AGENTS.md` → Web UI code has always required.

**A2 — the chip's click, and the composer's state.** Same reason, same boundary. Retrieval is
filtered by eligibility whatever the chip says, so the consequence is a message sent at the wrong
scope, not a leak.

**A3 — 16.2, the `wrangler dev` exercise.** A process claim about work already done. The record is
prose across a dozen plans, several of which say the walkthrough was skipped. No test can assert
it and reconstructing the history would be archaeology. **Accepted**, with the honest note that the
claim is true of most chunks and not all, and that the plans say which.

## 7. Acceptance criteria

1. Every one of §8's 91 claims carries a verdict in §3, and every **tested** verdict names a test that exists.
2. The four gaps in §6 are closed by tests that fail when their claim stops holding, and `pnpm check` passes.
3. The three accepted gaps are recorded in §6 with the reason each was accepted, not merely listed.
4. The four PRD edits in §5 are applied, including striking the stale sentence in §10 that made §8's first line
   M6's emblem.
5. `docs/PRD.md` §10 marks M6 complete, and says what the sweep found rather than only that it happened.
6. No product behaviour changes. M6 adds tests and edits documents; if a gap turns out to be a real defect rather
   than a missing test, it stops being M6's and gets its own decision.

## 8. Out of scope

- **Fixing anything the sweep finds broken.** The sweep's output is a verdict, not a repair. A criterion that turns
  out to be *false* rather than untested is a defect, and it gets its own spec.
- **The criteria in the specs under `docs/specs/`.** §8 is the list M6 was defined around. The known outstanding
  one — `chat-origin-scope.md` §5 criterion 19's second half, that `Try again` sends a new attempt and keeps the
  failed reply above it — is named in §10 and stays open; it is a UI control and falls under A1's rule anyway.
- **Re-testing what is already tested.** 74 claims have tests. This sweep names them; it does not rewrite them.
- **A machine-checked ledger.** Keeping §3's test names in step with the suite by hand is a known cost, accepted:
  the alternative is a test file that is half prose, and §3 is read by people deciding what to trust.

## 9. `AGENTS.md` and PRD alignment

`AGENTS.md` needs no edit: M6 adds no module, no route, no dependency and no convention. The four PRD edits are in
§5. `docs/design.md` is untouched — nothing here is a design decision.
