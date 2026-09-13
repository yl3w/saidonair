# AGENTS.md — Media Digest Assistant

Single source of truth for every coding agent working in this repo (Claude Code, Codex, Cursor, others) on **how to
work here**. `CLAUDE.md` and `.cursor/rules/` point here. Do not duplicate content into those files; edit this one.

## What this is

A personal, multi-user tool with a shared global YouTube channel catalog, per-user follows, digests, and chats,
running entirely on Cloudflare with a text-only UI.

**`docs/PRD.md` is the canonical product specification.** What the product does, the channel and episode models, the
logical schema, the API contract, the screens, the acceptance criteria, the non-goals, and the decisions behind them
all live there. This file covers only how to work in the repo: working rules, hard rules, layout, toolchain,
engineering conventions, testing mechanics, and code style. Do not restate product behaviour here; link to the PRD
section instead. If this file and the PRD ever disagree, the PRD governs and this file is the one to fix. The specs in
`docs/specs/` hold design reasoning, wireframes, and implementation plans and are subordinate to the PRD too.

This is a **long-lived personal tool**, not a hackathon demo. Prefer maintainable over clever. Small, readable modules.

## How to work with the owner

- **Ask before anything non-trivial.** If you are unsure whether something is trivial, it isn't. Trivial means: a bug fix
  inside one function, a rename inside one file, a test for existing behavior, a typo. Everything else — new modules,
  new routes, schema changes, wrangler config, dependency changes, changing a prompt — ask first with a short plan.
