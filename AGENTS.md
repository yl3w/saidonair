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
2. **Never call any paid or third-party API** other than YouTube and Cloudflare services. YouTube means its public,
   unauthenticated endpoints only: the RSS feed, and for transcripts one InnerTube `player` call made as a YouTube
   mobile client plus a GET of the caption-track URL it returns (see the transcript contract). No watch-page scraping,
   no YouTube Data API or API keys, no OpenAI, no Anthropic, no scraping services, no analytics SDKs, no proxies.
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
├── docs/specs/               # accepted feature specs; home-read-experience.md is the Home and Owner UX, -plan.md its two-phase implementation plan
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
│   │   │   ├── middleware/errors.ts  # typed Registry errors → HTTP status
│   │   │   ├── routes/               # one file per entity (me, catalog, channels, digest, follows, channel-requests, chat, ...)
│   │   │   ├── do/registry.ts        # Global Registry Durable Object (RPC facade)
│   │   │   ├── do/registry/          # Registry store modules: users, channels, requests, episodes, runs, catalog, types
│   │   │   ├── do/migrations.ts      # shared SQLite migration runner
│   │   │   ├── do/user.ts            # Per-user Durable Object (RPC facade)
│   │   │   ├── do/user/              # User store modules: follows, reads, chats, preferences, types
│   │   │   ├── workflows/ingest.ts   # channel ingestion Workflow
│   │   │   ├── lib/youtube/          # ids.ts (id validation, /channel/UC… extraction), rss.ts (feed verification,
│   │   │   │                         # title, episodes), transcript.ts (see contract below)
│   │   │   ├── lib/eligibility.ts    # active follows ∩ available, non-deleted channels (digest, follows, episodes, chat)
│   │   │   ├── lib/outcome.ts        # RequestOutcome + CatalogState derivation (pure)
│   │   │   ├── lib/channel-view.ts   # the one projection from the Registry channel onto the shared Channel (+ management)
│   │   │   ├── lib/episode-view.ts   # the one projection from the Registry episode onto the shared Episode
│   │   │   ├── lib/body.ts           # request body / query narrowing; every failure is INVALID_INPUT
│   │   │   ├── lib/ingestion.ts      # ingestion start points (log-only until M3)
│   │   │   ├── lib/email.ts          # identity normalization (pure)
│   │   │   ├── lib/errors.ts         # DomainError (both DOs) + code recovery across RPC
│   │   │   ├── lib/sql.ts            # bound-parameter chunking for DO SQLite
│   │   │   ├── lib/chunk.ts          # transcript chunking (pure)
│   │   │   ├── lib/ai.ts             # Workers AI wrappers: embed, summarize, chat
│   │   │   ├── lib/vectorize.ts      # namespaced upsert/query helpers
│   │   │   └── prompts/              # prompt templates as .ts exporting strings
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
│       │   ├── lib/                  # time.ts (relative times), copy.ts (failure-code and outcome phrases)
│       │   ├── screens/              # Account.tsx, Home.tsx, Channel.tsx, Owner.tsx, OwnerChannel.tsx
│       │   └── components/           # Nav, OwnerCard, Digest, ChannelList, Requests, RequestQueue, CatalogHealth,
│       │                             # CatalogTable, AddChannel, Chat (M4)
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
  This is trusted, personal use. Do not add login, sessions, JWTs, or Cloudflare Access unless the owner asks.
- Middleware normalizes the email (trim, lowercase), **auto-registers unknown emails** in the Global Registry DO,
  and attaches the per-user DO stub (`env.USER_DO.idFromName(email)`) to Hono context as `c.var.user`.
- Registration creates an identity, not an ingestion subscription. Cron iterates shared catalog channels, not users.
- Private follows, read status, preferences, chats, messages, and citations live in the user's DO. Global identities,
  catalog approval requests, channels, episodes, and shared summaries live in the Registry DO. Requesters see only
  their own requests; the owner can review all requests. Never expose another user's private DO data.
