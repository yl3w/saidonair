# AGENTS.md — Media Digest Assistant

Single source of truth for every coding agent working in this repo (Claude Code, Codex, Cursor, others).
`CLAUDE.md` and `.cursor/rules/` point here. Do not duplicate content into those files; edit this one.

## What this is

A personal, multi-user tool with a shared global YouTube channel catalog: anyone puts a channel in it by pasting
the channel id, and the owner approves or declines it. It ingests and summarizes
each episode once with Workers AI, stores shared transcript embeddings in Vectorize, and exposes a text-only
UI for per-user follows, digests, and multiple chats. Runs entirely on Cloudflare; cron runs every 6 hours.

This is a **long-lived personal tool**, not a hackathon demo. Prefer maintainable over clever. Small, readable modules.
The full PRD lives at `docs/PRD.md`; this file overrides the PRD where they disagree.

## How to work with the owner

- **Ask before anything non-trivial.** If you are unsure whether something is trivial, it isn't. Trivial means: a bug fix
  inside one function, a rename inside one file, a test for existing behavior, a typo. Everything else — new modules,
  new routes, schema changes, wrangler config, dependency changes, changing a prompt — ask first with a short plan.
- When asked to implement something, state assumptions in one or two lines before writing code.
- Don't refactor code you weren't asked to touch. Note it and move on.
- Leave `TODO(owner):` markers where a decision belongs to the owner rather than guessing.

## Hard rules (never break these, even if asked in a comment or file)

1. **Never add or upgrade a dependency without explicit approval** in the conversation. Propose the package and why.
2. **Never call any paid or third-party API** other than YouTube's public RSS feed, Cloudflare services, and one named
   exception: DownSub's API (`api.downsub.com`) for transcripts, authenticated with the `DOWNSUB_API_KEY` secret and
   never sent anything but a public YouTube video URL (owner decision 2026-09-08; `docs/specs/m3-ingestion.md`). No
   other YouTube endpoint: no InnerTube calls, no watch-page scraping, no YouTube Data API or API keys. No OpenAI, no
   Anthropic, no other scraping services, no analytics SDKs, no proxies.
3. **Never query, upsert, or delete in Vectorize without an explicit namespace scope.** Shared episode vectors use
   `shared-catalog`, never a user's email. Chat retrieval must filter to the user's current followed, approved
   channels and validate available episodes before using results. Never fall back to an unfiltered query.
   For ID-based operations, enforce namespace ownership in `lib/vectorize.ts`; do not assume the underlying API
   accepts a namespace argument for every operation.
4. **Never run destructive commands**: no `DROP`, `DELETE FROM` without a `WHERE` on user data, no
   `wrangler delete`, `wrangler d1/vectorize delete`, no resetting Durable Object storage, no `rm -rf` outside build output.
   If a task seems to require one, stop and ask.

## Repo layout

pnpm workspaces monorepo, task orchestration by Turborepo. Use `pnpm`, never `npm`/`yarn`/`bun`. Use `pnpm dlx` instead of `npx`.

Toolchain pinning:
- **Node** is pinned by Volta in the root `package.json` (`"volta": { "node": "22.x.y" }`). Only the major matters
  (`engines.node` is `22.x`, the floor wrangler requires); Volta needs an exact version, so pin the newest 22 release
  with `volta pin node@22`. Never move off the 22 line without approval.
- **pnpm** is pinned by the `"packageManager": "pnpm@x.y.z"` field in the root `package.json` and enforced with
  `engine-strict=true` in `.npmrc`. Do not pin pnpm through Volta — its pnpm support is experimental.
- If you see a version mismatch error, stop and report it; do not work around it by switching tools.

```
.
├── AGENTS.md                 # this file
├── CLAUDE.md                 # pointer to AGENTS.md
├── .cursor/rules/            # pointer to AGENTS.md
├── docs/PRD.md
├── docs/specs/               # accepted feature specs with their -plan.md: home-read-experience (Home and Owner UX), api-reference (OpenAPI + Scalar), m3-ingestion, channel-simplification (channel statuses, follows, episode states)
├── package.json              # workspace root: volta.node, packageManager, turbo scripts
├── pnpm-workspace.yaml
├── .npmrc                    # engine-strict=true
├── turbo.json                # build / typecheck / lint / test / dev pipelines
├── skills/                   # agent skills (Agent Skills standard), one directory per skill; see Commands
├── apps/
│   ├── api/                  # Cloudflare Worker: Hono router, Durable Objects, Workflows, cron
│   │   ├── src/
│   │   │   ├── index.ts              # Worker entry: fetch + scheduled handlers, Hono app
│   │   │   ├── env.ts / bindings.d.ts # Hono AppEnv + hand-maintained Cloudflare.Env (no generated types)
│   │   │   ├── middleware/user.ts    # X-User-Email → registry + per-user DO stub on context
│   │   │   ├── middleware/owner.ts   # requireOwner, applied per owner-only operation; the Registry re-checks the role too
│   │   │   ├── middleware/errors.ts  # typed Registry errors (and Hono's malformed-JSON 400) → HTTP status
│   │   │   ├── routes/               # one file per entity (me, catalog, channels, digest, follows, chat, ...);
│   │   │   │                         # every handler carries describeRoute + validate; docs.ts is the Scalar page
│   │   │   ├── do/registry.ts        # Global Registry Durable Object (RPC facade)
│   │   │   ├── do/registry/          # Registry store modules: users, channels, followers, episodes, runs, catalog, types
│   │   │   ├── do/migrations.ts      # shared SQLite migration runner
│   │   │   ├── do/user.ts            # Per-user Durable Object (RPC facade)
│   │   │   ├── do/user/              # User store modules: follows, reads, chats, preferences, types
│   │   │   ├── workflows/ingest.ts   # per-episode ingestion Workflow: one instance per episode of a run
│   │   │   ├── lib/youtube/          # ids.ts (id validation, /channel/UC… extraction), rss.ts (feed verification,
│   │   │   │                         # title, episodes); nothing else in the codebase talks to YouTube
│   │   │   ├── lib/eligibility.ts    # active follows ∩ approved channels (digest, follows, episodes, chat)
│   │   │   ├── lib/channel-view.ts   # the one projection from the Registry channel onto the shared Channel (+ management)
│   │   │   ├── lib/episode-view.ts   # the one projection from the Registry episode onto the shared Episode
│   │   │   ├── lib/validation.ts     # validate(target, schema): hono-openapi validator with the INVALID_INPUT 400 contract
│   │   │   ├── lib/openapi.ts        # the document's fixed parts (info, tags, security) and describeRoute response helpers
│   │   │   ├── lib/cors.ts           # browser origins allowed to call the API, from vars.WEB_ORIGINS
│   │   │   ├── lib/ingestion.ts      # the start handler: feed, selection, run row, fan-out (log-only until M3)
│   │   │   ├── lib/email.ts          # identity normalization (pure)
│   │   │   ├── lib/errors.ts         # DomainError (both DOs) + code recovery across RPC
│   │   │   ├── lib/sql.ts            # bound-parameter chunking for DO SQLite
│   │   │   ├── lib/chunk.ts          # transcript chunking (pure)
│   │   │   ├── lib/ai.ts             # Workers AI wrappers: embed, summarize, chat
│   │   │   ├── lib/vectorize.ts      # namespaced upsert/query helpers
│   │   │   ├── lib/workflows.ts      # ingestLauncher(env): the one path to INGEST_WORKFLOW (create, status); WORKFLOW_FAKE in tests
│   │   │   ├── lib/transcripts/      # index.ts transcriptSource(env): fake | downsub; downsub.ts adapter; vtt.ts cue
│   │   │   │                         # parser; types.ts (TranscriptSource, TranscriptError, the track rule)
│   │   │   └── prompts/              # prompt templates as .ts exporting functions; summary.ts carries prompt_version
│   │   ├── migrations/               # DO SQLite migrations (see Schema)
│   │   ├── test/                     # setup.ts wipes the Registry after each test
│   │   ├── .dev.vars.example         # copy to .dev.vars (gitignored) for OWNER_EMAIL
│   │   ├── wrangler.jsonc
│   │   └── vitest.config.ts
│   └── web/                  # Cloudflare Pages: Vite + Preact + TypeScript text UI
│       ├── src/
│       │   ├── main.tsx              # mount + router
│       │   ├── api.ts                # typed fetch wrapper; sets X-User-Email
│       │   ├── account.ts            # selected email + recent emails in localStorage
│       │   ├── session.tsx           # GET /me once; role is for rendering only
│       │   ├── lib/                  # time.ts (relative times), copy.ts (channel status, episode, skip and wait phrases),
│       │   │                         # use-load.ts (per-section loading/error state)
│       │   ├── screens/              # Account.tsx, Home.tsx, Channel.tsx, Owner.tsx, OwnerChannel.tsx
│       │   └── components/           # Nav, Time, EpisodeItem, OwnerCard, Digest, ChannelList, RequestQueue, AttentionList,
│       │                             # CatalogHealth, CatalogTable, AddChannel, Chat (M4)
│       ├── index.html
│       └── vite.config.ts
└── packages/
    └── shared/               # Zod schemas for every API request/response shape (XSchema) and the types inferred
                              # from them (X); api validates and documents with the schemas, web imports the types only
```

