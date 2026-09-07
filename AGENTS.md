# AGENTS.md — Media Digest Assistant

Single source of truth for every coding agent working in this repo (Claude Code, Codex, Cursor, others).
`CLAUDE.md` and `.cursor/rules/` point here. Do not duplicate content into those files; edit this one.

## What this is

A personal, multi-user tool with an owner-managed global YouTube channel catalog. It ingests and summarizes
each episode once with Workers AI, stores shared transcript embeddings in Vectorize, and exposes a text-only
UI for per-user follows, digests, and multiple chats. Runs entirely on Cloudflare; cron cadence is undecided.

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
2. **Never call any paid or third-party API** other than YouTube (public RSS + transcript endpoints) and Cloudflare services.
   No OpenAI, no Anthropic, no scraping services, no analytics SDKs.
3. **Never query, upsert, or delete in Vectorize without an explicit namespace scope.** Shared episode vectors use
   `shared-catalog`, never a user's email. Chat retrieval must filter to the user's current followed, available,
   non-deleted channels and validate processed episodes before using results. Never fall back to an unfiltered query.
   For ID-based operations, enforce namespace ownership in `lib/vectorize.ts`; do not assume the underlying API
   accepts a namespace argument for every operation.
4. **Never run destructive commands**: no `DROP`, `DELETE FROM` without a `WHERE` on user data, no
   `wrangler delete`, `wrangler d1/vectorize delete`, no resetting Durable Object storage, no `rm -rf` outside build output.
   If a task seems to require one, stop and ask.

## Repo layout

pnpm workspaces monorepo, task orchestration by Turborepo. Use `pnpm`, never `npm`/`yarn`/`bun`. Use `pnpm dlx` instead of `npx`.

Toolchain pinning:
- **Node** is pinned by Volta in the root `package.json` (`"volta": { "node": "22.x.y" }`). Never change it without approval.
- **pnpm** is pinned by the `"packageManager": "pnpm@x.y.z"` field in the root `package.json` and enforced with
  `engine-strict=true` in `.npmrc`. Do not pin pnpm through Volta — its pnpm support is experimental.
- If you see a version mismatch error, stop and report it; do not work around it by switching tools.

```
.
├── AGENTS.md                 # this file
├── CLAUDE.md                 # pointer to AGENTS.md
├── .cursor/rules/            # pointer to AGENTS.md
├── docs/PRD.md
├── package.json              # workspace root: volta.node, packageManager, turbo scripts
├── pnpm-workspace.yaml
├── .npmrc                    # engine-strict=true
├── turbo.json                # build / typecheck / lint / test / dev pipelines
├── apps/
│   ├── api/                  # Cloudflare Worker: Hono router, Durable Objects, Workflows, cron
│   │   ├── src/
│   │   │   ├── index.ts              # Worker entry: fetch + scheduled handlers, Hono app
│   │   │   ├── middleware/user.ts    # X-User-Email → registry + per-user DO stub on context
│   │   │   ├── routes/               # one file per resource (chat, channels, digest, ...)
│   │   │   ├── do/registry.ts        # Global Registry Durable Object
│   │   │   ├── do/user.ts            # Per-user Durable Object
│   │   │   ├── workflows/ingest.ts   # channel ingestion Workflow
│   │   │   ├── lib/youtube/          # rss.ts, transcript.ts (see contract below)
│   │   │   ├── lib/chunk.ts          # transcript chunking (pure)
│   │   │   ├── lib/ai.ts             # Workers AI wrappers: embed, summarize, chat
│   │   │   ├── lib/vectorize.ts      # namespaced upsert/query helpers
│   │   │   └── prompts/              # prompt templates as .ts exporting strings
│   │   ├── migrations/               # DO SQLite migrations (see Schema)
│   │   ├── test/
│   │   ├── wrangler.jsonc
│   │   └── vitest.config.ts
│   └── web/                  # Cloudflare Pages: Vite + Preact + TypeScript text UI
│       ├── src/
│       │   ├── main.tsx              # mount + router
│       │   ├── api.ts                # typed fetch wrapper; sets X-User-Email
│       │   ├── account.ts            # selected email + recent emails in localStorage
│       │   ├── screens/              # Account.tsx, Home.tsx, Channel.tsx
│       │   └── components/           # Digest.tsx, Chat.tsx, ChannelList.tsx
│       ├── index.html
│       └── vite.config.ts
└── packages/
    └── shared/               # types shared by api and web (API request/response shapes)
```

