---
name: clean-local-do
description: Wipe the local `wrangler dev` Durable Object storage for apps/api (apps/api/.wrangler/state/v3/do) so the next `pnpm dev` starts from empty DOs, re-runs migrations, and re-seeds the owner from .dev.vars. Local dev state only — never deployed Cloudflare resources, test storage, or .dev.vars. Use after schema or seed changes, or when local catalog/user data is stale.
argument-hint: "[ClassName] [--include-workflows] [--yes]"
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/clean-local-do.sh *)
---

# Clean local Durable Objects

Deletes the SQLite files that `wrangler dev` persisted for this repo's Durable Objects under
`apps/api/.wrangler/state/v3/do/`. Nothing else. Deployed Workers and DOs, Vectorize, `apps/api/.dev.vars`,
the other local stores (`kv`, `cache`, `d1`, `r2`, `observability`), `.wrangler/tmp`, and test storage
(in-memory, see `apps/api/test/setup.ts`) are untouched.

AGENTS.md hard rule 4 forbids resetting Durable Object storage. This skill is the single sanctioned exception,
and only because the owner invoked it explicitly: the model cannot start it (`disable-model-invocation`), and every
deletion goes through `scripts/clean-local-do.sh`, which refuses any path that is not a direct child of
`state/v3/do` (or `state/v3/workflows` when asked), refuses to run while this repo's `wrangler dev` / workerd is
alive, and refuses to run from anywhere but this repo.

## Preview

Arguments passed: `$ARGUMENTS`

Dry run taken when the skill was invoked (nothing has been deleted yet):

!`${CLAUDE_SKILL_DIR}/scripts/clean-local-do.sh --dry-run $ARGUMENTS || true`

## Steps

1. Read the preview above and act on its first line.
   - `refusing: wrangler dev / workerd from this repo is running` — tell the user to stop `pnpm dev` (Ctrl-C in
     that terminal) and run `/clean-local-do` again. Do not kill processes on their behalf. Stop here.
   - `Nothing to delete` — report that and stop.
   - `unknown flag`, `only one ClassName`, or usage text — relay the usage and stop.
   - `Dry run. Would delete (N)` — continue.
2. Unless the arguments include `--yes`, confirm once with AskUserQuestion. Quote the exact directories from the
   preview and offer two options: delete, or cancel. On cancel, stop.
3. Run the deletion, passing the user's arguments through unchanged (class name, `--include-workflows`;
   a repeated `--yes` is harmless):

   ```
   ${CLAUDE_SKILL_DIR}/scripts/clean-local-do.sh --yes $ARGUMENTS
   ```

4. Report what the script printed. Remind the user that the next `pnpm dev` runs migrations from scratch and
   re-seeds the owner from `apps/api/.dev.vars`, that every local user, catalog channel, request, episode, and
   summary is gone, and that deployed data is unaffected.

## Rules

- The script is the only thing that deletes. Never hand-write `rm`, `find -delete`, or `sqlite3` against `.wrangler/`.
- If the script exits non-zero, report its message and stop. Never work around a refusal — not by killing workerd,
  not by editing the script's path or process checks, not by deleting files directly.
- Do not widen scope. No other `state/v3` directories, no `.wrangler/tmp`, no `wrangler delete`,
  no `wrangler d1|vectorize delete`, nothing remote. If asked, say it is outside this skill and leave the decision
  to the owner.
- Arguments: `ClassName` limits deletion to one DO class (for example `RegistryDO`); `--include-workflows` also removes
  local Workflow instance state, which references DO rows and turns stale once they are gone; `--yes` skips the
  confirmation in step 2.

## Manual equivalent

For Codex, Cursor, or a plain terminal:

```
sh .claude/skills/clean-local-do/scripts/clean-local-do.sh          # preview
sh .claude/skills/clean-local-do/scripts/clean-local-do.sh --yes    # delete
```