If a file doesn't exist yet, create it at the path above rather than inventing a new location.

## Stack (fixed — do not substitute)

| Concern | Choice |
|---|---|
| Runtime | Cloudflare Workers, `compatibility_date` pinned in `wrangler.jsonc`, `nodejs_compat` enabled |
| HTTP | Hono |
| Validation and API document | Zod 4 schemas in `packages/shared` (types inferred from them); `hono-openapi` generates OpenAPI 3.1 at `GET /openapi.json`; Scalar test client at `GET /docs` (see `docs/specs/api-reference.md`) |
| State | Durable Objects with SQLite storage (`new_sqlite_classes` migration) |
| Orchestration | Cloudflare Workflows for ingestion, one instance per episode; Cron Trigger in the same Worker |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Embeddings | Workers AI `@cf/baai/bge-base-en-v1.5` (768 dims, 512-token input limit; the deployed model id carries `.5`, corrected 2026-09-08) |
| Vectors | Vectorize index `media-rag`, 768 dimensions, cosine, `namespace: shared-catalog`, metadata indexes on `channelId` and `videoId` (see Setup) |
| Transcripts | DownSub's API behind `lib/transcripts/` (`DOWNSUB_API_KEY` secret); a canned fake in tests (`TRANSCRIPTS_FAKE`). See the transcript contract |
| UI | Cloudflare Pages, Vite + Preact + TypeScript, `preact-iso` for routing, text only |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true`, ESM only |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |
| Formatting/lint | Biome (single config at root) |
| Tasks | Turborepo, local cache only (no remote cache) |
| Toolchain | Volta pins Node; `packageManager` field pins pnpm |

## One-time setup (owner runs these; agents may propose, not run)

```
wrangler vectorize create media-rag --dimensions=768 --metric=cosine
wrangler vectorize create-metadata-index media-rag --property-name=channelId --type=string
wrangler vectorize create-metadata-index media-rag --property-name=videoId   --type=string
wrangler secret put DOWNSUB_API_KEY   # the transcript source (transcript contract); in .dev.vars locally
```

The metadata indexes **must exist before the first upsert** — vectors inserted earlier are not filterable on those
fields and would have to be re-upserted. Chat requires `channelId` filtering from its first release.

## Commands

Run everything from the repo root through Turborepo. Workspace-level `pnpm --filter` is for ad-hoc debugging only.

```
pnpm install
pnpm dev            # turbo run dev --parallel: wrangler dev (api) + vite (web)
pnpm build          # turbo run build: shared → web (vite) ; api has no build step
pnpm typecheck      # turbo run typecheck
pnpm lint           # turbo run lint (biome check)
pnpm test           # turbo run test
pnpm check          # turbo run typecheck lint test — the pre-finish gate
pnpm --filter api deploy
pnpm skills:install --agent <agents…>   # copy skills/ into those agents' directories; see below
```

Agent skills live in `skills/<name>/SKILL.md` following the Agent Skills standard (agentskills.io): standard frontmatter
only, no agent-specific syntax in the body. They are installed into each developer's agent directory with the Vercel
`skills` CLI and never committed there:

```
pnpm skills:install --agent claude-code     # -> .claude/skills/   (Claude Code)
pnpm skills:install --agent codex cursor    # -> .agents/skills/   (Codex, Cursor, Copilot, and other .agents readers)
```

The CLI copies `skills/` into the first agent directory and symlinks any further agents to that copy, so re-run it
after editing anything under `skills/`. `.claude/skills/`, `.agents/skills/`, and `skills-lock.json` are generated and
gitignored. `skills:install` is a root-only tooling script, not a Turborepo task; it pins the `skills` CLI version, so bump
it deliberately (recent releases need Node 22.20+, which the 22 line satisfies).

Skills so far: `clean-local-do` wipes local `wrangler dev` Durable Object state (`apps/api/.wrangler/state/v3/do/`
only, never deployed state). Hard rule 4 still applies, so agents run it only when the owner asks in so many words.

`turbo.json` conventions: `build` depends on `^build` (so `packages/shared` builds first); `typecheck`, `lint`, `test`
depend on `^build`; `dev` is `persistent: true, cache: false`. Add a new task to `turbo.json` and to the root
`package.json` scripts together — never one without the other.

Before declaring a task done: `pnpm check` must pass, and anything touching
Workers runtime behavior must have been exercised under `wrangler dev`, not only Node.

## Identity model

- Users are identified by the `X-User-Email` request header. There is **no authentication** and none should be added.
- Browser clients on another origin (the Pages web app, Vite locally) are allowed by CORS from `WEB_ORIGINS` in
  `wrangler.jsonc` `vars` (overridable in `.dev.vars`): comma-separated origins, `scheme://*.host` for any subdomain
  (Pages previews). Unset means the local Vite origins. No credentials are involved, so this is hygiene, not a guard;
  `lib/cors.ts` runs first so preflights never reach the identity middleware.
  This is trusted, personal use. Do not add login, sessions, JWTs, or Cloudflare Access unless the owner asks.
- Middleware normalizes the email (trim, lowercase), **auto-registers unknown emails** in the Global Registry DO,
  and attaches the per-user DO stub (`env.USER_DO.idFromName(email)`) to Hono context as `c.var.user`.
- Registration creates an identity, not an ingestion subscription. Cron iterates shared catalog channels, not users.
- Private read status, preferences, chats, messages, and citations live in the user's DO. Global identities, channels,
  episodes, and shared summaries live in the Registry DO. Follow membership is recorded in both (decided 2026-09-10):
  the User DO's `channel_follows` is what the user's own list shows, and the Registry's `channel_followers` lets it
  count a channel's followers, list who is waiting on a requested one, and pause a channel nobody follows. Every
  channel in the catalog, requested or approved, is visible to everyone. Never expose another user's private DO data.
- Only the owner can approve, decline, pause, and resume a channel, or retry and skip an episode. Anyone can add a
  channel to the catalog, request a declined one again, and follow any requested or approved channel.
