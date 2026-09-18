# Implementation plan — conversation capture

**Spec:** `docs/specs/conversation-capture.md`.
**Written:** 2026-09-18, against `main` at `335eab6`.
**Status:** COMPLETE 2026-09-18. All five steps landed on `main` (00bbab2, 86342f9, 4ffa6f9, 4303659, 38631cd).
Cursor's registration remains written-from-documentation and unexercised; Codex retention remains unconfirmed.
**Shape:** five steps, each one commit when the owner asks, with `pnpm check` green before the next begins.
Decisions this plan makes are marked **plan decision** and stand unless vetoed.
**No new dependencies.** Node 22 and POSIX sh only, as `clean-local` does.

## Starting state

`HEAD` is `335eab6` and **nothing from the 2026-09-18 export is committed.** The working tree holds it all as
untracked or unstaged work: `scripts/prompts.mjs`, `scripts/prompts-order.json`, `scripts/prompts-sessions.json`,
`docs/prompts/` (29 session files plus its README), a `pnpm prompts` entry in `package.json`, and edits to
`README.md` and `AGENTS.md`.

**Owner decision 2026-09-18, reversing this plan's first draft: none of it is committed.** The record in git is
produced by the skill. The export was a day's scaffolding — it proved the extraction, measured the corpus, and found
the Codex history — and it is thrown away rather than enshrined.

So the order inverts. The skill is built first, and the first commit of any captured history is the skill's own
backfill. The only thing rescued from the export is its **curation** — 29 hand-written titles and notes and the
start-here list — which migrates in Step 1.

**The 29 generated files are not deleted until Step 5 verifies their replacement.** They are the only rescued copy of
anything right now.

## Step 1 — the extractor moves into a skill

Create `skills/capture-conversation/` with `SKILL.md` and `scripts/capture.mjs`.

`capture.mjs` carries the parsing already proven in `scripts/prompts.mjs` — the `promptSource` filter, the fence
widening, local-time rendering, the author-date commit window — and adds:

- assistant `text` blocks, interleaved with prompts in timestamp order, `tool_use` and `tool_result` dropped;
- a `--session <id>` flag, defaulting to the newest transcript for the current repo;
- a `--backfill` flag that captures every transcript still on disk, both agents;
- `.agents/capture.json` resolution with the §4.2 defaults;
- index generation per §4.5, driven by `.agents/capture-sessions.json`;
- a `--retitle` flag, for one session or all.

**Titling is an agent step in `SKILL.md`, not code.** The script writes the capture, then reports that the session
has no cached title; the agent reads the capture it just wrote and fills `title` and `note` into
`.agents/capture-sessions.json`. **Plan decision: the script never invents a title itself** — a mechanical one built
from the first prompt would be worse than none and would poison the cache, since a cached title is not regenerated.

**Plan decision: a hand-edited entry is marked `"pinned": true` and `--retitle` skips it.** Without a marker the
distinction between "generated and kept" and "corrected by a human" is invisible, and a bulk retitle silently
discards the corrections.

**Seed the cache from the existing titles in this step.** `scripts/prompts-sessions.json` is already keyed by the
8-character session prefix, so it is a mechanical rewrite: carry `title` and `note` across, and drop `slug`,
`supersededBy` and the index numbering.
This is not because those titles required a human — they did not, and §4.5 says so — but because they exist and are
good enough. Verify 29 in, 29 out.

**Plan decision: each agent gets its own reader behind one `source` interface** — `sources/claude.mjs` and
`sources/codex.mjs`, each taking a root directory and returning `{ id, cwd, turns[] }` with turns already normalised
to `{ at, role, text }`. Everything downstream — screening, rendering, the reminder — sees only that shape and never
learns which agent produced it. A Cursor reader is then a third file.

**Plan decision: the Codex reader locates this repo's sessions by reading the `session_meta` first line of each
file and matching `cwd`**, not by a path convention. Codex files are named by timestamp and sharded by date
(`sessions/YYYY/MM/DD/rollout-*.jsonl`) with no repo in the path, so `cwd` is the only reliable link.

Revert the `pnpm prompts` entry in `package.json`. Leave `scripts/prompts*` and `docs/prompts/sessions/` on disk and
unstaged — they are deleted in Step 5, once the backfill has been checked against them. **Nothing under `scripts/`
is ever staged**; verify with `git status` before each commit that no `prompts*` path is listed.

Verification: capture this repo's newest Claude Code session and its largest Codex session
(`rollout-2026-09-11T12-42-35-*`, 48 user and 110 assistant messages); confirm each output holds both sides, contains
no tool traffic, and that the Codex one excludes the `<environment_context>` and `# AGENTS.md instructions` turns.