If a file doesn't exist yet, create it at the path above rather than inventing a new location.

## Stack (fixed — do not substitute)

| Concern | Choice |
|---|---|
| Runtime | Cloudflare Workers, `compatibility_date` pinned in `wrangler.jsonc`, `nodejs_compat` enabled |
| HTTP | Hono |
| State | Durable Objects with SQLite storage (`new_sqlite_classes` migration) |
| Orchestration | Cloudflare Workflows for ingestion; Cron Trigger in the same Worker |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Embeddings | Workers AI `@cf/baai/bge-base-en-v1` (768 dims, 512-token input limit) |
| Vectors | Vectorize index `media-rag`, 768 dimensions, cosine, `namespace: shared-catalog`, metadata indexes on `channelId` and `videoId` (see Setup) |
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
```

`turbo.json` conventions: `build` depends on `^build` (so `packages/shared` builds first); `typecheck`, `lint`, `test`
depend on `^build`; `dev` is `persistent: true, cache: false`. Add a new task to `turbo.json` and to the root
`package.json` scripts together — never one without the other.

Before declaring a task done: `pnpm check` must pass, and anything touching
Workers runtime behavior must have been exercised under `wrangler dev`, not only Node.

## Identity model

- Users are identified by the `X-User-Email` request header. There is **no authentication** and none should be added.
  This is trusted, personal use. Do not add login, sessions, JWTs, or Cloudflare Access unless the owner asks.
- Middleware normalizes the email (trim, lowercase), **auto-registers unknown emails** in the Global Registry DO,
  and attaches the per-user DO stub (`env.USER_DO.idFromName(email)`) to Hono context as `c.var.user`.
- Registration creates an identity, not an ingestion subscription. Cron iterates shared catalog channels, not users.
- Private follows, read status, preferences, chats, messages, and citations live in the user's DO. Global identities,
  catalog approval requests, channels, episodes, and shared summaries live in the Registry DO. Requesters see only
  their own requests; the owner can review all requests. Never expose another user's private DO data.
- Only the owner can configure/approve, delete/restore, or retry catalog channels. Users can request and follow them.
  `TODO(owner):` decide how the trusted deployment identifies the owner for management operations; do not add authentication.

## Data & schema conventions

The agreed logical schema, keys, and indexes are in `docs/PRD.md` §5. Implement it using these conventions:

- Schema lives in `apps/api/migrations/` as numbered SQL files: `0001_init.sql`, `0002_add_x.sql`, …
  One file per DO class subdirectory: `migrations/registry/`, `migrations/user/`.
- Each DO runs pending migrations on first access in `blockConcurrencyWhile`, tracked in a `_migrations` table.
- Migrations are **additive only**: `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`.
  Never drop, rename, or change a column type in a migration without owner approval. Deprecate instead.
- Never edit a migration file that has been committed. Add a new one.
- `snake_case` for tables and columns. Every table has `created_at INTEGER` (unix ms). Use `TEXT` for ids.
- The single Registry DO owns `global_users`, `channels`, `channel_requests`, `episodes`, `episode_summaries`,
  `ingestion_runs`, and `ingestion_run_episodes`. One User DO per normalized email owns `channel_follows`,
  `summary_reads`, `chats`, `chat_messages`, `chat_message_sources`, and `user_preferences`.
- Enforce local foreign keys and transactions. References across DOs are validated through DO methods; there are
  no cross-DO SQL joins or atomic transactions. Do not copy shared episodes or summaries into each User DO.
- Transcript text lives once as shared Vectorize chunk metadata, not in SQLite. Stable vector IDs make retries
  idempotent; “once” means one canonical stored copy, not a promise of exactly-once external API execution.
- Users have zero or more independent chats. Each chat uses its own history and the user's current follows;
  there is no chat-to-channel membership table. Retain the nullable `chat_messages.channel_id` as null for global chat.
- A summary is unread until actually returned by `GET /digest` or viewed on its channel screen. Store read receipts
  in the User DO's `summary_reads`; absence means unread. Existing summaries start unread on first follow.
  Preserve read receipts through unfollow and channel deletion/restoration.
- Retain chats, messages, requests, follow tombstones, episodes, summaries, and vectors. Deletion is soft.

## Catalog, requests, and follows

- Resolve URLs to canonical YouTube channel IDs. Requests retain requester, submitted URL, approval/rejection
  status, and optional owner explanation. One request per `(user_email, youtube_channel_id)`; multiple requesters
  share one approved channel and ingestion pipeline. Requests do not configure catalog channels before approval.
- Channel states: `pending | available | failed`. Only available, non-deleted channels can be followed.
  Deletion is a separate `deleted_at`, preserving the underlying processing state and all follow records.
- Owner approval/configuration starts initial ingestion. One fully processed episode (complete vectors plus shared
  summary, including the accepted raw fallback) makes the channel available. Later episode failures do not revoke it.
- Initial import defaults to five recent RSS episodes. If none is processed after attempts finish, mark the channel
  failed with `NO_TRANSCRIPTS` when all attempted episodes lack captions, `NO_EPISODES` for an empty feed, or
  `INITIAL_IMPORT_FAILED` for technical/mixed failures. Keep episode-level reasons distinct.
- Failed channels are excluded from scheduling. Only an owner-triggered `failed → pending` transition enables retry.
- Approval plus availability triggers automatic following for every requester, once. Deliver from persisted approved
  requests with `auto_follow_completed_at IS NULL`. In the User DO, insert only if no follow row exists; never overwrite
  an active follow or an unfollow tombstone. Acknowledge completion in the Registry after the User DO succeeds.
  Retrying this handoff must never reverse an explicit unfollow.
- Unfollow sets `unfollowed_at`; it does not delete the catalog channel. Explicit manual refollow can clear it.
  Owner channel deletion stops ingestion and excludes future retrieval. Restoration preserves previous active follows;
  access resumes when the channel is available. An explicit unfollow stays unfollowed.

## Ingestion pipeline

Owner approval/configuration or cron → Registry selects channel → one Workflow per channel run → per unprocessed
video: fetch transcript → chunk → embed → upsert in `shared-catalog` → summarize → write shared summary and mark
processed in the Registry DO. Following never launches per-user ingestion or duplicates vectors/summaries.

- **Cron schedule:** `TODO(owner)` — not yet decided. Keep a placeholder in `wrangler.jsonc`; do not choose a cadence.
  Scheduled runs select available, non-deleted channels independently of follower count.
- Persist `ingestion_runs` and the exact selected `ingestion_run_episodes`. Permit at most one queued/running run
  per channel. Owner retry selects the latest configured episode count, reuses completed work, and may reattempt
  unsuccessful episodes, including those previously without captions.
- Episode states: `pending | processing | processed | no_transcript | failed`. Record attempts, reason codes,
  transcript checks, vector completion, and processing timestamps; distinguish no captions from network/parse failure.
- Workflows: each external call (RSS, transcript, AI, Vectorize) is its own `step.do()` for granular retries.
  Check persisted episode progress and use deterministic vector IDs. Publish `processed` only after the full vector
  set is ready for retrieval and a summary is stored; never expose partial ingestion as completed content.
- Channel deletion and owner retry increment `lifecycle_version`; run writes must match that version. Cancel/fence
  stale runs so they cannot change catalog state after deletion/restart. Retained partial vectors remain ineligible.
- Channel resolution: accept `@handle`, `/channel/UC…`, and `/c/…` URLs; resolve to a `UC…` channel id and use
  `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`.

### Transcript contract

`apps/api/src/lib/youtube/transcript.ts` must export:

```ts
export type TranscriptSegment = { text: string; startSec: number; durationSec: number };
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[] | null>;
// null = no captions available (not an error); throw on network/parse failure
```

The implementation is your choice (direct caption-track fetch or an explicitly approved package),
subject to the dependency rule above and one requirement: **it must be verified working under `wrangler dev`**,
not just Node. Many YouTube transcript libraries depend on Node APIs and fail in workerd. Document the approach
and its known failure modes in a comment at the top of the file.

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
- Per-video summary output: 3–5 bullet takeaways, ≤3-sentence executive summary, topic tags. Ask the model for
  JSON and validate the shape before storing; on validation failure retry once, then store raw text with a flag.
- Summaries are shared once per episode. User preferences affect chat answers only.
- RAG Q&A: read current follows → intersect with available, non-deleted catalog channels → embed question →
  query `shared-catalog` with `filter: { channelId: { $in: eligibleChannelIds } }`, `topK: 3`, all metadata → validate
  matched episodes are processed and channels still eligible → build context → include preferences and this chat's
  recent history → Llama 3.3. Cite `videoId` + `startSec`. Split oversized filters and merge results by score; never
  drop the channel filter to accommodate limits. Refill candidates as needed when rejecting incomplete episodes.
- With no eligible channels, store a normal assistant reply: "Chat requires following at least one available channel."
  Skip AI and Vectorize calls. Chat creation, history, and message submission remain accessible.
- Following/unfollowing or deleting/restoring channels changes future retrieval for every existing chat. Earlier
  messages and citations remain visible and may still be used as conversation context; do not scrub history.
- Shared summary cross-references query the same namespace, excluding the video's own ID. Retain related video IDs
  and filter referenced titles to the reader's eligible channels when displaying them.

## API shape

Hono app in `apps/api/src/index.ts`. Keep routes thin; logic lives in `do/` and `lib/`.
Request/response types live in `packages/shared` and are imported by `apps/web`.

Target resource contract (not a claim that these routes are implemented):

| Route | Purpose |
|---|---|
| `POST /chats` / `GET /chats` | Create an empty chat / list the user's chats |
| `GET /chats/:id/messages?limit=50` | That chat's messages and citation snapshots |
| `POST /chats/:id/messages` `{ message }` | Reply and sources, using current eligible follows |
| `GET /digest?since=<iso>` | Eligible followed-channel summaries, newest first; default last 24h; mark returned items read |
| `GET /channels` | Available, non-deleted catalog, with user follow state |
| `GET /channels/:id` | Available catalog channel; summaries/counts for followers; mark only returned summaries read |
| `GET /follows` | User's follow list and current channel availability/counts |
| `PUT /follows/:channelId` / `DELETE /follows/:channelId` | Explicit follow/refollow / retained unfollow tombstone |
| `POST /channel-requests` `{ url }` / `GET /channel-requests` | Request a channel / list own requests and processing status |
| `GET /preferences` / `PUT /preferences` | User's chat rules |
| `GET /owner/channels` / `POST /owner/channels` | Inspect all catalog states / configure a channel |
| `GET /owner/channel-requests` | Review all users' requests |
| `POST /owner/channel-requests/:id/approve` or `/reject` | Owner review with optional explanation |
| `POST /owner/channels/:id/retry` | Reset failed channel to pending and start retry |
| `DELETE /owner/channels/:id` / `POST /owner/channels/:id/restore` | Soft-delete / restore the shared channel |

All routes require `X-User-Email`; missing or malformed returns 400. Owner routes additionally require the trusted
owner check (see open decision). Validate chat ownership in the caller's User DO. JSON everywhere, no API HTML.
There are no chat deletion routes and no per-channel chats.

## Web UI (`apps/web`)

- Vite + Preact + TypeScript. Routing with `preact-iso` (hash or history — pick one and use it everywhere).
  Approved dependencies for `apps/web`: `preact`, `preact-iso`, `vite`, `@preact/preset-vite`. Anything else requires approval.
- No UI component library, no CSS framework, no state library. One plain CSS file; `useState`/`useReducer` for state.
- Import request/response types from `packages/shared`. `src/api.ts` is the only place `fetch` is called; it sets
  `X-User-Email` from `account.ts` and the API base URL from `import.meta.env.VITE_API_URL`.
- Text only. No images, avatars, thumbnails, or rich embeds. Structured text (lists, headings) is fine.
- Render assistant messages as plain text with newlines preserved. Linkify `youtube.com` URLs only; when a chat
  `source` has `startSec`, link to `https://youtu.be/<videoId>?t=<startSec>`.
