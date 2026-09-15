---
name: clean-local
description: Wipe the state the dev environment owns - the local `wrangler dev` Durable Object storage for apps/api, optionally the local Workflow state, and optionally every vector in the dev Vectorize index on Cloudflare - so the next `pnpm dev` starts empty, re-runs migrations, and re-seeds the owner from .dev.vars. Dev only; staging and production are refused. Not for tidying code, files, or build output. Run it only when the user explicitly asks to wipe, reset, or clean dev state, never on your own initiative.
compatibility: Only inside the media-digest-assistant repo, run from the repo root. Needs POSIX sh, pgrep, find, du, and Node 22. `--include-vectors` also needs a logged-in wrangler and reaches the network. Refuses to run while this repo's wrangler dev is up.
allowed-tools: Bash(sh skills/clean-local/scripts/clean-local.sh:*)
---

# Clean dev state

Clears what the **dev** environment owns, and nothing else:

| What | Where | Flag |
| --- | --- | --- |
| Durable Objects `RegistryDO`, `UserDO` | local `apps/api/.wrangler/state/v3/do/` | default |
| Workflow instances | local `apps/api/.wrangler/state/v3/workflows/` | `--include-workflows` |
| Every vector in the dev Vectorize index | Cloudflare (`remote: true` even in local dev) | `--include-vectors` |

The dev Worker is not deployed — `pnpm dev` runs it in local workerd — and Workers AI is stateless, so neither
has anything to delete.

"Local" names the **environment**, not the storage: the dev Vectorize index lives on Cloudflare, so
`--include-vectors` makes real network calls, in the dry run as well.

AGENTS.md hard rule 4 forbids destructive commands. This skill is the single sanctioned exception, and only when
the user asked for it in so many words. Never start it on your own initiative, and never treat a vague request
("tests are weird", "data looks stale", "clean this up") as authorization. Every deletion goes through the bundled
scripts, which refuse any path that is not a direct child of `state/v3/do` (or `state/v3/workflows` when asked),
refuse to run while this repo's `wrangler dev` / workerd is alive, and refuse to run outside this repo.

## What this does not touch

- **Staging and production, in any form.** There is no `--env` flag, the index name is a constant in
  `clean-vectors.mjs` rather than an argument, and an argument naming a deployed tier is refused outright.
  `apps/api/test/wrangler-config.test.ts` fails if a deployed index name ever appears in the script.
- **The Vectorize index itself, and its `channelId` / `episodeId` metadata indexes.** Vectors are deleted by
  enumerated id; `wrangler vectorize delete` is never called. Deleting the index would drop the metadata indexes
  with it, and AGENTS.md requires those to exist *before* the first upsert — vectors written afterwards would be
  silently unfilterable.
- Deployed Workers and Durable Objects, `apps/api/.dev.vars`, the other local stores (`kv`, `cache`, `d1`, `r2`,
  `observability`), `.wrangler/tmp`, and test storage (in-memory, see `apps/api/test/setup.ts`).

Starting a **deployed** environment clean is a manual procedure, not this skill: see
`docs/specs/clean-local-plan.md` → Appendix.

## Script location

The canonical copy is `skills/clean-local/scripts/clean-local.sh` in the repo, with `clean-vectors.mjs` beside it.
Agent directories such as `.claude/skills/` and `.agents/skills/` hold copies made by `pnpm skills:install`; always
run the canonical path from the repo root so every agent executes the same file.

## Steps

1. Preview. From the repo root run a dry run, passing along any arguments the user gave (class name,
   `--include-workflows`, `--include-vectors`, `--yes`); `--dry-run` wins over `--yes`, so nothing is deleted yet:

   ```
   sh skills/clean-local/scripts/clean-local.sh --dry-run <user arguments>
   ```

   Show the user the output.
2. Act on the first line of that output.
   - `refusing: wrangler dev / workerd from this repo is running`: tell the user to stop `pnpm dev` (Ctrl-C in
     that terminal) and ask again. Do not kill processes on their behalf. Stop here.
   - `refusing: staging and production are not supported`: relay it. Do not look for another route. Stop here.
   - `refusing: wrangler is not authenticated`: tell the user to run `wrangler login` themselves, then ask again.
     Stop here.
   - `Nothing to delete`: report that and stop.
   - `refusing: not inside the media-digest-assistant repo`: you are in the wrong directory; change to the repo
     root and retry once, then stop.
   - `unknown flag`, `only one ClassName`, or usage text: relay the usage and stop.
   - `Dry run. Would delete (N)`: continue.
3. Unless the user's arguments include `--yes`, ask one yes/no confirmation question. Quote the exact directories
   and the vector count from the preview and offer two choices: delete, or cancel. On cancel, stop.
4. Delete, passing the user's arguments through unchanged (a repeated `--yes` is harmless):

   ```
   sh skills/clean-local/scripts/clean-local.sh --yes <user arguments>
   ```

5. Report what the scripts printed. Remind the user that the next `pnpm dev` runs migrations from scratch and
   re-seeds the owner from `apps/api/.dev.vars`, that every local user, catalog channel, request, episode, and
   summary is gone, and that deployed data is unaffected. With `--include-vectors`, say whether the index
   confirmed empty: Vectorize applies deletes asynchronously, so a lingering count is usually lag, and the script
   prints the command to check again.

## Rules

- The scripts are the only thing that deletes. Never hand-write `rm`, `find -delete`, `sqlite3` against
  `.wrangler/`, or any `wrangler vectorize` command.
- If a script exits non-zero, report its message and stop. Never work around a refusal, not by killing workerd,
  not by editing the script's constants, paths, or process checks, not by deleting files directly, and not by
  calling wrangler yourself.
- Do not widen scope. No other `state/v3` directories, no `.wrangler/tmp`, no `wrangler delete`,
  no `wrangler d1|vectorize|workflows delete`, nothing on staging or production. If asked, say it is outside this
  skill and leave the decision to the owner.

## Arguments

- `ClassName` limits the local deletion to one Durable Object class, for example `RegistryDO` or `UserDO`. It does
  not scope the vector wipe, which is whole-index.
- `--include-workflows` also removes local Workflow instance state, which references DO rows and turns stale once
  they are gone.
- `--include-vectors` also deletes every vector in the dev Vectorize index. Needs `wrangler login`; reaches the
  network in the dry run too.
- `--yes` skips the confirmation in step 3.

## Manual use

From a plain terminal at the repo root:

```
sh skills/clean-local/scripts/clean-local.sh                            # preview
sh skills/clean-local/scripts/clean-local.sh --yes                      # delete local DO state
sh skills/clean-local/scripts/clean-local.sh --include-vectors          # preview, including the index
sh skills/clean-local/scripts/clean-local.sh --include-vectors --yes    # delete both
```