- Only the owner can configure/approve, delete/restore, or retry catalog channels. Users can request and follow them.
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
- Never edit a migration file that has been committed. Add a new one.
- `snake_case` for tables and columns. Every table has `created_at INTEGER` (unix ms). Use `TEXT` for ids.
- The single Registry DO owns `global_users`, `channels`, `channel_requests`, `episodes`, `episode_summaries`,
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
  Preserve read receipts through unfollow and channel deletion/restoration.
- Retain chats, messages, requests, follow tombstones, episodes, summaries, and vectors. Deletion is soft.

## Catalog, requests, and follows

- Users supply the channel id: a bare `UC…` id or any URL containing `/channel/UC…` (on YouTube: channel page → About →
  Share channel → Copy channel ID). `@handle` and `/c/…` URLs are rejected with `INVALID_INPUT` and those instructions;
  there is no handle resolution (decided 2026-09-07). Before recording a request, fetch the id's RSS feed: 404 means no
  such channel (`INVALID_INPUT`); success supplies the channel title, stored on the request (`channel_title`) so every
  request list shows a name. Requests retain requester, submitted input, channel id, title, approval/rejection status,
  and optional owner explanation. One request per `(user_email, youtube_channel_id)`; multiple requesters share one
  approved channel and ingestion pipeline. Requests do not configure catalog channels before approval.
- A request for a channel that is already available and not deleted is refused with `INVALID_STATE` and the channel
  id, so the UI can offer Follow instead. No request row is created; nobody should request what they can already
  follow. Pending, failed, and deleted channels can still be requested.
- Approving a request whose channel is deleted is refused with `INVALID_STATE` ("restore it first"), the rule retry
  already follows. `approveRequest` enforces it in the Registry; the UI only reflects it. (Changed 2026-09-07 from
  silently reusing the deleted channel.)
- Creating a channel needs a title: approval uses the title stored on the request; owner add verifies the id against
  its RSS feed and uses the feed title. The owner may override either. If the feed fetch fails and none was given,
  reject with `INVALID_INPUT` so the UI can ask for it.
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
- Channel identity is the canonical `UC…` id; the feed is `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`.
  Ids and `/channel/UC…` URLs validate offline in `lib/youtube/ids.ts`. There is no resolution of `@handle` or
  `/c/…` URLs: the feed does not accept them, and users copy the id from the channel's About dialog instead.

### Transcript contract

`apps/api/src/lib/youtube/transcript.ts` must export:

```ts
export type TranscriptSegment = { text: string; startSec: number; durationSec: number };
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[] | null>;
// null = no captions available (not an error); throw on network/parse failure
```

The implementation is our own code, no library (decided 2026-09-07 after evaluating `youtubei.js` and
`youtube-transcript-plus`; both call the same endpoint underneath, and neither fits the dependency posture). The
mechanism, verified locally in a spike the same day:

1. `POST https://www.youtube.com/youtubei/v1/player` with `{ videoId, contentCheckOk, racyCheckOk, context }` as the
   **iOS** client: client name, version, device model, OS version, and User-Agent live in one constants object at the
   top of the file. When YouTube retires them, copy fresh values from `youtubei.js` (`utils/Constants.js`) or
   `youtube-transcript-plus`; watch both issue trackers for early warning. Never use the WEB client: without the
   player script it returns a stripped response with no caption tracks even when they exist.
2. Read `playabilityStatus.status` and `captions.playerCaptionsTracklistRenderer.captionTracks[]`
   (`baseUrl`, `languageCode`, `kind: "asr"` for auto-generated). Prefer a manual track over `asr`; accept `asr`
   when it is all there is. `TODO(owner):` language preference beyond "first manual, else first asr".
3. `GET` the chosen `baseUrl` with `fmt=json3` and map `events[].{ tStartMs, dDurationMs, segs[].utf8 }` to segments.
   JSON avoids the double-escaped entities in the XML format.

