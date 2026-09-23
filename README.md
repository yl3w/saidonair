# Said on Air

## Releases

- [v0](https://github.com/yl3w/saidonair/tree/v0) — Web hosted on Cloudflare Pages.
- [v1](https://github.com/yl3w/saidonair/tree/v1) — Web hosted on Cloudflare Workers with static assets.

## Overview

Said on Air is a personal media digest assistant for a small, trusted group of
people. It maintains one shared catalog of YouTube channels, processes each
long-form episode once, and gives every user their own follows, digest, read
state, and conversations.

The project is a long-lived personal tool rather than a hosted public service.
The v1 feature milestones and the M6 verification sweep are complete. The current
behavior and its known limits are documented in the
[feature guide](docs/features/v1/README.md).

## What it does

- Keeps a shared channel catalog with requests, owner review, and per-user
  follows.
- Discovers long-form uploads through YouTube's public RSS feed, reading the
  channel's uploads playlist so Shorts and live streams never become episodes.
- Fetches available captions, chunks transcripts, creates embeddings, and
  publishes shared episode summaries through a recoverable workflow, one
  Workflow instance per episode attempt.
- Builds a personalized queue and history from the channels each user follows,
  keeping read state private to that user.
- Answers questions in independent chats, each begun at a summary. Retrieval
  covers every channel the asker currently follows, or one episode when the
  message carries that scope; a cross-encoder decides what the answer is built
  from, and a reply's citations are the retrieval's rather than the model's.
- Gives the owner one screen to review channels, inspect catalog health, and
  recover episode processing failures.
- Publishes an OpenAPI 3.1 document and an interactive API reference.

Said on Air uses Google sign-in through better-auth. The API verifies a bearer
session, assigns a stable `user_id`, and enforces owner permissions for catalog
management and operational reads. The web also offers public catalog and summary
reading without a session. The API supports Facebook when configured, although
the current sign-in screen offers only Google.

## Screens

Routing is history mode, so deep links and reloads work. There is one
navigation for everyone; the owner simply has one more destination.

| Route | Screen |
|---|---|
| `/` | Public channel catalog |
| `/sign-in`, `/auth/callback` | Google sign-in and session handoff |
| `/queue`, `/queue/:day` | Unread summaries, one local day at a time |
| `/read/:episodeId` | Public summary reading; personal `Ask` and `Done` when eligible |
| `/history`, `/history/:day` | Personal history and read receipts |
| `/sources`, `/sources/:id` | Personal source list and public channel detail |
| `/chats`, `/chats/new`, `/chats/:chatId` | Personal conversations and composer |
| `/account` | Account details, appearance settings, and chat instructions |
| `/curate`, `/curate/:id` | Owner decisions, catalog health, and recovery (desktop) |

## Architecture

```text
Public and signed-in browser
        |
Cloudflare web Worker (static Vite/Preact assets + server-rendered public routes)
        | API service binding for server rendering; browser API calls use session bearer
Hono API Worker + better-auth
        |-- D1: authentication sessions and accounts
        |-- Registry DO: shared catalog, follows, episodes, attempts, summaries
        |-- User DO per user_id: receipts, chats, preferences
        |-- Workflows: one instance per episode attempt
        |-- Workers AI and Vectorize: summaries and grounded chat
        `-- YouTube public RSS and DownSub transcripts
```

The Registry Durable Object owns the shared catalog, follows, episodes,
discovery runs, processing attempts, and summaries. A separate User Durable
Object keeps each person's read state, chats, and preferences private. Shared
episode vectors live in the `shared-catalog` Vectorize namespace, in one index
per environment; publishing a summary promotes that attempt's staged vector
generation and deletes the generations it supersedes.

## Technology

- TypeScript, pnpm workspaces, and Turborepo
- Cloudflare Workers with static assets, D1, SQLite Durable Objects,
  Workflows, Workers AI, and Vectorize
- Hono, Zod 4, and `hono-openapi` for the API, with Scalar as the reference page
- Preact, `preact-iso`, and Vite for the web app; Tailwind CSS 4 with daisyUI 5
  under one custom theme, and Lucide icons
- Workers AI: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for summaries and chat,
  `@cf/baai/bge-base-en-v1.5` for embeddings, `@cf/baai/bge-reranker-base` for
  chat relevance
- Vitest with the Cloudflare Workers test pool for the API; Node Vitest tests for
  web logic, server rendering, and component rendering; TypeScript and Biome checks
- Biome for formatting and linting

## Local development

### Requirements

- Node.js 22 (the exact Volta version is pinned in `package.json`)
- pnpm 10.29.3
- A Cloudflare account authenticated through Wrangler
- The development Vectorize index and its metadata indexes provisioned as
  described in [`AGENTS.md`](AGENTS.md#one-time-setup-owner-runs-these-agents-may-propose-not-run)

Local development keeps Durable Object and Workflow state on your machine, but
uses account-backed Workers AI and the `media-rag-dev` Vectorize index.

### Start the app

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev
```

Set `OWNER_EMAIL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and
`GOOGLE_CLIENT_SECRET` in `apps/api/.dev.vars` to sign in locally. Register
`http://localhost:8787/auth/callback/google` with Google: the dev API uses
`API_BASE_URL=http://localhost:8787` from `apps/api/wrangler.jsonc`, and the
callback origin must match. Before the first sign-in, apply
[`apps/api/migrations/auth/0001_better_auth.sql`](apps/api/migrations/auth/0001_better_auth.sql)
to the local auth D1 database using the command in that file. Durable Object
migrations do not initialize D1. `DOWNSUB_API_KEY` is optional for starting the
app, but transcript retrieval is unavailable without it. Never commit secrets.

The development servers are available at:

- Web app: <http://localhost:5173>
- API: <http://localhost:8787>
- Interactive API reference: <http://localhost:8787/docs>
- OpenAPI document: <http://localhost:8787/openapi.json>

To start over with empty local state, ask an agent to run the `clean-local`
skill, which wipes the dev environment's Durable Object storage and, on
request, local Workflow state and the dev index's vectors. It refuses staging
and production.

## Commands

Run project commands from the repository root:

```sh
pnpm dev        # start the API and web app
pnpm build      # build workspace packages and the web app
pnpm typecheck  # run TypeScript checks
pnpm lint       # run Biome checks
pnpm test       # run the test suite
pnpm check      # run typecheck, lint, and tests
```

Two commands are not part of that pipeline:

```sh
pnpm verify:vectorize                     # the dev index's metadata indexes
pnpm verify:vectorize media-rag           # or any index by name
pnpm skills:install --agent claude-code   # install the agent skills for your agent
```

`pnpm check` cannot see a Vectorize index, and filtering on a property with no
metadata index returns zero matches rather than an error, so run
`pnpm verify:vectorize` after creating an index or renaming a filter property.

## Environments and deployment

The API and web Workers each have isolated `dev`, `staging`, and `production`
environments. The API has tier-specific Durable Objects, an auth D1 database, a
Vectorize index, and a Workflow. Cron triggers exist in production only; staging
and dev are driven by hand. The API's top-level Wrangler configuration is staging.
The web build selects its tier with `CLOUDFLARE_ENV` and embeds the matching API
service binding; use the package deploy scripts, which rebuild for that tier.

```sh
pnpm --filter api deploy             # staging
pnpm --filter api deploy:production  # production
pnpm --filter web deploy             # staging web
pnpm --filter web deploy:production  # production web
```

Deployment requires each tier's Cloudflare resources, auth D1 schema, OAuth
secrets and callback origins, and web/API origin configuration to be provisioned
first. See the [environment guide](AGENTS.md#environments) and
[auth phase](docs/specs/auth-phase.md) before deploying.

## Repository structure

```text
apps/api/        Cloudflare Worker, Durable Objects, Workflows, and tests
apps/web/        Preact web Worker, public server rendering, and tests
packages/shared/ Shared Zod schemas and TypeScript API types
docs/            Product overview, v1 features, design guide, and historical plans
skills/          Repository-specific agent skills
scripts/         Skill and hook installation, and Vectorize verification
```

## Documentation

- [`docs/PRD.md`](docs/PRD.md) records goals, shared constraints, and roadmap
  context; it links to the owning feature documents.
- [`docs/features/v1/`](docs/features/v1/README.md) describes implemented v1
  behavior, source references, tests, and known limits. The earlier
  [`docs/features/`](docs/features/README.md) snapshot is retained for history.
- [`docs/design.md`](docs/design.md) is the design guide: the principles, tokens,
  layout patterns, scale playbook, and accessibility floor every screen follows.
- [`AGENTS.md`](AGENTS.md) contains the engineering rules, environment model,
  commands, and contribution guidance for this repository.
- [`docs/specs/`](docs/specs/) contains historical design reasoning and
  implementation plans. The [API reference guide](docs/specs/api-reference.md)
  points to the current generated contract.
- [`docs/prompts/`](docs/prompts/) is the record of how this was built: every
  agent conversation that produced it, prompts and replies verbatim. Written by
  the `capture-conversation` skill, not by hand.

Before contributing, read `AGENTS.md` and run `pnpm check` before considering a
change complete.
