# Said on Air

Said on Air is a personal media digest assistant for a small, trusted group of
people. It maintains one shared catalog of YouTube channels, processes each
long-form episode once, and gives every user their own follows, digest, and read
state.

The project is a long-lived personal tool rather than a hosted public service.
It is under active development: shared ingestion, summaries, digests, and owner
operations are available; multi-chat retrieval is planned for the next product
milestone.

## What it does

- Keeps a shared channel catalog with requests, owner review, and per-user
  follows.
- Discovers long-form uploads through YouTube's public RSS feed.
- Fetches available captions, chunks transcripts, creates embeddings, and
  publishes shared episode summaries through a recoverable workflow.
- Builds a personalized digest from the channels each user follows while
  keeping read state private.
- Gives the owner tools to review channels, inspect catalog health, and recover
  episode processing failures.
- Publishes an OpenAPI 3.1 document and an interactive API reference.

Said on Air is intended for trusted deployments. Identity is supplied as an
email address by the client; the application deliberately does not implement
authentication or API authorization.

## Architecture

```text
Cloudflare Pages (Vite + Preact)
              |
       Hono API Worker
        /            \
Registry Durable   User Durable Object
Object             per email
        \
         Cloudflare Workflows
          |-- YouTube public RSS
          |-- DownSub transcripts
          |-- Workers AI
          `-- Vectorize
```

The Registry Durable Object owns the shared catalog, follows, episodes,
processing attempts, and summaries. A separate User Durable Object keeps each
person's read state and preferences private. Shared episode vectors live in the
`shared-catalog` Vectorize namespace.

## Technology

- TypeScript, pnpm workspaces, and Turborepo
- Cloudflare Workers, Pages, Durable Objects, Workflows, Workers AI, and
  Vectorize
- Hono, Zod, and OpenAPI 3.1 for the API
- Preact and Vite for the web app
- Vitest and the Cloudflare Workers test pool
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

## Environments and deployment

The Worker has isolated `dev`, `staging`, and `production` environments, each
with its own Durable Objects, Vectorize index, and Workflow. The top-level
Wrangler configuration is staging so a bare deployment cannot reach
production.

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
docs/            Product requirements, design records, and implementation plans
skills/          Repository-specific agent skills
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