## Step 2 — the secret check

`skills/capture-conversation/scripts/screen.mjs`, called by `capture.mjs` before any write.

Layer 1 is the pattern list plus the `.dev.vars` value scan of §4.3. **Plan decision: the value scan ignores values
shorter than 8 characters and values that are pure digits**, or a `PORT=3000` turns every "3000" in the conversation
into a redaction. Verified against this repo's own `.dev.vars` before the step is called done.

Layer 2 is a step in `SKILL.md`, not code: the agent reads the redacted capture and reports anything else. The script
exits non-zero with a named finding if layer 1 fires, so the write cannot proceed by accident.

Verification: acceptance criteria 2 and 3, using a scratch conversation containing a known `.dev.vars` value and an
invented internal hostname.

## Step 3 — the reminder script

`skills/capture-conversation/scripts/uncaptured.mjs`, per §4.4: list, compare against the output directory, compute
days remaining, throttle once per day, emit in the `--agent` envelope, exit 0 always.

**Plan decision: the throttle timestamp lives in the agent's own cache directory, not the repo** — it is per-machine
state and committing it would make one developer's reminder suppress another's.

Verification: run it three times with a forced-stale transcript — reports once, silent twice. Confirm exit 0 when it
reports, when it is throttled, and when there is nothing to say.

## Step 4 — the three registrations

Ship the config fragments and an `install.sh` that merges them, following `scripts/skills.sh`:

| Agent | File | Event |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | `SessionStart` |
| Cursor | `.cursor/hooks.json` | `sessionStart` |
| Codex | `.codex/hooks.json` | `SessionStart` |

**Plan decision: the installer merges, never overwrites.** In this repo `.claude/` holds only `skills/` and
`worktrees/` — there is no project `settings.json`, so the installer creates one; the settings file carrying unrelated
configuration is the user-global `~/.claude/settings.json`, which this never touches. It reports what it changed and
is idempotent. Where a file exists and cannot be merged cleanly, it prints the fragment and asks rather than guessing.

**Verified on this machine 2026-09-18:** Codex is installed (`~/.codex/config.toml`, 144 session files). **Cursor is
not** — no `~/.cursor`, no `Cursor.app` — though `.cursor/rules/` is committed here. The Cursor registration is
therefore written from documentation and cannot be exercised until Cursor is installed; `SKILL.md` must say so rather
than implying it was tested.

Verification: start a fresh Claude Code session in this repo with a stale uncaptured transcript and see the reminder.

## Step 5 — backfill and the documents

**Verify before deleting.** Run `--backfill` for both agents — 29 Claude Code sessions and 29 Codex ones — into
`docs/prompts/conversations/`, then check the Claude Code captures against the 29 files still sitting in
`docs/prompts/sessions/`: every prompt present in the old file must be present in the new one. The new files hold
more (the replies); they must hold nothing less. Only once that passes do `scripts/prompts*` and
`docs/prompts/sessions/` get deleted from the working tree. Re-run the screen over all of
it: these transcripts contain pasted `wrangler` output, were never screened in the prompts-and-replies shape, and the
Codex half has never been screened at all.

**Plan decision: a capture's filename carries its agent** (`claude-<id>`, `codex-<id>`). Both agents use opaque ids
and both have exactly 29 sessions here; without the prefix the directory is unreadable and a future collision is
silent.

Then the documents. `docs/prompts/README.md` is no longer hand-written at all — it is generated by the skill from
the curation file, so the version now on disk is scaffolding too, including its "not the whole record" paragraph,
which by this step no longer holds;
`README.md` and `AGENTS.md` swap the `pnpm prompts` references for the skill; `AGENTS.md` gains the skill beside
`clean-local` in Commands.

Verification: acceptance criterion 6 — a freshly captured session self-titles, titles survive an index rebuild
unchanged, `--retitle` changes them, a `pinned` entry survives `--retitle`, and `git log --stat` shows nothing from
`scripts/prompts*`. Then `pnpm check`.

## Risks

**The live session captures itself mid-conversation.** A capture invoked now cannot contain the turns that come
after it, including the one that asked for it. Re-running overwrites with a longer version; the file is always a
prefix of the truth, never wrong. Worth one sentence in `SKILL.md` so it is not mistaken for data loss.

**The newest-transcript heuristic picks the wrong file** when two sessions run against one repo at once. The harness
value is preferred wherever available. **Plan decision: when two transcripts have been modified within 60 seconds of
each other, refuse and ask which**, rather than silently capturing the wrong conversation.

**The capture is large enough to matter eventually.** 1.6 MB for twelve days is nothing; the same rate over a year is
not. Nothing is built for that now. Worth revisiting if it becomes true.
