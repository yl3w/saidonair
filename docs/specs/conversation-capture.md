# Feature spec — conversation capture

**Written:** 2026-09-18, against `main` at `335eab6`.
**Status:** IMPLEMENTED 2026-09-18 on `main` in five commits (6b91fdb…38631cd). 49 conversations captured, both agents.
**Supersedes:** `scripts/prompts.mjs` and the `pnpm prompts` command, both added 2026-09-18 and not yet committed.
**Does not touch the PRD.** This is repository tooling, like `clean-local`. It captures how the product was built; it
changes nothing the product does, no route, no schema, and nothing a reader sees. `README.md` and `AGENTS.md` change.

## 1. Summary

A portable skill that writes the conversation you are in to a file in the current repository, on demand, after
checking it for secrets. Plus a hook — registered identically for Claude Code, Cursor, and Codex — that tells you when
a conversation is about to expire from the agent's local cache without ever having been captured.

The problem it solves is concrete and dated. Said on Air was built over twelve days in 58 agent sessions — 29 in
Claude Code and 29 in Codex (§3.3). Those transcripts exist only in each agent's local cache, 141 MB for Claude Code
alone, and Claude Code prunes its own on a retention window that defaults to 30 days. Nothing in the repository
records the conversation that produced it. The export written on 2026-09-18 (`docs/prompts/sessions/`) rescued one
side of one agent's half — the Claude Code prompts — as a one-off. This makes it a habit instead, covers both sides,
and covers both agents.

## 2. Owner decisions this spec implements (2026-09-18)

1. **A capture holds prompts and replies**, with tool calls and their results stripped.
2. **The hook is universal** — one implementation, usable from Cursor, Claude Code, or Codex.
3. **The skill is portable** with per-repo configuration, not specific to this repository.
4. **Secrets are checked by patterns first, then by the agent reading what survived.**
5. **The skill supersedes `scripts/prompts.mjs` entirely.** Revised 2026-09-18: that export is *not* committed —
   whatever lands in git is produced by the skill. Its hand-written curation is carried over, its code is not.
6. **Claude Code and Codex transcripts are parsed now**; Cursor is left behind a seam, not claimed. (Revised the
   same day, once 29 Codex sessions rooted in this repo were found — see §3.3.)

## 3. Evidence

### 3.1 Why replies are included, and tool calls are not

Measured across all 34 transcripts in `~/.claude/projects/-Users-bhaskar-workspace-media-digest-assistant/`:

| Component | Characters | Share |
| --- | --- | --- |
| Owner prompts | 108,689 | 1% |
| Agent replies (prose) | 1,582,804 | 15% |
| Tool-call inputs | 8,821,112 | 84% |
| Raw on disk | 141 MB | — |

Prompts alone are one-sided: they record what was asked and lose what it was answering. Prompts and replies together
are ~1.6 MB for the entire project, which is a rounding error in a git repository. Tool calls are 84% of the bulk,
are unreadable in prose form, and are also where the genuinely dangerous content lives — file reads of `.dev.vars`,
command output carrying keys. Excluding them is both the cheap choice and the safe one.

### 3.2 The three agents all support what this needs

Verified against each vendor's current hook documentation on 2026-09-18:

| Agent | Project-local config, committable | Session-start event | User-visible output |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `SessionStart` | hook stdout |
| Cursor | `.cursor/hooks.json` | `sessionStart` | `user_message` |
| Codex | `.codex/hooks.json` or `.codex/config.toml` | `SessionStart` | `systemMessage` |

All three pass JSON on stdin carrying a session id; Claude Code and Codex also pass the transcript path. The events
differ only in name and output envelope, so **one script serves all three** and an `--agent` flag selects the
envelope. This is the pattern `scripts/skills.sh` already uses for skill installation: one source, several thin
registrations.

### 3.3 Half this project's history is in Codex

Found on 2026-09-18, after the first draft of this spec scoped Codex out. Measured on this machine:

| | Sessions rooted in this repo | Span | Shape |
| --- | --- | --- | --- |
| Claude Code | 29 | 09-07 → 09-18 | `~/.claude/projects/<mangled cwd>/<id>.jsonl` |
| Codex | 29 | 09-07 → 09-15 | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Cursor | none — not installed | — | no `~/.cursor`, no `Cursor.app` |

Thirteen of the Codex sessions carry more than two messages; the largest holds 48 user and 110 assistant messages
and covers the same M3 ingestion review that Claude Code session 08 covers. So the two are not duplicates of each
other and neither is the record on its own.

