# CLAUDE.md

All project instructions live in `AGENTS.md` at the repo root. Read it in full before doing anything.

Do not add rules here; edit `AGENTS.md` so Codex and Cursor see the same guidance.

Claude Code specific notes:
- Use `pnpm`, never `npm`. Use `pnpm dlx` instead of `npx`.
- Run tasks from the repo root via Turborepo (`pnpm check`, `pnpm test`, …), not per-workspace.
- Before finishing any task: `pnpm check`.
- Anything touching Workers runtime behavior must be exercised under `wrangler dev`, not just Node.
