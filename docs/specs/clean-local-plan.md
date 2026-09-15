# Implementation plan — the `clean-local` skill

**Replaces:** the `clean-local-do` skill (`skills/clean-local-do/`).
**Written:** 2026-09-14, against `main` at `37cfba1`.
**Status:** IMPLEMENTED 2026-09-14 on `main`. No new dependencies. `pnpm check` green, 301 tests.
**Shape:** four steps, each one commit when the owner asks, with `pnpm check` green before the next begins.
Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Owner decisions this plan implements (2026-09-14)

1. Renamed to **`clean-local`** — it now clears more than Durable Objects, so `-do` would mislead.
2. It clears everything the **dev environment** owns: local Worker/Durable Object state, local Workflow state, and
   the dev Vectorize index.
3. **Dev only. Staging and production are never reachable** — no `--env`, no flag, no override.
4. Vector clearing stays **opt-in** via `--include-vectors`, as decided earlier today. (This message did not
   reverse that; say so if it should be on by default.)

## What the dev environment actually owns (verified 2026-09-14 against the account)

| Resource | Where it lives | State today | This skill |
| --- | --- | --- | --- |
| Durable Objects `RegistryDO`, `UserDO` | local `apps/api/.wrangler/state/v3/do/` | present | **clears** (today's behaviour) |
| Workflow `media-digest-ingest-dev` | local `…/state/v3/workflows/` | present | **clears** via `--include-workflows` |
| Vectorize `media-rag-dev` (`remote: true`) | Cloudflare | **372 vectors**, all namespace `shared-catalog` | **clears** via `--include-vectors` — new |
| Worker `media-digest-api-dev` | nowhere | `wrangler deployments list` → *"This Worker does not exist on your account"* | nothing to delete |
| Workers AI | Cloudflare | stateless — `lib/ai.ts` only calls `binding.run(MODEL, …)`; no AI Gateway, no AutoRAG, no agent-memory | nothing to clear |
| D1 / KV / R2 / Queues | — | not used by this project | n/a |

So "dev env Workers, DO, Vectorize, AI" resolves to exactly three things worth deleting, one of which
(`media-rag-dev`) is the only one that is remote. The dev Worker is not deployed — `pnpm dev` runs it in local
workerd — and Workers AI holds nothing.

**Naming note:** `media-rag-dev` lives on Cloudflare, so "local" describes the *environment*, not the storage. The
SKILL.md description must say "the local dev environment, including its one remote index" or the name quietly
undersells the blast radius.

## Design

### Scope, and how it is enforced

There is no `--env` flag. The script hard-codes the dev triple and refuses everything else:

- Vectorize index: the literal `media-rag-dev`. Any other name — including `media-rag-staging` and `media-rag` —
  exits 2. **Plan decision:** the name is a constant in the script, not an argument, so there is no input that can
  redirect the wipe at another index.
- Local paths: only direct children of `apps/api/.wrangler/state/v3/do`, plus `…/state/v3/workflows`. Today's path
  guard is kept verbatim.
- **Plan decision:** if a user argument mentions `staging` or `production` anywhere, the script exits 2 with
  `staging and production are not supported by this skill` rather than ignoring it. A refusal is better than
  silently cleaning dev when the owner meant something else.

Everything that made the old skill safe is kept unchanged: repo-root detection, the running-`workerd`/`wrangler`
refusal, dry-run first, one confirmation, and the rule that only the bundled script ever deletes.

The running-wrangler refusal now carries a second reason worth stating in the script comment: a live dev Worker
holds the remote `VECTORS` binding and could re-upsert mid-wipe, so the enumerate-then-delete pass below would race
it.

### Clearing the index without deleting it

`wrangler vectorize list-vectors --json` returns `{count, totalCount, isTruncated, nextCursor,
cursorExpirationTimestamp, vectors:[{id}]}` — **ids only, no namespace** — and `delete-vectors --ids` takes no
namespace either. So: enumerate → delete by id → verify.

1. `vectorize info media-rag-dev` for the preview count (`vectorCount`, which lags `processedUpToMutation`).
2. `list-vectors media-rag-dev --count 1000 --json`, following `nextCursor` until `isTruncated` is false. Collect
   every id before deleting anything; if the cursor expires mid-walk (`cursorExpirationTimestamp`), restart it.
3. `delete-vectors media-rag-dev --ids …` in batches of **100** — the API's hard cap, probed 2026-09-14: 100 is
   accepted, 101 answers `too many ids in payload; max id count is 100 [code: 40007]`. Every wrangler call is
   retried (the Vectorize API returns an intermittent 504 that succeeds on a repeat); a batch that fails all
   attempts stops the run and reports how many vectors were deleted.
4. Poll `vectorize info` until `vectorCount` is 0 or ~120 s elapse — Vectorize mutations are async and this repo has
   measured 10–80 s. **Plan decision:** a non-zero tail after the timeout is a warning with the re-run command
   printed, not a failure. The script never claims an empty index it has not observed.

Two properties this buys, both worth keeping deliberately:

- **`wrangler vectorize delete` is never called.** AGENTS.md hard rule 4 already forbids it and that ban survives
  this change untouched — the skill needs no carve-out for it.
- **The `channelId` and `episodeId` metadata indexes survive.** AGENTS.md requires them to exist *before the first
  upsert*; a delete-and-recreate would drop them silently and every later vector would be unfilterable, with no
  error to notice. The script prints `list-metadata-index` afterwards as proof.

**Hard rule 3:** an index-wide wipe is namespace-scoped in substance, because `lib/vectorize.ts` exports
`SHARED_NAMESPACE = "shared-catalog"` as the only namespace ever written. Step 3 adds a test that fails if a second
namespace is ever introduced, so this stays true by construction rather than by memory.

### Preflight

New: an auth check, so the script refuses with a clear message instead of launching a browser OAuth flow inside a
tool call. **Unverified assumption, to settle in Step 2:** that `wrangler whoami` reports "not authenticated"
rather than initiating a login. If it initiates one, guard on `CLOUDFLARE_API_TOKEN` / `wrangler auth status`
instead.

**Plan decision:** wrangler resolves to `apps/api/node_modules/.bin/wrangler`, falling back to
`pnpm --filter @media-digest/api exec wrangler`. Never a global `wrangler`.

## Steps

### Step 1 — Rename, no behaviour change  (size: S)

- 1.1 `git mv skills/clean-local-do skills/clean-local`; `git mv skills/clean-local/scripts/clean-local-do.sh
  skills/clean-local/scripts/clean-local.sh`.
- 1.2 Update every self-reference in `SKILL.md` and the script header. `name: clean-local`, `allowed-tools:
  Bash(sh skills/clean-local/scripts/clean-local.sh:*)`. Flags and behaviour untouched in this step.
- 1.3 `AGENTS.md` line ~239 (Commands → Skills) and line ~274 (Data & schema conventions) renamed.
- 1.4 Remove the stale `.claude/skills/clean-local-do` and `.agents/skills/clean-local-do` installs, re-run
  `pnpm skills:install --agent claude-code` and `--agent codex cursor`. Both trees are gitignored.
- 1.5 Historical `docs/specs/*.md` keep their `/clean-local-do` references — they are records of what happened, not
  live instructions. Verified: no outstanding instruction depends on the old name.

**Done when:** `sh skills/clean-local/scripts/clean-local.sh --dry-run` behaves exactly as before; `pnpm check` green.

### Step 2 — `--include-vectors`  (size: M)

**Files:** `skills/clean-local/scripts/clean-vectors.mjs` (new), `skills/clean-local/scripts/clean-local.sh`.

- 2.1 `clean-vectors.mjs`: Node 22 ESM, no dependencies — `node:child_process` and `JSON.parse`. Node is already
  pinned in `engines`, so this adds nothing to install and avoids requiring `jq`. Enumerate / batch-delete /
  poll-verify exactly as designed above; `--dry-run` enumerates and reports, deleting nothing.
- 2.2 The index name is a constant in the script. No argument reaches it.
- 2.3 `clean-local.sh` parses `--include-vectors`, adds the staging/production refusal, the auth preflight, and the
  wrangler-binary resolution. Settle the `whoami` assumption here.
- 2.4 The unified preview lists local directories and the remote vector count together, so one dry run shows the
  whole blast radius before the single confirmation.
- 2.5 Print `list-metadata-index` after a real wipe.

**Done when:** a dry run reports 372 vectors and deletes nothing; a real run empties `media-rag-dev` and
`vectorize info` reads 0; `pnpm check` green.

### Step 3 — Guards against drift  (size: S)

**Files:** `apps/api/test/wrangler-config.test.ts`, `apps/api/test/vectorize.test.ts`.

- 3.1 Read `skills/clean-local/scripts/clean-vectors.mjs` with vite's `?raw` (as the test already does for
  `wrangler.jsonc`) and assert its index constant equals `env.dev`'s `index_name`, and that neither the staging nor
  the production index name appears anywhere in the skill. A renamed or mis-typed index then fails `pnpm check`
  instead of silently wiping nothing — or something else. **Verify in this step** that vite's `server.fs.allow`
  reaches outside `apps/api` in this monorepo; if not, read the file with `node:fs` from a plain (non-pool) test.