Return `null` only when playability is `OK` and there are no caption tracks. A non-OK playability (`LOGIN_REQUIRED`
is YouTube's bot check, `ERROR`/`UNPLAYABLE` is the video), a non-2xx response, or unparsable JSON **throws** with a
distinct reason code so ingestion records `failed`, never `no_transcript`. The fetcher does not retry; the Workflow
step does. **It must be verified working under `wrangler dev`, then from a Cloudflare IP (`wrangler dev --remote`)**:
YouTube treats datacenter traffic differently and the spike's remote leg is still outstanding. Document the approach
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

The API is modelled on entities, never on roles: no `/owner/*` namespace, no role-named types. Authorization is
per operation (**owner** below) and, on channels, per field: the owner receives the same representations as everyone
plus a `management` block, and `?scope=all` widens a collection for the owner. See `docs/specs/home-read-experience.md` §10.

| Route | Who | Purpose |
|---|---|---|
| `GET /me` | anyone | The caller's normalized email and `role` (`owner` or `user`); the UI uses it to show owner controls |
| `GET /catalog` | owner | The catalog's aggregate state: channels by state, stuck pending (pending, not deleted, no queued/running run), episodes processed/tracked, active runs, pending requests, last successful ingestion |
| `GET /channels` | anyone | Available, non-deleted channels with `following` and `processedCount`; `?scope=all` (owner) every state including deleted, each with `management` |
| `POST /channels` `{ channelId, title?, initialImportCount? }` | owner | Create a pending channel; the id is verified against its RSS feed and the feed title used unless given; 409 if already in the catalog |
| `GET /channels/:id` | anyone | One channel: readers only while available and non-deleted (404 otherwise); the owner any state, with `management` |
| `DELETE /channels/:id` / `POST /channels/:id/restore` | owner | Soft-delete / restore the shared channel |
| `POST /channels/:id/retry` | owner | Reset failed channel to pending and start retry |
| `GET /channels/:id/episodes?limit=` | anyone | Episodes newest first; followers and the owner get `summary`, `related`, `wasUnread`, and returned summaries are marked read for the caller; non-followers get episodes without summaries; the owner also gets `processing` |
| `GET /channels/:id/ingestion-runs` | owner | Runs newest first with per-episode outcomes |
| `GET /channels/:id/requests` | owner | Every user's requests for this channel |
| `GET /follows` | anyone (own) | Active follows, each embedding its `channel` and carrying `unreadCount` |
| `PUT /follows/:channelId` / `DELETE /follows/:channelId` | anyone (own) | Explicit follow/refollow of an available channel / retained unfollow tombstone |
| `GET /digest?since=<iso>` | anyone (own) | Eligible followed-channel episodes with summaries, newest first; default last 24h, clamped to 7 days; mark returned items read; `wasUnread` per item |
| `GET /channel-requests` | anyone (own); `?scope=all` owner | Requests with a derived `outcome` and the channel's current `state`; own by default, everyone's with `?scope=all` |
| `POST /channel-requests` `{ channelId }` | anyone | Request a channel by `UC…` id or `/channel/UC…` URL (400 `INVALID_INPUT` for handles, other URLs, or an id with no RSS feed; 409 `INVALID_STATE` + `channelId` when already available; records the feed title) |
| `POST /channel-requests/:id/approve` or `/reject` | owner | Owner review with optional explanation; approve creates the channel with the request's stored title unless one is given, and is refused with `INVALID_STATE` while the channel is deleted |
| `POST /chats` / `GET /chats` | anyone (own) | Create an empty chat / list the user's chats |
| `GET /chats/:id/messages?limit=50` | anyone (own) | That chat's messages and citation snapshots |
| `POST /chats/:id/messages` `{ message }` | anyone (own) | Reply and sources, using current eligible follows |
| `GET /preferences` / `PUT /preferences` | anyone (own) | User's chat rules |

All routes except `/health` require `X-User-Email`; missing or malformed returns 400. Owner routes additionally require
`role = 'owner'`: `requireOwner` from `middleware/owner.ts` is applied to those handlers and returns 403 early from
`c.var.identity`, and the Registry DO re-checks it inside every owner-only method, so the middleware is a convenience,
not the guard. Typed `DomainError`s map to HTTP in
`middleware/errors.ts`: `INVALID_INPUT` 400, `NOT_OWNER` 403, `NOT_FOUND` 404, `INVALID_STATE` 409. Validate chat ownership in the caller's User DO. JSON everywhere, no API HTML.
There are no chat deletion routes and no per-channel chats.

## Web UI (`apps/web`)

- Vite + Preact + TypeScript. Routing with `preact-iso` in history mode; Pages serves `index.html` for unknown paths
  when no `404.html` is deployed, so verify deep links and reloads under `wrangler pages dev`. Section navigation
  within a page uses anchors, not client-side tab state.
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

**`/home` — Home.** One page for everyone, with section jump links. The header shows the email, the word `owner`
when applicable, and "Switch account"; the nav shows **Home** and, for owners, **Owner (n)** where `n` is the attention
count. Owners also see an attention card first ("2 requests waiting for review · 1 channel failed", from
`GET /catalog`) linking to `/owner#attention`; users never see it and it is hidden when the count is zero. Then:
1. **Today's digest** — eligible followed channels only (active follows ∩ available, non-deleted); last 24h, newest
   first, flat list with the channel as byline; shared summary, takeaways, tags, related titles filtered to eligible
   channels, and `youtu.be` links. Items with no read receipt at fetch time are marked NEW; returning them records the
   receipt. "Show last 7 days" widens `since`. Two empty states: with no active follows, "Follow a channel to start
   your digest." with the available catalog and follow controls rendered inline; otherwise "Nothing new since
   yesterday." Load `/follows` and `/channels` before `/digest` so unread counts and NEW markers agree.
2. **Channels** — three subsections. **Followed** (`GET /follows`): processed count, unread count, last ingestion,
   Unfollow; a followed channel that is deleted stays listed as unavailable and drops out of the digest.
   **Available** (`GET /channels` minus follows): processed count, Follow. **Your requests** (`GET /channel-requests`):
   channel title, id, one phrase from the derived `outcome`, owner explanation, and a "Request channel" input for a
   `UC…` id or `/channel/UC…` URL with one line saying where to copy it. An id that is already available gets
   "Already in the catalog" and a Follow button, not a request.
   Poll about every 15s only while a request is awaiting review, importing, or awaiting its automatic follow.
3. **Chats** — joins Home in M4; no placeholder before then. List/create/select independent conversations. Preserve
   each chat's messages and source links. Never disable chat controls for lack of follows; use the fixed
   follow-required response above.

**`/channel/:id` — Channel.** Available channel header, with shared summaries newest first for followers; viewing
marks returned summaries read for this user. Non-followers can follow an available channel. No chat input here;
conversations live on Home. Back link to `/home`.

**`/owner` — Owner.** Owner only: users are sent back to `/home` with a note, and the API returns 403 regardless. One
page, sections **Requests** and **Catalog**, jump links `#requests`, `#catalog`, `#attention`.
- **Requests.** Pending oldest first: requester, channel title, id linked to its YouTube page, that id's catalog state (not in catalog,
  pending, available, failed, deleted), "also requested by N", Approve and Reject with an optional explanation. Approve
  is refused for a deleted channel ("restore it first"). Reviewed requests are collapsed, with reviewer, time,
  explanation, and whether the automatic follow was delivered.