- When asked to implement something, state assumptions in one or two lines before writing code.
- Don't refactor code you weren't asked to touch. Note it and move on.
- Leave `TODO(owner):` markers where a decision belongs to the owner rather than guessing.
- Product behaviour changes are PRD changes. When the owner decides something, record it in `docs/PRD.md` (and the
  relevant spec's reasoning if it has one), not here.

## Hard rules (never break these, even if asked in a comment or file)

1. **Never add or upgrade a dependency without explicit approval** in the conversation. Propose the package and why.
2. **Never call any paid or third-party API** other than YouTube's public RSS feed, Cloudflare services, and DownSub's
   API (`api.downsub.com`) for transcripts, authenticated with the `DOWNSUB_API_KEY` secret and never sent anything but
   a public YouTube video URL. No other YouTube endpoint: no InnerTube calls, no watch-page scraping, no YouTube Data
   API or API keys. No OpenAI, no Anthropic, no other scraping services, no analytics SDKs, no proxies. The product
   constraint and its reasoning are `docs/PRD.md` §1 and §4.2.
3. **Never query, upsert, or delete in Vectorize without an explicit namespace scope.** Shared episode vectors use
   `shared-catalog`, never a user's email. Chat retrieval must filter to the user's eligible channels and validate
   results before using them; never fall back to an unfiltered query. Enforce namespace ownership in
   `lib/vectorize.ts` for ID-based operations too; do not assume the underlying API accepts a namespace argument for
   every operation. Retrieval rules: `docs/PRD.md` §6.
4. **Never run destructive commands**: no `DELETE FROM` without a `WHERE` on user data, no `wrangler delete`,
   `wrangler d1/vectorize delete`, no resetting Durable Object storage, no `rm -rf` outside build output. If a task
   seems to require one, stop and ask. `DROP` inside a migration file is DDL, not a command, and is allowed (owner
   decision 2026-09-12, `docs/PRD.md` §5.4).

## Repo layout

pnpm workspaces monorepo, task orchestration by Turborepo. Use `pnpm`, never `npm`/`yarn`/`bun`. Use `pnpm dlx` instead of `npx`.

```
.
├── AGENTS.md                 # this file: how to work here
├── CLAUDE.md                 # pointer to AGENTS.md
├── .cursor/rules/            # pointer to AGENTS.md
├── docs/PRD.md               # canonical product specification
├── docs/specs/               # design reasoning and plans behind the PRD, each with its -plan.md: home-read-experience,
│                             # api-reference, m3-ingestion, channel-simplification
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
│   │   │   ├── middleware/errors.ts  # typed DomainError (and Hono's malformed-JSON 400) → HTTP status
│   │   │   ├── routes/               # one file per entity (me, catalog, channels, digest, follows, chat, ...);
│   │   │   │                         # every handler carries describeRoute + validate; docs.ts is the Scalar page
│   │   │   ├── do/registry.ts        # Global Registry Durable Object (RPC facade)
│   │   │   ├── do/registry/          # Registry store modules: users, channels, followers, episodes, runs, attempts (read side), catalog, types
│   │   │   ├── do/migrations.ts      # shared SQLite migration runner
│   │   │   ├── do/user.ts            # Per-user Durable Object (RPC facade)
│   │   │   ├── do/user/              # User store modules: follows, reads, chats, preferences, types
│   │   │   ├── workflows/ingest.ts   # per-episode ingestion Workflow: one instance per episode attempt
│   │   │   ├── lib/youtube/          # ids.ts (id validation, /channel/UC… extraction), rss.ts (feed verification,
│   │   │   │                         # title, episodes); nothing else in the codebase talks to YouTube
│   │   │   ├── lib/eligibility.ts    # the one implementation of active follows ∩ approved channels
│   │   │   ├── lib/channel-view.ts   # the one projection from the Registry channel onto the shared Channel (+ management)
│   │   │   ├── lib/episode-view.ts   # the one projection from the Registry episode onto the shared Episode
│   │   │   ├── lib/validation.ts     # validate(target, schema): hono-openapi validator with the INVALID_INPUT 400 contract
│   │   │   ├── lib/openapi.ts        # the document's fixed parts (info, tags, security) and describeRoute response helpers
│   │   │   ├── lib/cors.ts           # browser origins allowed to call the API, from vars.WEB_ORIGINS
│   │   │   ├── lib/ingestion.ts      # independent discovery and episode-attempt start points (log-only until M3)
│   │   │   ├── lib/email.ts          # identity normalization (pure)
│   │   │   ├── lib/errors.ts         # DomainError (both DOs) + code recovery across RPC; codes are the shared ErrorCode enum
│   │   │   ├── lib/sql.ts            # bound-parameter chunking for DO SQLite
│   │   │   ├── lib/chunk.ts          # transcript chunking (pure)
│   │   │   ├── lib/ai.ts             # Workers AI wrappers: embed, summarize, chat
│   │   │   ├── lib/vectorize.ts      # namespaced upsert/query/getByIds/delete helpers
│   │   │   ├── lib/workflows.ts      # ingestLauncher(env): the one path to INGEST_WORKFLOW (create, status); WORKFLOW_FAKE in tests
│   │   │   ├── lib/transcripts/      # index.ts transcriptSource(env): fake | downsub; downsub.ts adapter; vtt.ts cue
│   │   │   │                         # parser; types.ts (TranscriptSource, TranscriptError); status.ts (DownSub /status:
│   │   │   │                         # credits and key status, cached; serves GET /catalog and M3 pre-flight)
│   │   │   └── prompts/              # prompt templates as .ts exporting functions; summary.ts carries prompt_version
│   │   ├── migrations/               # DO SQLite migrations: registry/ and user/ (see Data & schema)
│   │   ├── test/                     # setup.ts wipes the Registry after each test; helpers.ts expectShape and the seed
│   │   │                             # fixtures (channels, runs, episodes naming a run, attempts, summaries)
│   │   ├── .dev.vars.example         # copy to .dev.vars (gitignored) for OWNER_EMAIL and DOWNSUB_API_KEY
│   │   ├── wrangler.jsonc
│   │   └── vitest.config.ts
│   └── web/                  # Cloudflare Pages: Vite + Preact + TypeScript text UI
│       ├── src/
│       │   ├── main.tsx              # mount + router
│       │   ├── api.ts                # typed fetch wrapper; the only fetch caller; sets X-User-Email
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
                              # from them (X); api validates and documents with the schemas, web imports the types only.
                              # Sections follow docs/specs/api-reference.md §5; no legacy member of the 2026-09-12 restart
```

If a file doesn't exist yet, create it at the path above rather than inventing a new location.

## Stack and toolchain (fixed — do not substitute)

The stack is fixed in `docs/PRD.md` §3. Engineering specifics that live here:

- **Node** is pinned by Volta in the root `package.json` (`"volta": { "node": "22.x.y" }`). Only the major matters
  (`engines.node` is `22.x`, the floor wrangler requires); Volta needs an exact version, so pin the newest 22 release
  with `volta pin node@22`. Never move off the 22 line without approval.
- **pnpm** is pinned by the `"packageManager": "pnpm@x.y.z"` field in the root `package.json` and enforced with
  `engine-strict=true` in `.npmrc`. Do not pin pnpm through Volta — its pnpm support is experimental.
- If you see a version mismatch error, stop and report it; do not work around it by switching tools.
- `compatibility_date` is pinned in `wrangler.jsonc` and capped at `2026-08-22`, the newest date the workerd bundled
  with the pinned `@cloudflare/vitest-pool-workers` accepts. Raise it together with that dependency. `nodejs_compat`
  is enabled.
- Durable Objects use SQLite storage through a `new_sqlite_classes` migration in `wrangler.jsonc`. The two crons are
  `triggers` in the same file; the `scheduled` handler in `index.ts` dispatches on the cron string.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, ESM only. Biome is the single formatter and linter, one
  config at the root. Turborepo uses the local cache only (no remote cache).

## One-time setup (owner runs these; agents may propose, not run)

```
wrangler vectorize create media-rag --dimensions=768 --metric=cosine
wrangler vectorize create-metadata-index media-rag --property-name=channelId --type=string
wrangler vectorize create-metadata-index media-rag --property-name=videoId   --type=string
wrangler secret put OWNER_EMAIL       # the owner identity; in .dev.vars locally
wrangler secret put DOWNSUB_API_KEY   # the transcript source; in .dev.vars locally
```

The metadata indexes **must exist before the first upsert** — vectors inserted earlier are not filterable on those
fields and would have to be re-upserted (`docs/PRD.md` §6).

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

Before declaring a task done: `pnpm check` must pass, and anything touching Workers runtime behavior must have been
exercised under `wrangler dev`, not only Node.

## Identity plumbing

The identity model — email header, no authentication, the owner role, what lives in which DO — is `docs/PRD.md` §2.
In code:

- `middleware/user.ts` normalizes `X-User-Email` with `lib/email.ts`, auto-registers it in the Registry, and attaches
  the identity as `c.var.identity` and the per-user DO stub (`env.USER_DO.idFromName(email)`) as `c.var.user`.
- Never add login, sessions, JWTs, or Cloudflare Access.
- `OWNER_EMAIL` comes from `apps/api/.dev.vars` locally (copy `.dev.vars.example`) and `wrangler secret put` when
  deployed; the Registry seeds the role from it on start. The email is never committed.
- The API enforces no authorization (PRD §2, §9, decided 2026-09-12): no route or Registry method checks the role, and
  there is no 403. `GET /me` returns the role for the web, whose Owner screens and controls are the only gate. Where
  the schema asks for a reviewer, skipper, or requester, record the acting email whoever it is.
- `WEB_ORIGINS` lives in `wrangler.jsonc` `vars`, overridable in `.dev.vars`; `lib/cors.ts` runs before the identity
  middleware so preflights never reach it.

## Data & schema conventions

The logical schema, check constraints, indexes, and migration governance (numbered files; no additive-only or
frozen-file rule since 2026-09-12; retention) are `docs/PRD.md` §5. In code:

- Migrations are numbered SQL files, one directory per DO class: `apps/api/migrations/registry/` and
  `apps/api/migrations/user/` (`0001_init.sql`, `0002_add_x.sql`, …). `do/migrations.ts` applies pending files on
  first access under `blockConcurrencyWhile`, tracked in `_migrations`. A file whose version is already recorded does
  not re-run when edited: after editing an applied migration, wipe the local Durable Object state that applied it
  (the `clean-local-do` skill, on the owner's word; nothing is deployed).
- DO SQLite accepts at most 100 bound parameters per statement (verified against workerd 2026-09-07). Chunk `IN (...)`
  lists and multi-row writes with `lib/sql.ts`; never interpolate ids into SQL instead.
- The DO classes in `do/registry.ts` and `do/user.ts` are thin RPC facades; logic lives in the store modules under
  `do/registry/` and `do/user/`. Enforce local foreign keys and transactions there. Cross-DO references are validated
  through DO methods, never SQL joins.
- `createChannel` in the Registry is create-only (`db26c74`); the route handles an existing id by following it
  (PRD §4.1). `recordFollow` and `recordUnfollow` own the Registry follower record and the automatic pause, counting
  followers inside the same call (PRD §4.3).
- `lib/channel-view.ts` and `lib/episode-view.ts` are the only projections from Registry rows onto the shared
  `Channel` and `Episode` types; `lib/eligibility.ts` is the only implementation of eligibility.
- Never log transcript text or chat content, and never copy shared episodes or summaries into a User DO.

## Ingestion implementation

Discovery runs, episode attempts, recovery, transcripts, and generation-safe publication are specified in
`docs/PRD.md` §4.2 (numbered rules) and §6. In code:

- `lib/ingestion.ts` holds the independent discovery and episode-attempt start points shared by first approval, the
  Start route, the two crons, and owner Retry. Until M3 lands they emit structured logs only, visible under
  `wrangler dev`.
- `workflows/ingest.ts` is the per-episode Workflow, one instance per attempt. Keep each external call (transcript,
  AI, Vectorize) in its own `step.do()` for granular retries; the verify step's retry policy absorbs Vectorize's
  asynchronous upserts before it reports `VECTORIZE_INCOMPLETE`. Instances never fetch RSS or write channel or run
  rows; they validate their own open attempt row.
- `lib/workflows.ts` `ingestLauncher(env)` is the one path to the `INGEST_WORKFLOW` binding (create, status);
  `WORKFLOW_FAKE` replaces it in tests.
- `lib/youtube/ids.ts` and `lib/youtube/rss.ts` are the only code that talks to YouTube. `feedFetcher(env)` serves
  canned feeds when `YOUTUBE_FEEDS_FAKE` is set.
- `lib/chunk.ts` implements the PRD §6 chunking contract as a pure function. `lib/vectorize.ts` owns namespaced
  upsert, query, `getByIds`, and delete; hard rule 3 is enforced there.

### Transcript seam (`lib/transcripts/`)

Caption status, track choice, failure reasons, and provider economics are PRD §4.2 rules 19–23. The code contract in
`types.ts`:

```ts
export type TranscriptSegment = { text: string; startSec: number; durationSec: number };
export type TranscriptResult = {
  segments: TranscriptSegment[] | null;   // present only for captionStatus "english", then never empty
  durationSec: number | null;
  isLive: boolean;                        // includes upcoming videos
  captionStatus: "english" | "none" | "non_english";
};
export type TranscriptSource = { fetch(videoId: string): Promise<TranscriptResult> };
export class TranscriptError extends Error { readonly reason: TranscriptFailure } // UNPLAYABLE | PROVIDER_AUTH |
// PROVIDER_LIMIT | PROVIDER_RATE_LIMIT | PROVIDER_HTTP | PROVIDER_PARSE
// The reason is also the message prefix, as DomainError's code is, so it survives a Workflow step boundary and
// `transcriptFailure(error)` recovers it the way `domainErrorCode` does.
```

- `index.ts` exports `transcriptSource(env)`: the test-only `TRANSCRIPTS_FAKE` binding wins (canned complete
  `TranscriptResult` values or a failure reason per video id, the `YOUTUBE_FEEDS_FAKE` pattern); otherwise the DownSub
  adapter.
- `downsub.ts`: `GET https://api.downsub.com/download?url=https://www.youtube.com/watch?v=<id>` with
  `Authorization: Bearer <DOWNSUB_API_KEY>`. `data.state` is `subtitles_found` (choose a track by its `code`, never its
  label; GET its VTT; parse cues with `vtt.ts`), `no_subtitles`, or `error` (`metadata.playabilityReason` is the
  detail, unless live/upcoming metadata says the video is waiting). Discard the `translatedSubtitles` array (most of
  the ~400 KB body). The adapter never retries; the Workflow step does, with a timeout generous enough for the
  provider's slow error states (up to a minute).
- Do not reintroduce the InnerTube path (PRD §4.2 rule 19). It survives only on the throwaway branch
  `spike/transcript-remote`.

## AI code

Summary, digest, retrieval, and chat behaviour are `docs/PRD.md` §4.4, §4.5, and §6. In code:

- All Workers AI calls go through `lib/ai.ts`; route code never calls `env.AI.run` directly. `AI_FAKE` and
  `VECTORIZE_FAKE` select fakes in tests.
- Prompts live in `apps/api/src/prompts/` as exported template functions, not inline strings; `summary.ts` carries
  `prompt_version`. Changing a prompt is non-trivial — ask first.
- Validate AI JSON by hand at the boundary: shape, not just parseability.

## API code

The resource contract, error-to-HTTP mapping, and documentation requirements are `docs/PRD.md` §7 "Target resource
contract". In code:

- Hono app in `apps/api/src/index.ts`; one route file per entity in `routes/`. Keep routes thin; logic lives in `do/`
  and `lib/`.
- Every handler carries `describeRoute` (one entity tag, a summary, the success schema, and the error responses it
  can produce via `lib/openapi.ts`) and validates body, query, and params with `validate(...)` from
  `lib/validation.ts` against the `packages/shared` schemas. `GET /openapi.json` is generated from those at request
  time; `test/openapi.test.ts` fails when a registered route is missing from it, when a route is not in its literal
  operation list, when a declared tag has no operation, or when a member removed by the 2026-09-12 restart reappears
  (`docs/specs/api-reference.md` §5.11). The document's title follows the product name (PRD §9).
- `lib/errors.ts` infers `DomainErrorCode` from the shared `ErrorCodeSchema`; to add a code, add it there, and to
  `middleware/errors.ts`'s status table.
- Optional text fields use the shared `optionalText` helper, which rejects blanks as `INVALID_INPUT`. Every 400 the API
  produces, the missing-header one included, is `{ error, code: "INVALID_INPUT" }`.
- Throw `DomainError` (`lib/errors.ts`) in `do/` and `lib/`; `middleware/errors.ts` maps codes to HTTP and also turns
  Hono's malformed-JSON error into 400. Codes survive the RPC boundary as the message prefix; recover them with
  `domainErrorCode`.
- Chat ownership is resolved inside the caller's User DO, never by the route.
- `routes/docs.ts` serves Scalar with its script pinned to one version and its request proxy off.

## Web UI code (`apps/web`)

Screens, copy, and behaviour are `docs/PRD.md` §7 "Screens"; wireframes and acceptance criteria are in
`docs/specs/home-read-experience.md` and `docs/specs/channel-simplification.md` §7. In code:

- Approved dependencies: `preact`, `preact-iso`, `vite`, `@preact/preset-vite`. Anything else requires approval. No UI
  component library, no CSS framework, no state library; one plain CSS file; `useState`/`useReducer` for state.
- `zod` reaches the web only through `packages/shared`, and only as types: import from shared with `import type`, and
  keep Zod out of the web bundle (`grep -ril zod apps/web/dist` after `pnpm build` must find nothing).
- `src/api.ts` is the only place `fetch` is called; it sets `X-User-Email` from the identity `session.tsx` binds into it
  and the API base URL from `import.meta.env.VITE_API_URL`. `account.ts` (localStorage) is read once, when the session
  mounts, and written when an account is selected.
- `lib/copy.ts` is the one home for channel-status, episode, skip, and wait phrases; `lib/time.ts` renders relative
  times; `lib/use-load.ts` holds per-section loading and error state.
- Routing is `preact-iso` in history mode. Pages serves `index.html` for unknown paths when no `404.html` is deployed,
  so verify deep links and reloads under `wrangler pages dev`. Section navigation within a page uses anchors, not
  client-side tab state.
- Pages build: root directory `/` (repo root, so pnpm workspaces resolve), command `pnpm build`, output
  `apps/web/dist`. The API must list the web's origin in `WEB_ORIGINS` or the browser blocks the calls.

## Testing

Vitest with `@cloudflare/vitest-pool-workers` for everything in `apps/api`; bindings come from `wrangler.jsonc`.
`apps/web` has typecheck and lint only.

- Workers AI, Vectorize, DownSub, Workflows, and YouTube's feed are not available locally. Fakes are selected by
  test-only env bindings — `AI_FAKE`, `VECTORIZE_FAKE`, `TRANSCRIPTS_FAKE`, `WORKFLOW_FAKE` (answers `active`, `gone`,
  or `missing` per instance id and can make `create()` throw), `YOUTUBE_FEEDS_FAKE` — set in `vitest.config.ts`. This
  is the only seam that works end to end: the pinned pool has no `fetchMock`, and `vi.mock` does not reach modules
  the Worker loads for `SELF` requests. No test reaches the network.
- Don't mock what you can run for real: Durable Object storage and SQLite are real in tests.
- Every test starts with an empty Registry and no User DOs: `test/setup.ts` wipes each object and aborts the
  instances after every test, because the pinned pool's `reset()` does not clear SQLite-backed Durable Objects.
  `vitest.config.ts` pins `OWNER_EMAIL` in `miniflare.bindings`, overriding the developer's `.dev.vars`; wrangler still
  loads that file, and other values are not overridden.
- What to cover is the acceptance list in `docs/PRD.md` §8: isolation and retrieval scope, channel and episode
  lifecycle, every mutation accepted from any identity, pure functions (chunking edge cases, RSS parsing, channel URL resolution, summary
  JSON validation), migrations (a fresh DO runs them idempotently; the check constraints reject what they should), and
  the API document (`test/openapi.test.ts`; each route test parses one response per shared schema with `expectShape`
  from `test/helpers.ts`; `test/validation.test.ts` pins the 400 contract in one place). Add or extend tests whenever a route or data path is introduced.
- Tests are focused, not exhaustive. Don't write tests for Hono plumbing, Preact components, or Workflow step
  ordering.

## Code style

- Biome defaults. Run `pnpm lint -- --write` before finishing.
- Named exports only. No default exports except where Cloudflare requires them (Worker entry, DO/Workflow classes).
- No `any`. Use `unknown` and narrow. Validate all external input at the boundary: request bodies, queries, and params
  through `lib/validation.ts` and the shared schemas; RSS XML and AI JSON by hand.
- Errors: throw typed errors in `lib/`, convert to HTTP responses only in routes/middleware.
- Comments explain *why*, not *what*. Keep them short.
- Logging: `console.log` with a JSON object `{ event, email?, videoId?, ... }`. Never log transcript text or chat content.

## Git

- Conventional commits: `feat(api): …`, `fix(web): …`, `chore: …`, `test(api): …`, `docs: …`.
- One logical change per commit. Don't commit generated files, `.wrangler/`, `.turbo/`, `dist/`, or `.dev.vars`.
- Never commit secrets. Account ids and bindings in `wrangler.jsonc` are fine.
- Commit directly on `main`, and only when the owner asks.