- 3.2 Assert `shared-catalog` is still the only namespace `lib/vectorize.ts` accepts, with a comment naming this
  skill as the reason.

**Done when:** both tests fail when deliberately broken; `pnpm check` green.

### Step 4 — Docs  (size: S)

**Files:** `skills/clean-local/SKILL.md`, `AGENTS.md`.

- 4.1 `SKILL.md` rewritten: the dev-only scope stated in the description, the three targets, the argument list, and
  a short **"What this does not touch"** section — staging, production, deployed Durable Objects, the Vectorize
  index itself and its metadata indexes, `.dev.vars`, and test storage.
- 4.2 `AGENTS.md` hard rule 4 amended. Proposed wording, for the owner to approve verbatim:

  > **Never run destructive commands**: no `DELETE FROM` without a `WHERE` on user data, no `wrangler delete`,
  > `wrangler d1/vectorize delete`, `wrangler workflows delete`, no resetting Durable Object storage, no `rm -rf`
  > outside build output. The single sanctioned exception is the `clean-local` skill, only when the owner asks in
  > so many words, and only by the routes it uses: the dev environment's local Durable Object and Workflow
  > directories, and the vectors in `media-rag-dev` deleted by enumerated id — never the index, never staging,
  > never production. If a task seems to require anything else, stop and ask. `DROP` inside a migration file is
  > DDL, not a command, and is allowed (owner decision 2026-09-12, `docs/PRD.md` §5.4).

