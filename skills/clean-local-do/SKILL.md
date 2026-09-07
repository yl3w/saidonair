---
name: clean-local-do
description: Wipe the local `wrangler dev` Durable Object storage for apps/api (apps/api/.wrangler/state/v3/do) so the next `pnpm dev` starts from empty Durable Objects, re-runs migrations, and re-seeds the owner from .dev.vars. Local dev state only, never deployed Cloudflare resources, test storage, or .dev.vars. Run it only when the user explicitly asks to wipe, reset, or clean local Durable Object state, never on your own initiative.
compatibility: Only inside the media-digest-assistant repo, run from the repo root. Needs POSIX sh, pgrep, find, and du. Refuses to run while this repo's wrangler dev is up.
allowed-tools: Bash(sh skills/clean-local-do/scripts/clean-local-do.sh:*)
---

# Clean local Durable Objects

Deletes the SQLite files that `wrangler dev` persisted for this repo's Durable Objects under
`apps/api/.wrangler/state/v3/do/`. Nothing else. Deployed Workers and DOs, Vectorize, `apps/api/.dev.vars`,
the other local stores (`kv`, `cache`, `d1`, `r2`, `observability`), `.wrangler/tmp`, and test storage
(in-memory, see `apps/api/test/setup.ts`) are untouched.

AGENTS.md hard rule 4 forbids resetting Durable Object storage. This skill is the single sanctioned exception,
and only when the user asked for it in so many words. Never start it on your own initiative, and never treat a
vague request ("tests are weird", "data looks stale") as authorization. Every deletion goes through the bundled
script `scripts/clean-local-do.sh`, which refuses any path that is not a direct child of `state/v3/do`
(or `state/v3/workflows` when asked), refuses to run while this repo's `wrangler dev` / workerd is alive,
and refuses to run outside this repo.

## Script location

The canonical copy is `skills/clean-local-do/scripts/clean-local-do.sh` in the repo. Agent directories such as
`.claude/skills/` and `.agents/skills/` hold copies made by `pnpm skills:install`; always run the canonical path
from the repo root so every agent executes the same file.

## Steps

1. Preview. From the repo root run a dry run, passing along any arguments the user gave (class name,
   `--include-workflows`, `--yes`); `--dry-run` wins over `--yes`, so nothing is deleted yet:

   ```
   sh skills/clean-local-do/scripts/clean-local-do.sh --dry-run <user arguments>
   ```

   Show the user the output.
2. Act on the first line of that output.
   - `refusing: wrangler dev / workerd from this repo is running`: tell the user to stop `pnpm dev` (Ctrl-C in
     that terminal) and ask again. Do not kill processes on their behalf. Stop here.
   - `Nothing to delete`: report that and stop.
   - `refusing: not inside the media-digest-assistant repo`: you are in the wrong directory; change to the repo
     root and retry once, then stop.
   - `unknown flag`, `only one ClassName`, or usage text: relay the usage and stop.
   - `Dry run. Would delete (N)`: continue.
3. Unless the user's arguments include `--yes`, ask one yes/no confirmation question. Quote the exact directories
   from the preview and offer two choices: delete, or cancel. On cancel, stop.
4. Delete, passing the user's arguments through unchanged (a repeated `--yes` is harmless):

   ```
   sh skills/clean-local-do/scripts/clean-local-do.sh --yes <user arguments>
   ```

5. Report what the script printed. Remind the user that the next `pnpm dev` runs migrations from scratch and
   re-seeds the owner from `apps/api/.dev.vars`, that every local user, catalog channel, request, episode, and
   summary is gone, and that deployed data is unaffected.

## Rules

- The script is the only thing that deletes. Never hand-write `rm`, `find -delete`, or `sqlite3` against `.wrangler/`.
- If the script exits non-zero, report its message and stop. Never work around a refusal, not by killing workerd,
  not by editing the script's path or process checks, not by deleting files directly.
- Do not widen scope. No other `state/v3` directories, no `.wrangler/tmp`, no `wrangler delete`,
  no `wrangler d1|vectorize delete`, nothing remote. If asked, say it is outside this skill and leave the decision
  to the owner.

## Arguments

- `ClassName` limits deletion to one Durable Object class, for example `RegistryDO` or `UserDO`.
- `--include-workflows` also removes local Workflow instance state, which references DO rows and turns stale
  once they are gone.
- `--yes` skips the confirmation in step 3.

## Manual use

From a plain terminal at the repo root:

```
sh skills/clean-local-do/scripts/clean-local-do.sh          # preview
sh skills/clean-local-do/scripts/clean-local-do.sh --yes    # delete
```