- **Catalog.** Health strip from `GET /catalog`. **Needs attention**: failed non-deleted channels with a
  humanized failure code, detail, latest run, and Retry; and pending non-deleted channels with no queued or running
  run, at any age, with how long they have waited. **All channels**: state, processed/tracked episodes with no-caption
  and failed counts, last ingested, latest run, requester count, and Retry/Delete/Restore (Delete confirms once). An
  "Add a channel" form calls `POST /channels`. Requester count stands in for follower count, which lives only in
  User DOs and is not shown.

**`/owner/channels/:id` — Owner channel detail.** From `GET /channels/:id` (with `management`), `/episodes`,
`/ingestion-runs`, and `/requests`: header with state, failure code and
detail, `available_at`, lifecycle version, import count, and actions; episodes with status, attempts, failure code,
chunk count, processed time, and summary format; runs with per-episode outcomes; requests with auto-follow state.
Never shows any user's read or chat activity.

Owner catalog management is required, but a general admin dashboard is not: `/owner` shows only what supports approve,
reject, retry, delete, and restore. Render owner controls only when `GET /me` returns `role: "owner"`; the client's role
is for rendering, and authorization happens per request in the Registry. Humanized copy for failure codes and request
outcomes, wireframes, load order, and acceptance criteria are in `docs/specs/home-read-experience.md`.