- 4.3 `AGENTS.md` → Environments gains one line: this skill is dev-only, and deployed environments are reset by
  hand (appendix below).
- 4.4 Re-run `pnpm skills:install` for both agent sets.

**Done when:** `pnpm check` green and the SKILL.md dry run reads correctly.

## Not in scope

- Staging and production, in any form.
- Deleting or recreating a Vectorize index, or its metadata indexes.
- `wrangler delete`, `wrangler workflows delete`, any D1/KV/R2 command.
- Clearing deployed Durable Object rows — see the appendix; it is a documented manual procedure, never a skill.

## Appendix — resetting a deployed environment, by hand (answers the owner's question of 2026-09-14)

Kept here because it is the thing this skill deliberately does **not** do, and the SKILL.md points at it.

**Does `wrangler delete` take the Durable Objects with it?** Reading the implementation in wrangler 4.129.0: it
confirms `Are you sure you want to delete <name>? This action cannot be undone.`, then calls
`DELETE /accounts/<id>/workers/services/<name>`. **There is no Durable Object warning of any kind** — the only
extra step, `deleteSiteNamespaceIfExisting`, concerns the legacy Workers Sites KV namespace, not DOs.

Cloudflare documents only the *class*-level delete: `deleted_classes` — "Running a Delete migration will delete all
Durable Objects associated with the deleted class, including all of their stored data"; and the newer `exports`
`deleted` tombstone — "Deleting a class destroys its data … There is no Trash." Whether deleting the *whole Worker*
cascades to its namespaces is **not stated on any Cloudflare page checked** (migrations, legacy migrations, data
location, the Delete Worker API reference). It almost certainly does, since namespaces belong to the Worker service
— but that is inference, not documentation, and the silent CLI would not tell you either way. Settle it by
experiment when staging first deploys, before it holds anything worth keeping: deploy, write a row, delete,
redeploy, read.

**To start staging with a clean database,** the sound route is a `deleted_classes` + re-add migration pair:

```jsonc
{ "tag": "v3", "deleted_classes": ["RegistryDO", "UserDO"] },
{ "tag": "v4", "new_sqlite_classes": ["RegistryDO", "UserDO"] }
```

**The footgun, and it is a bad one:** `migrations` is one of the three keys wrangler **inherits into every
environment** (AGENTS.md → Environments). A wipe pair committed to `wrangler.jsonc` sits there and detonates on the
next `deploy:production` as well. So the pair is never committed: add it, `pnpm --filter api deploy`, revert it.
Worth making enforceable if staging resets become routine — a `wrangler-config.test.ts` case that fails on any
committed `deleted_classes` tag would stop one reaching `main`.

The alternatives lose. `wrangler delete` + redeploy destroys the staging secrets (`OWNER_EMAIL`, `DOWNSUB_API_KEY`
must be re-put each time) and rests on the unverified cascade above. An app-level reset route is blocked outright:
the API enforces no authorization at all (owner decision 2026-09-12), so `POST /admin/reset` on a deployed Worker
would be an unauthenticated public wipe endpoint.