Codex's format is a near-sibling: a `session_meta` first line carrying `cwd` and `session_id`, then `response_item`
lines. Messages are `response_item` / `message` with a `role`; `reasoning`, `custom_tool_call`, and
`custom_tool_call_output` are the tool traffic to drop, matching what §3.1 drops for Claude Code.

**One real difference.** Codex has no `promptSource` marker, so a genuinely typed turn cannot be distinguished from a
harness-injected one by a flag. Injected turns arrive in the user role with recognisable openings
(`<environment_context>`, `<user_instructions>`, `# AGENTS.md instructions`) and must be excluded by prefix. That is
weaker than Claude Code's marker and will need revisiting when Codex changes what it injects.

**Codex retention is not established.** Sessions from 09-07 are still present eleven days on, and
`~/.codex/archived_sessions/` is empty, but neither fact implies a limit or the absence of one. The `retentionDays`
default of 30 is Claude Code's `cleanupPeriodDays` and is applied to Codex only as a guess. §4.4's reminder is
therefore sound for Claude Code and approximate for Codex, and should say so when it reports.

## 4. Contract

### 4.1 The skill

`skills/capture-conversation/`, following the Agent Skills standard as `clean-local` does. Invoked when the user asks
to capture, save, or archive the current conversation — never on the agent's own initiative.

It resolves the live transcript, extracts the conversation, screens it, and writes one file. In order:

1. **Locate.** Claude Code stores this repo's transcripts in `~/.claude/projects/<cwd with / replaced by ->/`. The
   live session is the most recently modified `.jsonl` in that directory. When the harness supplies a session id or
   transcript path, that wins over the heuristic.
2. **Extract.** For Claude Code, human turns are those the transcript marks `promptSource` of `typed`, `queued`, or
   `suggestion_accepted` — this excludes tool results, injected skill text, task notifications, and compaction
   summaries, all of which arrive in the user role. Agent turns are `text` blocks from assistant messages;
   `tool_use` and `tool_result` blocks are dropped. For Codex, human and agent turns are `response_item` / `message`
   entries with role `user` and `assistant`; role `developer`, `reasoning`, and `custom_tool_call*` are dropped, and
   injected user turns are excluded by the prefixes named in §3.3.
3. **Screen** (§4.3).
4. **Write** one markdown file to the configured output directory.
5. **Title it and index it** (§4.5): write a title and one-line note for the session just captured, cache them, and
   regenerate the index so the capture is reachable without anyone editing a list.

### 4.2 Configuration

`.agents/capture.json` at the repo root, committed, all keys optional:

```json
{
  "out": "docs/prompts/conversations",
  "retentionDays": 30,
  "remindWithinDays": 7
}
```

Absent, the defaults above apply, so the skill works in a repo that has never been configured. `.agents/` is already
present here and is the cross-agent convention; only `.agents/skills/` is git-ignored.

Alongside it, `.agents/capture-sessions.json` holds the per-session title and note the index is built from (§4.5),
keyed by session id. They are separate files because settings are written once and the titles grow with every session
captured.

### 4.3 The secret check

Two layers, in this order, both before anything is written. **Nothing is ever written and then reviewed.**

**Layer 1 — patterns.** Bearer tokens, `CLOUDFLARE_API_TOKEN`, `DOWNSUB_API_KEY`, private key blocks, AWS and Google
key shapes, and email addresses. Plus one technique worth more than all of them: **find every `.dev.vars`,
`.dev.vars.*`, and `.env*` file in the workspace and redact any literal value found in them.** In this repo the file
is `apps/api/.dev.vars`, not the root — so the scan walks the workspace rather than checking one path. The real secrets on a
developer's machine are already enumerated in those files; matching against the actual values catches a pasted key
that no generic pattern would recognise.

**Layer 2 — the agent reads it.** The agent reads the redacted capture and flags anything the patterns missed:
internal hostnames, customer names, credentials in an unfamiliar shape, anything personal. On the 2026-09-18 export
this layer is what earned its place — a Cloudflare account id, pasted in from a `wrangler` error, matched no pattern
and was caught only by reading.

A finding stops the write and is reported. The user decides: redact it, or accept it and re-run.

### 4.4 The reminder hook

`skills/capture-conversation/scripts/uncaptured.mjs --agent <claude|cursor|codex>`, registered on each agent's
session-start event using the paths in §3.2.

It lists the transcripts for the current repo, treats a session as **captured when a file bearing its id exists in the
configured output directory**, computes days remaining as `retentionDays` minus the transcript's age, and reports any
uncaptured session inside `remindWithinDays` of expiry. It emits the message in the agent's envelope and exits 0.