- Pages build: root directory `/` (repo root, so pnpm workspaces resolve), command `pnpm build`, output `apps/web/dist`.

### Screens

**`/` — Account.** A single email input ("Who is this for?" — do not call it sign in). Below it, a list of
previously used emails from `localStorage` for one-click selection. If an email is already selected, skip
straight to `/home`. A "switch account" link is visible on every other screen.

**`/home` — Home.** First-time users are presented with the available channel catalog to follow. Returning users
see their digest, chat list/selected conversation, and channels:
1. **Today's digest** — eligible followed channels only; last 24h, with shared summary/takeaways and links.
   Empty state: "Nothing new since yesterday."
2. **Chats** — list/create/select independent conversations. Preserve each chat's messages and source links.
   Never disable chat controls for lack of follows; use the fixed follow-required response above.
3. **Channels** — available catalog with follow/unfollow controls, plus followed-channel rows with last ingestion,
   processed video count, and per-user unread count. Show requests separately with approval, processing state,
   failure reason, and owner explanation. A "Request channel" URL input submits for approval; poll about every 15s
   while own requests await approval or approved channels are pending. Request completion automatically follows once.

**`/channel/:id` — Channel.** Available channel header, with shared summaries newest first for followers; viewing
marks returned summaries read for this user. Non-followers can follow an available channel. No chat input here;
conversations live on Home. Back link to `/home`.