- The owner is whoever has `role = 'owner'` in `global_users`. The deployment seeds that role from the `OWNER_EMAIL`
  secret (`apps/api/.dev.vars` locally, copied from `.dev.vars.example`; `wrangler secret put OWNER_EMAIL` when deployed)
  every time the Registry DO starts. Seeding promotes and never demotes, so more owners can be granted later. Owner-only
  Registry DO methods take the acting email and verify the role themselves; routes are not the only check. The email is
  never committed. This is still not authentication.

## Data & schema conventions

The agreed logical schema, keys, and indexes are in `docs/PRD.md` §5. Implement it using these conventions:

- Schema lives in `apps/api/migrations/` as numbered SQL files: `0001_init.sql`, `0002_add_x.sql`, …
  One file per DO class subdirectory: `migrations/registry/`, `migrations/user/`.
- Each DO runs pending migrations on first access in `blockConcurrencyWhile`, tracked in a `_migrations` table.
- Migrations are **additive only**: `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`.
  Never drop, rename, or change a column type in a migration without owner approval. Deprecate instead.
- Never edit a migration file that has been committed. Add a new one. The initial migrations were rewritten once, on
  2026-09-10 before first deployment, with owner approval (`docs/specs/channel-simplification.md` §6); from then on
  the additive-only and frozen-file rules apply without exception. One drop has been approved since:
  `0002_drop_lifecycle_version.sql` (2026-09-11) removes `lifecycle_version` from `channels` and `ingestion_runs`
  as a new file, with `0001` untouched (`docs/specs/m3-ingestion.md` §2 "Decline mid-run").
- `snake_case` for tables and columns. Every table has `created_at INTEGER` (unix ms). Use `TEXT` for ids.
- The single Registry DO owns `global_users`, `channels`, `channel_followers`, `episodes`, `episode_summaries`,
  `ingestion_runs`, and `ingestion_run_episodes`. One User DO per normalized email owns `channel_follows`,
  `summary_reads`, `chats`, `chat_messages`, `chat_message_sources`, and `user_preferences`.
- Enforce local foreign keys and transactions. References across DOs are validated through DO methods; there are
  no cross-DO SQL joins or atomic transactions. Do not copy shared episodes or summaries into each User DO.
- DO SQLite accepts at most 100 bound parameters per statement (verified against workerd 2026-09-07). Chunk
  `IN (...)` lists and multi-row writes with `lib/sql.ts`; never interpolate ids into SQL instead.
- Transcript text lives once as shared Vectorize chunk metadata, not in SQLite. Stable vector IDs make retries
  idempotent; “once” means one canonical stored copy, not a promise of exactly-once external API execution.
- Users have zero or more independent chats. Each chat uses its own history and the user's current follows;
  there is no chat-to-channel membership table. Retain the nullable `chat_messages.channel_id` as null for global chat.
- A summary is unread until actually returned by `GET /digest` or viewed on its channel screen. Store read receipts
  in the User DO's `summary_reads`; absence means unread. Existing summaries start unread on first follow.
  Preserve read receipts through unfollow, decline, and re-approval.
- Retain chats, messages, follow tombstones, episodes, summaries, and vectors. Deletion is soft; channels are never
  deleted at all, softly or otherwise — declining is a status and keeps everything the channel produced (see Catalog).

## Catalog, approval, and follows

The model is `docs/specs/channel-simplification.md` §3, decided 2026-09-10.

- Users supply the channel id: a bare `UC…` id or any URL containing `/channel/UC…` (on YouTube: channel page → About →
  Share channel → Copy channel ID). `@handle` and `/c/…` URLs are rejected with `INVALID_INPUT` and those instructions;
  there is no handle resolution (decided 2026-09-07). `POST /channels` validates the id offline and then fetches its
  RSS feed: 404 means no such channel (`INVALID_INPUT`); success supplies the channel title, which the owner may
  override with `title`.
- **Channel statuses are `requested | approved | declined`.** The status is the owner's answer about catalog
  membership; import outcomes live on episodes only. There is no `deleted_at`, no channel failure code, no channel
  waiting code, no channel retry, and no restore. Every channel in the catalog is visible to everyone, and a channel
  whose episodes all skip is simply an approved channel with `episodes.available = 0`.
- **Anyone adds a channel.** `POST /channels` creates it and follows the caller. A user's add creates `requested`; the
  owner's add creates `approved` with `approved_at` and the review fields, starts the initial import, and follows the
  owner too. `createChannel` in the Registry is create-only (`db26c74`), so when the id already exists the route
  follows rather than failing: 200 for a `requested` or `approved` channel, and 409 `INVALID_STATE` for a `declined`
  one carrying `channelId`, `status`, `reviewNote`, and `reviewedAt` so the UI can show the note and offer
  **Request again**.
- **Request again.** `POST /channels/:id/request`, anyone, `declined` only: back to `requested`, keeping the review
  fields so the queue can show "previously declined", and following the caller. This is the only way out of
  `declined` for a user, and the client confirms it once after showing the owner's note and date.
- **Approve.** `POST /channels/:id/approve { title?, initialImportCount?, explanation? }`, owner, from `requested` or
  `declined`. Sets `approved`, the review fields, and `approved_at` when it was null. The initial import starts only
  on that first approval, whether or not anyone follows yet; a re-approved channel waits for the next scheduled run
  and `approved_at` does not move. Approving recomputes pause from the follower count, so a channel nobody follows is
  paused by the system straight away while its one initial import still runs.
- **Decline.** `POST /channels/:id/decline { explanation? }`, owner, from `requested` or `approved`. Sets `declined`
  and the review fields and clears any pause. A run in flight is not stopped: it finishes, and eligibility hides what
  it produced from readers until the channel is approved again, while the owner keeps seeing it (decided
  2026-09-11; nothing is fenced). Episodes, summaries,
  vectors, follows, and read receipts are kept. Copy reads "Declined" when `approved_at` is
  null and "Withdrawn" when it is not; declining an approved channel confirms once, naming the follower count.
- **Pause and resume.** `POST /channels/:id/pause` and `POST /channels/:id/resume`, owner, `approved` only.
  `paused_by` is `owner` or `system`, always with `paused_at`. Pause stops new run selection only: a running run
  finishes, and summaries stay readable in digest, channel history, and chat.
- Initial import defaults to the five most recent RSS entries; `initial_import_count` is a positive count set when the
  channel is added or approved.
- **Follows.** `PUT /follows/:channelId` takes any `requested` or `approved` channel and answers 409 with the note for
  a `declined` one; it writes the User DO first, then `registry.recordFollow`. `DELETE /follows/:channelId` mirrors it
  with `recordUnfollow` and works on any status. Both writes are idempotent, and a pair left inconsistent by a failure
  is corrected by the next follow or unfollow of that pair. The User DO stays the source of truth for the user's own
  list, the Registry for counts and the owner queue. `POST /channels` and `POST /channels/:id/request` perform the
  same two writes.
- **Automatic pause.** `recordUnfollow` counts the channel's active followers inside the same Registry call; at zero
  on an `approved` channel it sets `paused_by = 'system'` unless the owner has paused it. `recordFollow` clears a
  `system` pause and never an `owner` one; owner resume clears either. A `requested` or `declined` channel is never
  paused.
- **Eligibility** (`lib/eligibility.ts`, hard rule 3): active follows ∩ `status = 'approved'`. Paused channels stay
  eligible, so their existing summaries remain readable and searchable. Requested channels have no content yet;
  a declined channel is excluded by status, and its followers keep the row and see episode titles with no summaries.
