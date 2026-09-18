# Said on Air

Said on Air is a personal media digest assistant for a small, trusted group of
people. It maintains one shared catalog of YouTube channels, processes each
long-form episode once, and gives every user their own follows, digest, read
state, and conversations.

The project is a long-lived personal tool rather than a hosted public service.
Every feature milestone is built: the shared catalog, ingestion and summaries,
the reader's queue and reading column, owner curation, and chats that answer
from the channels you follow. What remains is a verification sweep of the
criteria in [`docs/PRD.md`](docs/PRD.md) §8.

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

Said on Air is intended for trusted deployments. Identity is supplied as an
email address by the client; the application deliberately does not implement
authentication or API authorization. The web app shows owner controls to the
owner role, and that is the only gate.

## Screens

Routing is history mode, so deep links and reloads work. There is one
navigation for everyone; the owner simply has one more destination.

| Route | Screen |
|---|---|
| `/` | Who this is for — an email, and the ones this browser has used |
| `/queue` | Unread summaries, grouped by the day they became readable |
| `/read/:episodeId` | One reading column, with `Ask` and `Done` |
| `/history`, `/history/:day` | The library, and the only place a read receipt is undone |
| `/sources`, `/sources/:id` | Following, catalog and declined channels; and one channel |
| `/chats`, `/chats/:id` | Conversations, each named by its first question |
| `/account` | Which email is reading, the reading type, size and theme |
| `/curate`, `/curate/:id` | The owner's decisions, catalog health, and recovery (desktop) |

## Architecture

```text
          Cloudflare Pages (Vite + Preact + daisyUI)
                            |
                     Hono API Worker
                            |
        +-------------------+--------------------+
        |                   |                    |
  Registry DO          User DO per email   Cloudflare Workflows
  catalog, follows,    read receipts,      one instance per attempt
  episodes, attempts,  chats, preferences   |-- YouTube public RSS
  runs, summaries                           |-- DownSub transcripts
                                            |-- Workers AI
                                            `-- Vectorize
                            |
  chat: embed the question -> Vectorize, filtered to eligible channels
  or one episode -> cross-encoder rerank -> Workers AI answer
```

The Registry Durable Object owns the shared catalog, follows, episodes,
discovery runs, processing attempts, and summaries. A separate User Durable
Object keeps each person's read state, chats, and preferences private. Shared
episode vectors live in the `shared-catalog` Vectorize namespace, in one index
per environment; publishing a summary promotes that attempt's staged vector
generation and deletes the generations it supersedes.

## Technology

- TypeScript, pnpm workspaces, and Turborepo
- Cloudflare Workers, Pages, SQLite Durable Objects, Workflows, Workers AI, and
  Vectorize
- Hono, Zod 4, and `hono-openapi` for the API, with Scalar as the reference page
- Preact, `preact-iso`, and Vite for the web app; Tailwind CSS 4 with daisyUI 5
  under one custom theme, and Lucide icons
- Workers AI: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for summaries and chat,
  `@cf/baai/bge-base-en-v1.5` for embeddings, `@cf/baai/bge-reranker-base` for
  chat relevance
- Vitest and the Cloudflare Workers test pool for the API; the web app is
  typechecked and linted
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

Set `OWNER_EMAIL` in `apps/api/.dev.vars`. `DOWNSUB_API_KEY` is optional for
starting the app, but transcript retrieval is unavailable without it. Never
commit secrets.

The development servers are available at:

- Web app: <http://localhost:5173>
- API: <http://127.0.0.1:8787>
- Interactive API reference: <http://127.0.0.1:8787/docs>
- OpenAPI document: <http://127.0.0.1:8787/openapi.json>

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

The Worker has isolated `dev`, `staging`, and `production` environments, each
with its own Durable Objects, Vectorize index, and Workflow. The top-level
Wrangler configuration is staging so a bare deployment cannot reach
production. Cron triggers exist in production only; staging and dev are driven
by hand.

```sh
pnpm --filter api deploy             # staging
pnpm --filter api deploy:production  # production
```

Deployment requires the environment's Cloudflare resources and secrets to be
provisioned first. See the [environment guide](AGENTS.md#environments) before
deploying.

## Repository structure

```text
apps/api/        Cloudflare Worker, Durable Objects, Workflows, and tests
apps/web/        Preact web application
packages/shared/ Shared Zod schemas and TypeScript API types
docs/            Product requirements, the design guide, and implementation plans
skills/          Repository-specific agent skills
scripts/         Skill installation and Vectorize verification
```

## Documentation

- [`docs/PRD.md`](docs/PRD.md) is the canonical product specification and
  records the current implementation milestones.
- [`docs/design.md`](docs/design.md) is the design guide: the principles, tokens,
  layout patterns, scale playbook, and accessibility floor every screen follows.
- [`AGENTS.md`](AGENTS.md) contains the engineering rules, environment model,
  commands, and contribution guidance for this repository.
- [`docs/specs/`](docs/specs/) contains design reasoning and implementation
  plans subordinate to the PRD.

Before contributing, read `AGENTS.md` and run `pnpm check` before considering a
change complete.