Owner catalog management is required, but a general admin dashboard is not. Owner identity/mechanism is `TODO(owner)`.

## Testing

Vitest with `@cloudflare/vitest-pool-workers` for everything in `apps/api`. Bindings come from `wrangler.jsonc`.
Workers AI and Vectorize are not available locally in tests — wrap them behind `lib/ai.ts` / `lib/vectorize.ts`
interfaces and inject fakes.

Tests are focused, not exhaustive. Required coverage:

- **Isolation and retrieval scope** — two emails with overlapping and disjoint follows; private chats, preferences,
  requests, and read receipts remain isolated. Shared ingestion produces one canonical episode/vector set. Every
  Vectorize call uses `shared-catalog`; chat queries carry only eligible channel IDs. Prove changes to follows and
  deletion/restoration affect existing chats, history remains intact, and zero eligible channels skip AI/Vectorize.
- **Lifecycle and retry** — approval and first processed episode unlock availability; no-caption and technical failures
  remain distinct; failed channels require owner retry; stale run writes are rejected. Automatic-follow retries never
  reverse an unfollow. Restore preserves follows/read receipts. Test owner-only mutations and own-request visibility.
  Add or extend these tests whenever a route or data path is introduced.
- **Pure functions** — chunking (token caps, overlap, edge cases: empty, one segment, very long segment),
  RSS parsing, channel URL resolution, summary JSON validation.
- **Migrations** — a fresh DO runs all migrations idempotently; running twice is a no-op.

Don't write tests for Hono plumbing, Preact components, or Workflow step ordering. `apps/web` has typecheck and lint only. Don't mock what you can run for real
(DO storage, SQLite).

## Code style

- Biome defaults. Run `pnpm lint -- --write` before finishing.
- Named exports only. No default exports except where Cloudflare requires them (Worker entry, DO/Workflow classes).
- No `any`. Use `unknown` and narrow. Validate all external input (request bodies, RSS XML, AI JSON) at the boundary.
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

- Cron cadence and times — `TODO(owner)` in `wrangler.jsonc`.
- Owner identification and management interface in the trusted, unauthenticated deployment — `TODO(owner)`.
- Retention: keep all chats and shared/user records for now; any future retention policy requires an owner decision.