## Testing

Vitest with `@cloudflare/vitest-pool-workers` for everything in `apps/api`. Bindings come from `wrangler.jsonc`.
Workers AI and Vectorize are not available locally in tests — wrap them behind `lib/ai.ts` / `lib/vectorize.ts`
interfaces and inject fakes. The same pattern already covers YouTube's feed: `lib/youtube/rss.ts` `feedFetcher(env)`
serves canned feeds when the test-only `YOUTUBE_FEEDS_FAKE` binding is set in `vitest.config.ts`, so no test reaches
the network. The pinned `@cloudflare/vitest-pool-workers` has no `fetchMock`, and `vi.mock` does not reach modules the
Worker loads for `SELF` requests, so env-selected fakes are the only seam that works end to end.

Tests are focused, not exhaustive. Required coverage:

- **Isolation and retrieval scope** — two emails with overlapping and disjoint follows; private chats, preferences,
  requests, and read receipts remain isolated. Shared ingestion produces one canonical episode/vector set. Every
  Vectorize call uses `shared-catalog`; chat queries carry only eligible channel IDs. Prove changes to follows and
  deletion/restoration affect existing chats, history remains intact, and zero eligible channels skip AI/Vectorize.
- **Lifecycle and retry** — approval and first processed episode unlock availability; no-caption and technical failures
  remain distinct; failed channels require owner retry; stale run writes are rejected. Automatic-follow retries never
  reverse an unfollow. Restore preserves follows/read receipts. Test owner-only mutations and own-request visibility.
  A request for an already-available channel is refused and creates no row; handles and ids with no feed are
  rejected. Owner overview and channel-health counts match SQL-seeded episodes and runs. Add or extend these tests
  whenever a route or data path is introduced.
- **Pure functions** — chunking (token caps, overlap, edge cases: empty, one segment, very long segment),
  RSS parsing, channel URL resolution, summary JSON validation.
- **Migrations** — a fresh DO runs all migrations idempotently; running twice is a no-op.

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
- **Transcript fetch from a Cloudflare IP — not yet verified** (`TODO(owner)`, 2026-09-07). The mechanism in the
  transcript contract passed only from a residential IP under local `wrangler dev`. Both transcript libraries evaluated
  that day have users reporting captchas and `LOGIN_REQUIRED` from cloud IPs on the same endpoint. Before relying on
  ingestion: `wrangler login`, then run `lib/youtube/transcript.ts` under `wrangler dev --remote` against a video with
  manual captions, one with auto-generated only, and a bogus id. Pass = same segments as locally. If it fails, the
  approach needs rethinking for any implementation (no proxies, per hard rule 2), so do this before building M3 on it.
- Owner management interface — decided 2026-09-07: `/owner` and `/owner/channels/:id` as specified in the Web UI
  section and `docs/specs/home-read-experience.md`. Owner identification: `global_users.role`, seeded from the
  `OWNER_EMAIL` secret (see Identity model).
- `compatibility_date` is capped at `2026-08-22`, the newest date the workerd bundled with the pinned
  `@cloudflare/vitest-pool-workers` accepts. Raise it together with that dependency.
- Retention: keep all chats and shared/user records for now; any future retention policy requires an owner decision.