**It never blocks, never writes, and never captures anything by itself.** It reports and gets out of the way.

**Throttled to once per calendar day** per repository, via a timestamp file. `sessionStart` fires on every new
conversation; without a throttle this becomes noise that gets ignored, which is the same as not having it.

### 4.5 The index, and what happens to the 2026-09-18 export

**The index.** Captures are named by opaque session ids, so a directory of them is unreadable on its own. The skill
generates `<out>/README.md`: a table of every capture in date order — date, title, note, link — built from
`.agents/capture-sessions.json`, which holds a title and a one-line note per session id.

**Titles and notes are generated, not hand-written.** Checked against the 2026-09-18 export before this was
specified: of the three claims in that export's note for session `e79bc0f7`, two are near-verbatim in its prompts and
the third is in `AGENTS.md` — nothing in it required a human. The agent writes the title and note when it captures
the session, reading the conversation it just captured plus the repo around it. Captures now carry replies as well as
prompts, so there is more to work from, not less.

**The file exists to stop them churning, not to make you write them.** Generation is non-deterministic: rebuild the
index from scratch and every title shifts, so a diff becomes unreadable and any link to a session goes stale. The
file caches the first generation and the index reuses it. `--retitle` regenerates deliberately, for one session or
all of them. A hand-edit always wins and is never overwritten — overriding is available, never required.

**There is no ranking, and no start-here list.** An earlier draft of this spec carried one over from the 2026-09-18
export, where six sessions were singled out so an outsider could find a way into 569 prompts quickly. That is a
problem of handing the record to a stranger, solved once for one audience; nothing in capturing, screening, or being
reminded about a conversation requires deciding which sessions are worth more than others. The index is every
capture in date order. If a curated way in is ever wanted for a particular reader, that is a one-off piece of writing
for that reader, not a field this skill maintains.

**What a note written at capture time cannot know is what happened afterwards** — a decision reversed three sessions
later reads as settled in the note written that day. That is an argument for running `--retitle` occasionally, not
for writing them by hand.

A session with no entry still appears in the table under its date and id. The index never omits a capture because
nothing has been written about it yet.

**The export of 2026-09-18 is not committed.** Owner decision, same day: the record in git comes from the skill, not
from the one-off script. So `scripts/prompts.mjs`, `scripts/prompts-order.json`, `scripts/prompts-sessions.json`, the
`pnpm prompts` entry, and `docs/prompts/sessions/` never enter history — the `package.json` edit is reverted rather
than added and removed.

What carries over is the **existing titles and notes** — 29 of them. Not because they could not be regenerated: they could, and the skill will regenerate any of them on request. They migrate simply
because they already exist and are good enough, and re-deriving 58 sessions' worth of text to arrive somewhere
similar is work for its own sake. They seed the cache; `--retitle` replaces any that read wrong.

The 29 generated files stay on disk, uncommitted, until the skill's backfill is verified against them — they are
currently the only rescued copy of anything. They are deleted once their replacement exists, not before.

## 5. Out of scope

- **Cursor transcript parsing.** The hook fires in all three; the parser reads Claude Code and Codex. Cursor is not
  installed on this machine, so a parser for it could not be exercised and is not written. The extractor sits behind
  a source interface, so adding one later is a new file rather than a rewrite. The skill says plainly which agents it
  can capture.
- **Uploading anything anywhere.** Captures are files in the repo. No service, no account, no network.
- **Automatic capture.** Requirement (c) is on demand. The hook reminds; it never captures unasked.
- **Deleting or pruning transcripts.** This reads the cache and never writes to it.

## 6. Acceptance criteria

1. Invoking the skill in a live conversation writes one file to `docs/prompts/conversations/` containing that
   conversation's prompts and replies, with no tool calls or tool results — from either a Claude Code or a Codex
   session.
2. A capture containing a value present in `.dev.vars` is refused, and the refusal names the key.
3. A capture containing a sensitive string matching no pattern is flagged by the agent before the file is written.
4. The hook, registered on all three agents, reports an uncaptured session nearing expiry, and stays silent for the
   rest of that calendar day.
5. The hook reports nothing when every session is captured, and exits 0 either way.
6. A newly captured session gets a generated title and note without being asked, and they are stable across an index
   rebuild. `--retitle` changes them; a hand-edited entry survives both. Every session titled in the 2026-09-18
   export still has one. Nothing from `scripts/` appears in `git log`.
7. A repo with no `.agents/capture.json` works on the defaults.
8. `pnpm check` is green.