- Unfollow sets `unfollowed_at`; it never removes the catalog channel, and an explicit refollow clears it. There is no
  automatic follow: requesters follow at the moment they request, so `UserDO.autoFollow`, the approval sweep, and the
  `channel_requests` table are gone.

## Ingestion pipeline

First approval, owner episode retry, owner Start, or cron → a Worker handler, never a Workflow, fetches the feed,
selects the episodes, writes the run and its selection to the Registry in one transaction, and creates one Workflow
instance per selected episode, id `${runId}-${videoId}` (decided 2026-09-11; `docs/specs/m3-ingestion.md` §2 "Unit
of execution"). Per instance: stagger → fetch transcript through `lib/transcripts/` → classify → chunk → embed →
upsert in `shared-catalog` → verify → summarize → write the shared summary and mark the episode `available`. An
instance makes exactly three kinds of Registry write, `markTranscript`, `completeEpisode`, and `failEpisode`; each
updates the episode and its run-episode row together, is accepted only while the run is still open, and closes the
run when no run-episode is still `selected`. Instances never fetch the feed, select, or touch channel status.
Following never launches per-user ingestion or duplicates vectors/summaries. The handler, the Workflow, and the cron
are M3; until then `lib/ingestion.ts` records each start point as a
`{ event: "ingestion.start_requested", channelId, reason }` log line, with reasons `channel_approved` and
`episode_retry`, so the call sites are already in place and visible under `wrangler dev`.

- **Cron schedule:** every 6 hours, `0 */6 * * *` UTC (owner decision 2026-09-08), in `wrangler.jsonc` `triggers.crons`.
  Scheduled runs select channels with `status = 'approved'`, `paused_by IS NULL`, and no queued or running run — so
  follower count reaches selection only through pause. A paused channel is skipped, not failed; a declined one is
  excluded by status. Per channel: new feed entries plus every `pending` episode, waiting or below three attempts,
  including selected episodes that have since left the RSS feed. A feed entry is new when it is untracked and
  published after the channel's `approved_at`, so the first cron after approval never imports the older entries the
  initial import left out. Elapsed time alone never settles a wait: a fresh no-caption result is fetched again at or
  after 48 hours before the episode is classified. A tick numbers the instances it creates across every channel and
  the k-th sleeps k × 3 seconds before its first call; like every start, it reads DownSub's `/status` first and
  starts nothing while credits are zero or the key is rejected (decided 2026-09-11). Every start attempt records a
  run: when the selection is empty or the feed cannot be read, the run is inserted already `completed` with no
  run-episodes, and `last_checked_at` moves only when the feed was read, so an unreadable feed shows as runs that
  keep appearing while the check time stands still. The first run that selects anything is `initial`, whoever
  creates it; later runs are `scheduled` (decided 2026-09-11).
- **The initial import ignores pause.** The one run that first approval starts runs even when nobody follows yet and
  the channel is already system-paused (owner decision 2026-09-10); only scheduled selection honours `paused_by`.
- **Reconciliation (M3, decided 2026-09-11).** At the start of each cron tick, for every run older than one hour,
  each run-episode still `selected` has its instance looked up by id; a missing, errored, terminated, or completed
  instance becomes run-episode `failed WORKFLOW_LOST`, one attempt on the episode, and the run closes
  when nothing is left `selected`. The handler records a `create()` that throws at once, and an instance whose step
  gives up writes `failEpisode` itself, so the sweep is a safety net. An approved channel with no run row at all is
  "approved, never started" in Needs attention, with no age window; the Start route is its remedy.
- **Episode states: `pending | available | failed | skipped`.** `pending` carries an optional `waiting_code`
  (`CAPTIONS`, `LIVE_OR_UPCOMING`, `PROVIDER_LIMIT`); `failed` carries the last technical `failure_code`; `skipped`
  carries a `skip_reason` (`SHORT`, `NON_ENGLISH`, `NO_CAPTIONS`, `LIVE_OR_UPCOMING`, `UNPLAYABLE`, `OWNER`) with
  `skipped_at` and, for an owner skip, `skipped_by_email`. Every write that records an outcome clears the fields of
  the outcomes it supersedes: finding captions or a technical failure clears the wait, a wait clears the failure
  code, a skip and a publication clear both, and only Retry resets `attempt_count`, which is history (decided
  2026-09-11; the matrix is in `docs/specs/m3-ingestion-plan.md` Step 4). There is no channel-level failure code
  and no channel waiting code.
- **Selection rules (owner decisions 2026-09-08, carried onto the new statuses):** a "no captions" answer for a video
  published within the last 48 hours is "not yet": the episode stays `pending` with `waiting_code = CAPTIONS` and
  `transcript_checked_at` set, no attempt counted, re-checked each run; at or after 48 hours it is `skipped
  NO_CAPTIONS`. Videos under 180 seconds are `skipped SHORT` and store nothing. Live or upcoming videos wait the same
  48 hours with `waiting_code = LIVE_OR_UPCOMING`, then `skipped LIVE_OR_UPCOMING`. An episode with captions but no
  English track is `skipped NON_ENGLISH`; an `UNPLAYABLE` answer is `skipped UNPLAYABLE`. DownSub credit exhaustion
  (`PROVIDER_LIMIT`) leaves the episode `pending` with that waiting code, counts no attempt, and the run closes
  `completed` with that row `waiting`; `GET /catalog` shows the remaining credits and the key status (M3, not yet
  present).
- **Three technical attempts, one rule** (decided 2026-09-11, evening). Every outcome that is not a success, a wait,
  or a deterministic skip counts one attempt: `PROVIDER_HTTP`, `PROVIDER_PARSE`, `PROVIDER_AUTH`,
  `PROVIDER_RATE_LIMIT`, `VECTORIZE_FAILED`, `VECTORIZE_INCOMPLETE`, `AI_EMBED_FAILED`, `AI_SUMMARY_FAILED` (after
  the raw-text fallback), and `WORKFLOW_LOST` all increment `attempt_count` and record the reason; below three the
  episode stays `pending` and the next scheduled run reattempts it, and the third makes it `failed`.
  `TRANSCRIPT_TOO_LARGE` is deterministic: it counts its one attempt and goes to `failed` at once. Waiting never
  counts as an attempt. Only
  `failed` episodes reach the owner. There is no account-level outcome family and no run-level failure code: a run is
  `running` and then `completed`, and its run-episodes say what happened.
- **Pre-flight gate.** Every start, cron or owner, first calls DownSub's `/status` through the cached wrapper the
  catalog uses; a rejected key or zero credits means nothing is launched and no run is recorded, so neither ever
  reaches an episode as an attempt. Cron logs why and skips the tick; Start answers 502 naming the reason; approve
  and retry answer as usual and leave the channel or episode for a later start. An unreachable `/status` does not
  block (decided 2026-09-11).
- **Owner episode actions**, both requiring an approved channel with no queued or running run, else 409:
  `POST /channels/:id/episodes/:videoId/retry` takes `failed` or `skipped` back to `pending`, clearing attempts and
  skip fields, and `POST /channels/:id/episodes/:videoId/skip` takes `failed` to `skipped OWNER`. Siblings and their
  summaries are untouched. There is no channel-level retry.
- Persist `ingestion_runs` and the exact selected `ingestion_run_episodes` (`selected`, `available`, `failed`,
  `skipped`, `waiting`, `not_attempted`). Permit at most one queued/running run per channel. A run-episode whose
  instance is gone is closed `failed WORKFLOW_LOST` by the reconciliation sweep, its episode taking one attempt; an approved channel with no run row at all appears under Needs attention as "approved, never started".
- Workflows: each external call (transcript, AI, Vectorize) is its own `step.do()` inside the episode's instance for
  granular retries; the feed is read by the handler before the run exists. Use deterministic vector IDs. The verify
  step retries before a missing vector counts as `VECTORIZE_INCOMPLETE`, since Vectorize applies upserts
  asynchronously. Publish `available` only after the full vector set is ready for retrieval and a summary is stored;
  never expose partial ingestion as completed content. `processed_at` is the summary's availability time and is
  never reset.
- Declining a channel stops nothing in flight (decided 2026-09-11). Runs never write channel state, so a run that
  outlives a decline publishes episodes that eligibility hides from readers until re-approval, the owner's episode
  reads being independent of channel status; the `lifecycle_version` fence of
  2026-09-10 was removed with migration `0002`. An instance's Registry writes are accepted only while its run is
  still open, which guards against a reconciled run's instance turning out to be alive. Retained partial vectors
  remain ineligible.
- Channel identity is the canonical `UC…` id; the feed is `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`.
  Ids and `/channel/UC…` URLs validate offline in `lib/youtube/ids.ts`. There is no resolution of `@handle` or
  `/c/…` URLs: the feed does not accept them, and users copy the id from the channel's About dialog instead.

### Transcript contract

Transcripts come from **DownSub's API** (owner decision 2026-09-08), behind one seam so the source can change without
ingestion noticing. `apps/api/src/lib/transcripts/types.ts`:

```ts
export type TranscriptSegment = { text: string; startSec: number; durationSec: number };
export type TranscriptResult = {
  segments: TranscriptSegment[] | null;
  durationSec: number | null;
  isLive: boolean;
  captionStatus: "english" | "none" | "non_english";
};
export type TranscriptSource = { fetch(videoId: string): Promise<TranscriptResult> };
// captionStatus distinguishes absent captions from non-English captions; segments are present only for English,
// and "english" always carries at least one segment: a chosen track whose file has no usable cues is "none"
// (decided 2026-09-11), so the 48-hour rule applies and nothing downstream meets an empty transcript.
// isLive includes upcoming videos. Known live/upcoming metadata takes precedence over an UNPLAYABLE response:
// return the result so selection can classify the wait. Duration and liveness drive the selection rules
// (Ingestion pipeline); other provider failures throw TranscriptError.
export class TranscriptError extends Error { readonly reason: TranscriptFailure } // UNPLAYABLE | PROVIDER_AUTH |
// PROVIDER_LIMIT | PROVIDER_RATE_LIMIT | PROVIDER_HTTP | PROVIDER_PARSE
// The reason is also the message prefix, as DomainError's code is, so it survives a Workflow step boundary and
// `transcriptFailure(error)` recovers it the way `domainErrorCode` does.
```

- `lib/transcripts/index.ts` exports `transcriptSource(env)`: the test-only `TRANSCRIPTS_FAKE` binding wins (canned
  complete `TranscriptResult` values or a failure reason per video id, including duration, caption status, and
  live/upcoming cases, the `YOUTUBE_FEEDS_FAKE` pattern); otherwise the DownSub adapter.
- `lib/transcripts/downsub.ts`: `GET https://api.downsub.com/download?url=https://www.youtube.com/watch?v=<id>` with
  `Authorization: Bearer <DOWNSUB_API_KEY>`. `data.state` is `subtitles_found` (choose a track, GET its **VTT**, parse
  cues with `lib/transcripts/vtt.ts`; a file with no usable cues is reported as `captionStatus: "none"`),
  `no_subtitles` (`captionStatus: "none"`), or `error` (`UNPLAYABLE` with the
  detail from `metadata.playabilityReason`, unless known live/upcoming metadata says the video is waiting). HTTP 401 →
  `PROVIDER_AUTH`, 403 → `PROVIDER_LIMIT`, 429 → `PROVIDER_RATE_LIMIT`, other non-2xx → `PROVIDER_HTTP`, an unparsable
  body or caption file → `PROVIDER_PARSE`. Tracks carry a `code` such as `en` or `en_auto`; labels are unreliable
  ("undefined (auto-generated)" occurs), never match on them. The `translatedSubtitles` array (machine translations,
  most of the ~400 KB body) is discarded.
- Track choice (owner decision 2026-09-10): a manual `en`/`en-*` track, else `en_auto`/`en-*_auto`; if captions exist
  but neither qualifies, return `captionStatus: "non_english"` without downloading a non-English track, and the
  episode is `skipped NON_ENGLISH`. No translation fallback; non-English channels are out of scope.
- The adapter never retries; the Workflow step does, with a generous timeout: about a second when captions exist,
  ~10 s for `no_subtitles`, up to a minute for `error`. One credit per video with or without captions, none for
  errors, `/status`, or the file download; 2,000 credits a month. `GET /status` returns `remainingCredits`.
- Verified 2026-09-08 with a trial key: uploads 1–2 hours old are served, and a video's VTT parsed to exactly the
  segments YouTube's own caption JSON yields.

Why not YouTube directly: an InnerTube `player` call as a mobile client works from a residential IP but is bot-checked
from Cloudflare's egress in every client tested (30 calls: 21 `LOGIN_REQUIRED`, 4 hard 403s, 5 OKs on one video), and
no unsigned caption endpoint exists any more. That path was built, measured, and dropped on 2026-09-08; the numbers
are in `docs/specs/m3-ingestion.md` §2 and the code survives only on the throwaway branch `spike/transcript-remote`.
Do not reintroduce it.

### Chunking (pure function, `lib/chunk.ts`)

Hybrid time/token strategy:

1. Group consecutive segments into ~60 seconds of speech.
2. If a group exceeds ~400 tokens (approximate with `chars / 4`), split it on segment boundaries.
3. Overlap consecutive chunks by 1–2 segments so a point straddling a boundary is still retrievable.
4. Never emit a chunk over 480 tokens — `bge-base-en-v1` truncates silently at 512.

Vectorize vector id: `${videoId}:${chunkIndex}`. Metadata: `{ videoId, channelId, channelTitle, title, startSec, endSec, text, publishedAt }`.
`channelId` and `videoId` are required on every vector (they support retrieval filtering). Metadata `text` is what
gets fed to the LLM at query time, so keep it exact.

## AI usage

- All Workers AI calls go through `lib/ai.ts`. Route code never calls `env.AI.run` directly.
- Prompts live in `apps/api/src/prompts/` as exported template functions, not inline strings. Changing a prompt is
  non-trivial — ask first.
- Per-video summary output: 3–5 takeaways, each `{ text, startSec }` with the timestamp taken from the `[mm:ss]`
  markers in the prompt (null when absent or out of range), a ≤3-sentence executive summary, topic tags. Ask the model
  for JSON and validate the shape before storing; on validation failure retry once, then store raw text with a flag.
- Summaries publish automatically after that validation, retry, and raw fallback. No manual approval and no
  summary-quality review gate exist in this version (owner decision 2026-09-10).
- Digest windows and ordering use the summary's availability time, `episodes.processed_at` exposed as
  `summaryAvailableAt`, not the video's publication time: 24 hours by default, seven days when expanded. Reads,
  refollows, re-approval, and enrichment never reset it. Publication time stays separate metadata, and channel history
  stays publication-ordered (owner decision 2026-09-10; digest routes carry it in M3).
- Summaries are shared once per episode. User preferences affect chat answers only.
- RAG Q&A: read current follows → intersect with approved catalog channels → embed question →
  query `shared-catalog` with `filter: { channelId: { $in: eligibleChannelIds } }`, `topK: 3`, all metadata → validate
  matched episodes are available and channels still eligible → build context → include preferences and this chat's
  recent history → Llama 3.3. Cite `videoId` + `startSec`. Split oversized filters and merge results by score; never
  drop the channel filter to accommodate limits. Refill candidates as needed when rejecting incomplete episodes.
- With no eligible channels, store a normal assistant reply: "Chat requires following at least one approved channel."
  Skip AI and Vectorize calls. Chat creation, history, and message submission remain accessible.
- Following or unfollowing, and declining or re-approving a channel, changes future retrieval for every existing chat. Earlier
  messages and citations remain visible and may still be used as conversation context; do not scrub history.
- Shared summary cross-references are optional enrichment: query the same namespace, exclude the video's own ID,
  deduplicate to at most five available related videos, and filter titles to the reader's eligible channels at display.
  A lookup failure or no qualifying results stores `[]` and never blocks publication; the UI omits an empty section.

## API shape

Hono app in `apps/api/src/index.ts`. Keep routes thin; logic lives in `do/` and `lib/`.
Request/response shapes live in `packages/shared` as Zod schemas with their types inferred beside them; `apps/api`
validates requests and documents responses with the schemas, `apps/web` imports the types only.

Target resource contract (not a claim that these routes are implemented):

The API is modelled on entities, never on roles: no `/owner/*` namespace, no role-named types. Authorization is
per operation (**owner** below) and, on channels, per field: the owner receives the same representations as everyone
plus a `management` block, and `?scope=all` widens a collection for the owner. See `docs/specs/home-read-experience.md` §10.

| Route | Who | Purpose |
|---|---|---|
| `GET /me` | anyone | The caller's normalized email and `role` (`owner` or `user`); the UI uses it to show owner controls |
| `GET /catalog` | owner | The catalog's aggregate state: `channels { requested, approved, paused, declined }`, `episodes { available, pending, waiting, failed, skipped }`, `runs { active }`, `attention { failedEpisodes, neverStarted, requested }`, `lastSuccessfulIngestionAt` (the newest channel `last_ingested_at`, M3), `transcripts { remainingCredits, status }` (M3) |
| `GET /channels` | anyone | `requested` and `approved` channels, each with `status`, `paused`, `following`, `followerCount`, `episodes` counts and `lastIngestedAt`; `?scope=all` (owner) adds `declined` ones and a `management` block |
| `POST /channels` `{ channelId, title?, initialImportCount? }` | anyone | A user's call creates a `requested` channel and follows them (201); the owner's creates it `approved`, starts the initial import, and follows the owner (201). An existing `requested` or `approved` id is followed and returned (200); a `declined` id is 409 `ChannelDeclinedResponse`. A handle or an id with no feed is 400 |
| `GET /channels/:id` | anyone | One channel in any status, so a declined one can show its note; the owner also gets `management` |
| `POST /channels/:id/request` | anyone | `declined → requested`, keeping the review fields, and follows the caller |
| `POST /channels/:id/approve` `{ title?, initialImportCount?, explanation? }` | owner | `requested → approved` with the one initial import, or `declined → approved` without one; recomputes pause from the follower count |
| `POST /channels/:id/decline` `{ explanation? }` | owner | `requested → declined`, or `approved → declined` with the pause cleared; a run in flight finishes |
| `POST /channels/:id/pause` / `POST /channels/:id/resume` | owner | Owner pause; resume clears either kind of pause. `approved` only |
| `GET /channels/:id/episodes?limit=` | anyone | Episodes newest first; every caller gets `status` and a top-level `skipReason` (why there is no summary, when skipped); the owner and followers of an approved channel get `summary`, `related`, `wasUnread`, and returned summaries are marked read for the caller; everyone else gets titles without summaries; the owner also gets `processing` (attempts, `failureCode`, `waitingCode`, `skipReason`, timestamps) |
| `POST /channels/:id/episodes/:videoId/retry` | owner | `failed` or `skipped → pending`, attempts and skip fields cleared, one-episode run |
| `POST /channels/:id/episodes/:videoId/skip` | owner | `failed → skipped OWNER` |
| `GET /channels/:id/ingestion-runs` | owner | Runs newest first with per-episode outcomes |
| `GET /channels/:id/followers` | owner | Emails and `followedAt` of the channel's active followers |
| `GET /follows` | anyone (own) | Active follows, each embedding its `channel` — any status, including declined — and carrying `unreadCount` |
| `PUT /follows/:channelId` / `DELETE /follows/:channelId` | anyone (own) | Follow or refollow a `requested` or `approved` channel (409 `ChannelDeclinedResponse` otherwise) / retained unfollow tombstone; both also write the Registry follower record |
| `GET /digest?since=<iso>` | anyone (own) | Eligible followed-channel summaries, selected and ordered by first availability (`summaryAvailableAt`, M3); default last 24h, clamped to 7 days; mark returned items read; `wasUnread` per item |
| `POST /chats` / `GET /chats` | anyone (own) | Create an empty chat / list the user's chats |
| `GET /chats/:id/messages?limit=50` | anyone (own) | That chat's messages and citation snapshots |
| `POST /chats/:id/messages` `{ message }` | anyone (own) | Reply and sources, using current eligible follows |
| `GET /preferences` / `PUT /preferences` | anyone (own) | User's chat rules |

`/channel-requests/*`, `DELETE /channels/:id`, `POST /channels/:id/restore`, and `POST /channels/:id/retry` do not
exist: requests are channels, channels are never deleted, and retry is per episode (2026-09-10). There is no route
that starts a run on demand yet; M3 adds one (planned `POST /channels/:id/runs`, owner, approved channel) so the
Start action for an approved channel that never began has something to call. Its answers: 200 `{ run }`, where a run
with no run-episodes and status `completed` means the feed had nothing new and nothing is pending; 409
`INVALID_STATE` while a run is open; 502 `UPSTREAM_UNAVAILABLE` when YouTube does not answer, after that empty run
has been recorded (2026-09-11).

All routes except `/health`, `/openapi.json`, and `/docs` require `X-User-Email`; missing or malformed returns 400. Owner routes additionally require
`role = 'owner'`: `requireOwner` from `middleware/owner.ts` is applied to those handlers and returns 403 early from
`c.var.identity`, and the Registry DO re-checks it inside every owner-only method, so the middleware is a convenience,
not the guard. Typed `DomainError`s map to HTTP in
`middleware/errors.ts`: `INVALID_INPUT` 400, `NOT_OWNER` 403, `NOT_FOUND` 404, `INVALID_STATE` 409. Validate chat ownership in the caller's User DO. JSON everywhere, with one exception: `GET /docs` serves the Scalar
test client as HTML (owner decision 2026-09-07, `docs/specs/api-reference.md`).

The API documents itself. Every handler carries `describeRoute` (one entity tag, a summary, the success schema, and the
error responses it can produce via `lib/openapi.ts`) and validates body, query, and params with `validate(...)` from
`lib/validation.ts` and the shared schemas. Optional text (`title`, `explanation`) is omitted or non-blank: `""`,
whitespace-only, and `null` are `INVALID_INPUT` via the shared `optionalText` helper, never a silent default (owner
decision 2026-09-08, `docs/specs/api-reference.md` §2); the web app strips blanks before sending. `GET /openapi.json` is generated from those at request time; the coverage
test in `test/openapi.test.ts` fails when a registered route is missing from it, so a new route cannot ship
undocumented. Scalar's script is pinned to one version in `routes/docs.ts` and its request proxy is off.
There are no chat deletion routes and no per-channel chats.

## Web UI (`apps/web`)

- Vite + Preact + TypeScript. Routing with `preact-iso` in history mode; Pages serves `index.html` for unknown paths
  when no `404.html` is deployed, so verify deep links and reloads under `wrangler pages dev`. Section navigation
  within a page uses anchors, not client-side tab state.
  Approved dependencies for `apps/web`: `preact`, `preact-iso`, `vite`, `@preact/preset-vite`. Anything else requires approval.
  `zod` reaches the web only through `packages/shared`, and only as types: import from shared with `import type`, and
  keep Zod out of the web bundle (`grep -ril zod apps/web/dist` after `pnpm build` must find nothing).
- No UI component library, no CSS framework, no state library. One plain CSS file; `useState`/`useReducer` for state.
- Import request/response types from `packages/shared`. `src/api.ts` is the only place `fetch` is called; it sets
  `X-User-Email` from the identity `session.tsx` binds into it and the API base URL from `import.meta.env.VITE_API_URL`.
  `account.ts` (localStorage) is read once, when the session mounts, and written when an account is selected: it is the
  remembered default for the next page load, not the source of truth for requests. A tab sends exactly the account it
  displays; tabs do not synchronise, so two tabs may act as two people (decision 2026-09-08). The API must list the
  web's origin in `WEB_ORIGINS` (Identity model) or the browser blocks the calls.
- Text only. No images, avatars, thumbnails, or rich embeds. Structured text (lists, headings) is fine.
- Render assistant messages as plain text with newlines preserved. Linkify `youtube.com` URLs only; when a chat
  `source` has `startSec`, link to `https://youtu.be/<videoId>?t=<startSec>`.
- Pages build: root directory `/` (repo root, so pnpm workspaces resolve), command `pnpm build`, output `apps/web/dist`.

### Screens

**`/` — Account.** A single email input ("Who is this for?" — do not call it sign in). Below it, a list of
previously used emails from `localStorage` for one-click selection. If an email is already selected, skip
straight to `/home`. A "switch account" link is visible on every other screen.

**`/home` — Home.** One page for everyone, with section jump links. The header shows the email, the word `owner`
when applicable, and "Switch account"; the nav shows **Home** and, for owners, **Owner (n)** where `n` is the attention
count. Owners also see an attention card first ("2 channels waiting for review · 1 episode failed · 1 channel approved
but never started", from `GET /catalog`) linking to `/owner#attention`; users never see it and it is hidden when the
count is zero. Then:
1. **Today's digest** — eligible followed channels only (active follows ∩ approved); summaries first available in
   the last 24h, newest availability first (M3 carries the basis; until then publication time), flat list with the
   channel as byline; shared summary, takeaways with `youtu.be/<id>?t=<startSec>` links where a timestamp exists,
   tags, related titles filtered to eligible channels. Items with no read receipt at fetch time are marked NEW;
   returning them records the receipt. "Show last 7 days" widens `since`; "Refresh" (M3) re-fetches the lists and
   then the digest, since polling stops at approval and the first summaries land minutes later. Empty states (owner decision 2026-09-10,
   web copy lands with M3): with no active follows, "Follow a channel to start your digest." with the catalog and its
   follow controls rendered inline; with follows but none approved yet, explain that no summaries are available yet
   and point to the channel rows; otherwise "No new summaries in the last 24 hours." or "No new summaries in the last
   7 days." Load `/follows` and `/channels` before `/digest` so unread counts and NEW markers agree; unread counts span
   all eligible summaries while NEW marks only the returned ones.
2. **Channels** — two subsections and one input. **Followed** (`GET /follows`): approved rows show summarised count,
   unread count and last ingestion and link to the channel; requested rows read "Awaiting owner approval"; paused rows
   add "paused"; declined rows read "Declined" or "Withdrawn" with the owner's note and date and a **Request again**
   button that confirms once. Unfollow on every row, and a followed channel that is declined stays listed but drops
   out of the digest. **Catalog** (`GET /channels` minus follows): approved channels with summarised counts and
   Follow; requested channels with "awaiting approval · N following" and Follow. Below both, one **Add a channel**
   input for a `UC…` id or `/channel/UC…` URL with the line saying where to copy it: a new id creates and follows, an
   existing id follows, and a declined id shows "Declined on <date>: '<note>'" with Request again.
   Poll about every 15s only while a followed channel is still awaiting the owner's decision.
3. **Chats** — joins Home in M4; no placeholder before then. List/create/select independent conversations. Preserve
   each chat's messages and source links. Never disable chat controls for lack of follows; use the fixed
   follow-required response above.

**`/channel/:id` — Channel.** Any status. A requested channel shows the header, "Awaiting owner approval", and Follow
or Unfollow, with no episodes. An approved one shows shared summaries newest first for followers, and `pending`,
`skipped` and `failed` episodes by title with their phrase; viewing marks returned summaries read for this user.
A declined one shows the note, the date, the follower count, Unfollow for a follower (Follow is refused with 409), and Request again, with episode titles and no summaries when it had been
approved. No chat input here; conversations live on Home. Back link to `/home`.

**`/owner` — Owner.** Owner only: users are sent back to `/home` with a note, and the API returns 403 regardless. One
page, sections **Queue**, **Catalog**, and **Needs attention**, jump links `#requests`, `#catalog`, `#attention`.
- **Queue.** Requested channels oldest first: title, id linked to its YouTube page, active followers by email,
  "nobody is waiting" when there are none, "previously declined on <date>: '<note>'" when re-requested, and Approve
  (title, import count, note) and Decline (note) forms. Reviewed history is collapsed: reviewer, time, note.
- **Needs attention.** `failed` episodes grouped by channel with reason, attempts, Retry and Skip; then approved
  channels with no run row at all, listed as information — there is no Start button until M3 adds a route that starts
  a run. "Never started" means approved and no run, with no age window. Every other problem reaches the owner as a
  `failed` episode or on the health strip, which in M3 also shows the transcript key status and credits.
- **Catalog.** Health strip from `GET /catalog`. **All channels**: status, paused, `available / tracked` with skipped
  and failed counts, follower count, last ingested, latest run, and the actions the status allows — Approve or
  Decline, Pause or Resume. Declining an approved channel confirms once, naming its follower count. Follower counts
  are real, from the Registry's follower record; the emails behind them are shown only in the queue.

**`/owner/channels/:id` — Owner channel detail.** From `GET /channels/:id` (with `management`), `/episodes`,
`/ingestion-runs`, and `/followers`: header with status, pause, approval and review fields, import count, and
follower count; episodes with status, wait reason, attempts, failure or skip reason, summary format, and
Retry and Skip; runs with per-episode outcomes; followers by email. Never shows any user's read or chat activity.

Owner catalog management is required, but a general admin dashboard is not: `/owner` shows only what supports approve,
decline, pause, resume, and per-episode retry and skip. Render owner controls only when `GET /me` returns
`role: "owner"`; the client's role is for rendering, and authorization happens per request in the Registry. The
user-facing phrases for channel statuses, skip reasons and wait reasons live in one place, `apps/web/src/lib/copy.ts`;
wireframes, load order, and acceptance criteria are in `docs/specs/home-read-experience.md` and
`docs/specs/channel-simplification.md` §7.

## Testing

Vitest with `@cloudflare/vitest-pool-workers` for everything in `apps/api`. Bindings come from `wrangler.jsonc`.
Workers AI and Vectorize are not available locally in tests — wrap them behind `lib/ai.ts` / `lib/vectorize.ts`
interfaces and select fakes with the test-only `AI_FAKE` and `VECTORIZE_FAKE` bindings; transcripts likewise
through `TRANSCRIPTS_FAKE` (`lib/transcripts/index.ts`), and Workflows through `WORKFLOW_FAKE` (`lib/workflows.ts`),
which answers `active`, `gone`, or `missing` per instance id and can make `create()` throw (decided 2026-09-11).
The same pattern already covers YouTube's feed: `lib/youtube/rss.ts` `feedFetcher(env)`
serves canned feeds when the test-only `YOUTUBE_FEEDS_FAKE` binding is set in `vitest.config.ts`, so no test reaches
the network. The pinned `@cloudflare/vitest-pool-workers` has no `fetchMock`, and `vi.mock` does not reach modules the
Worker loads for `SELF` requests, so env-selected fakes are the only seam that works end to end.

Tests are focused, not exhaustive. Required coverage:

- **Isolation and retrieval scope** — two emails with overlapping and disjoint follows; private chats, preferences,
  and read receipts remain isolated. Shared ingestion produces one canonical episode/vector set. Every
  Vectorize call uses `shared-catalog`; chat queries carry only eligible channel IDs. Prove changes to follows and to
  decline/re-approval affect existing chats, history remains intact, and zero eligible channels skip AI/Vectorize.
- **Lifecycle and retry** — adding an existing channel follows the caller and creates nothing; a declined id is 409
  with the note, and `POST /channels/:id/request` makes it requested again and follows the caller. First approval
  starts exactly one import and later approvals start none, leaving `approved_at` alone. Declining an approved channel
  changes no run or episode row, and its summaries leave digest and chat and come back on re-approval. Unfollowing to
  zero followers pauses an approved channel by the system, the next follow lifts it, an
  owner pause survives a follow, and a requested channel is never paused; `followerCount` matches the Registry
  follower record. Episode attempts stay `pending` below three and turn `failed` on the third; system skips carry
  their reason, owner retry clears attempts and skip fields, and owner skip needs a `failed` episode. Test owner-only
  mutations, and that handles and ids with no feed are rejected. Owner overview and channel-health counts match
  SQL-seeded episodes and runs. Add or extend these tests whenever a route or data path is introduced.
  M3 adds: caption and credit waits resume without owner action and a fresh no-caption answer is re-fetched at or
  after 48 hours; a decline mid-run stops nothing, the run closes `completed`, and its later summaries stay hidden
  until re-approval; a write against a closed run is refused; the first-approval run starts while the channel is
  system-paused and scheduled selection skips paused channels; the first cron after approval imports no entry
  published before `approved_at`; every failure that is not a wait or a skip counts one attempt, a lost instance and
  a rejected key included, and the pre-flight check launches nothing on a rejected key or zero credits; instances
  created in one tick
  carry increasing start delays; digest windows use first availability, ordered strictly by it; a
  related-lookup failure still publishes the summary; a missing or errored instance reconciles into a `failed
  WORKFLOW_LOST` run-episode at the next tick once its run is an hour old, one attempt added.
- **Pure functions** — chunking (token caps, overlap, edge cases: empty, one segment, very long segment),
  RSS parsing, channel URL resolution, summary JSON validation.
- **Migrations** — a fresh DO runs all migrations idempotently; running twice is a no-op. The check constraints
  reject what they are meant to reject: an approved channel with no `approved_at`, a paused channel that is not
  approved, a skipped episode with no reason, and an owner skip with no email.
- **API document** — `GET /openapi.json` lists exactly the registered routes (`test/openapi.test.ts`), and each route
  test parses one response per shared schema with `expectShape` from `test/helpers.ts`, so the document and the
  Worker cannot disagree about a shape.

Don't write tests for Hono plumbing, Preact components, or Workflow step ordering. `apps/web` has typecheck and lint only. Don't mock what you can run for real
(DO storage, SQLite).

Every test starts with an empty Registry and no User DOs: `apps/api/test/setup.ts` wipes each object and aborts the
instances after every test,
because the pinned pool's `reset()` does not clear SQLite-backed Durable Objects. Tests pin `OWNER_EMAIL` in
`vitest.config.ts` (`miniflare.bindings`), overriding that value from the developer's `.dev.vars`.
Wrangler still loads the file; other values are not explicitly overridden.

## Code style

- Biome defaults. Run `pnpm lint -- --write` before finishing.
- Named exports only. No default exports except where Cloudflare requires them (Worker entry, DO/Workflow classes).
- No `any`. Use `unknown` and narrow. Validate all external input at the boundary: request bodies, queries, and params
  through `lib/validation.ts` and the shared schemas; RSS XML and AI JSON by hand.
- Errors: throw typed errors in `lib/`, convert to HTTP responses only in routes/middleware.
- Comments explain *why*, not *what*. Keep them short.
- Logging: `console.log` with a JSON object `{ event, email?, videoId?, ... }`. Never log transcript text or chat content.

## Git

- Conventional commits: `feat(api): …`, `fix(web): …`, `chore: …`, `test(api): …`.
- One logical change per commit. Don't commit generated files, `.wrangler/`, `.turbo/`, `dist/`, or `.dev.vars`.
- Never commit secrets. Account ids and bindings in `wrangler.jsonc` are fine.

## Non-goals (don't build these unless asked)

Authentication, per-channel chat, multi-region anything, a rich UI, notifications/email delivery, non-YouTube sources,
transcript generation via Whisper for videos without captions, general admin dashboards beyond required owner catalog
management, rate limiting.

## Open decisions (owner)

- **Transcript source — decided 2026-09-08: DownSub's API.** The InnerTube mechanism from 2026-09-07 was built and
  measured: it passes from a residential IP and is bot-checked from Cloudflare's egress in every client tested (30
  player calls: 21 `LOGIN_REQUIRED`, 4 hard 403s, 5 OKs on one video). The owner weighed a home relay behind a
  Cloudflare Tunnel, Bright Data's Web Unlocker, and DownSub, and chose DownSub after a probe with a trial key passed
  every check (`docs/specs/m3-ingestion.md` §2). Hard rule 2 carries the exception; the transcript contract carries
  the seam. The InnerTube code was removed; it survives only on the throwaway branch `spike/transcript-remote`.
- **M3 execution model — decided 2026-09-11** (`docs/specs/m3-ingestion.md` §2): one Workflow instance per episode
  with one run row per channel kept in the Registry; the handler fetches, selects, and fans out. The
  `lifecycle_version` fence of 2026-09-10 is reversed: declining stops nothing in flight, and migration `0002`
  removed the column. A cron tick checks DownSub's `/status` first and staggers its instances by 3 s each. Every
  failure that is not a wait or a skip counts one attempt; there is no account-level outcome family and no run-level
  failure code (decided the same evening, reversing that afternoon's precedence and `failedRuns`).
- **Workers plan — decided 2026-09-11: Workers Paid.** Per-step CPU and the concurrent-instance cap both fit.
- **Reconciliation window — decided 2026-09-11:** the sweep runs at each cron tick over runs older than one hour;
  "approved, never started" has no age window.
- Channel model — decided 2026-09-10 (`docs/specs/channel-simplification.md`): `requested | approved | declined`, a
  pause flag, a Registry follower record, and a four-status episode machine; channels are never deleted. Merged the
  same day; the owner's browser walkthrough of the four screens passed.
- Owner management interface — decided 2026-09-07: `/owner` and `/owner/channels/:id` as specified in the Web UI
  section and `docs/specs/home-read-experience.md`. Owner identification: `global_users.role`, seeded from the
  `OWNER_EMAIL` secret (see Identity model).
- `compatibility_date` is capped at `2026-08-22`, the newest date the workerd bundled with the pinned
  `@cloudflare/vitest-pool-workers` accepts. Raise it together with that dependency.
- Retention: keep all chats and shared/user records for now; any future retention policy requires an owner decision.
