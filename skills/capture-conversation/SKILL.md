---
name: capture-conversation
description: Write an agent conversation into the current repository as a markdown file - prompts and replies verbatim, tool calls stripped - then title it and rebuild the index. Reads the local Claude Code and Codex caches, which both expire, so capturing is how a conversation outlives them. Run it when the user asks to capture, save, record, or archive a conversation, or when a reminder says sessions are about to be pruned. Never run it unasked.
compatibility: Any git repository, run from anywhere inside it. Needs Node 22 and git. Reads ~/.claude/projects and ~/.codex/sessions; Cursor is not supported. Writes only inside the repo.
allowed-tools: Bash(node skills/capture-conversation/scripts/capture.mjs:*)
---

# Capture a conversation

Agent conversations live in a local cache that expires — Claude Code prunes its transcripts on a retention window
that defaults to 30 days. Nothing in the repository records how its code came to be. This writes a conversation into
the repo, where it outlives the cache.

| What | Where |
| --- | --- |
| Captures | `docs/prompts/conversations/` (configurable) |
| Index | `<out>/README.md`, generated — never hand-edit |
| Titles and notes | `.agents/capture-sessions.json` |
| Settings | `.agents/capture.json`, all keys optional |

## Screening happens before anything is written

A capture can contain whatever was pasted into a conversation. Screening runs on every capture **before** it reaches
disk — screening afterwards would mean the secret had already landed in the repo.

It produces two kinds of result, and the difference is the point:

**Redactions are certain, so they are applied and reported.** Email addresses, and any value read out of this
machine's own `.dev.vars` or `.env` files. A value enumerated in an env file is a secret by definition; there is
nothing to decide. Template files (`.example`, `.sample`, `.template`) are skipped — they are committed on purpose
and their values are already public.

**Findings are suspicions, so they stop the write.** Bearer tokens, private key blocks, AWS, Google, GitHub, Slack
and npm token shapes, and 32-character hex ids. That last one is a Cloudflare account id and also an md5, which is
exactly why it asks instead of assuming.

A blocked capture is not written at all, and the report names what was found without printing the value. Then either
remove the secret at its source, or — if it is harmless — add the exact string to `allow` in `.agents/capture.json`
and run again. For a value from an env file, allow it by its **key name**: that means "yes, redact that one and
continue", and the raw value never reaches disk on either path.

**Then read the capture yourself.** The patterns catch known shapes; they cannot catch an internal hostname, a
customer name, or a credential in a form nobody has seen before. Read what was written before committing it.

## Running it

```
node skills/capture-conversation/scripts/capture.mjs                    # the live conversation
node skills/capture-conversation/scripts/capture.mjs --session 1a2b3c4d # one session by short id
node skills/capture-conversation/scripts/capture.mjs --backfill         # everything still in the caches
node skills/capture-conversation/scripts/capture.mjs --index            # rebuild the index only
node skills/capture-conversation/scripts/capture.mjs --retitle [id]     # write titles again
node skills/capture-conversation/scripts/capture.mjs --out <dir>        # somewhere other than the configured path
node skills/capture-conversation/scripts/capture.mjs --dry-run          # report, write nothing
```

With no arguments it captures the most recently active session for this repo. If two were active within a minute of
each other it refuses and asks you to name one, rather than capturing the wrong conversation silently.

## Then title it

The script never invents a title. A mechanical one built from the first prompt would be worse than nothing, and
because a cached title is never regenerated it would be wrong permanently.

When the script reports captures that need a title, **read each capture and write one**:

1. Open the capture. Read the whole conversation, not the first few turns.
2. Add an entry under its key in `.agents/capture-sessions.json`:
   ```json
   "claude-1a2b3c4d": {
     "title": "What this session was",
     "note": "One or two sentences: what was decided, what was tried and abandoned, what stuck."
   }
   ```
   A good title names the work, not the agent or the date. A good note records what someone would otherwise have to
   re-read the whole conversation to learn — a decision and its reason, a thing that failed, a rule that came out of
   it. Both come from the conversation and the repo around it; neither is guesswork.
3. Re-run with `--index`.

If the user corrects a title by hand, add `"pinned": true` to that entry. `--retitle` skips pinned entries, so a bulk
retitle cannot discard a human's correction.

## What it captures, and what it drops

**Kept:** every turn a person typed, and every prose reply.

**Dropped:** tool calls and their results, model reasoning, injected skill text, task notifications, compaction
summaries, and system instructions. That is roughly 84% of a transcript's bulk, it is unreadable as prose, and it is
where pasted secrets and file contents actually live.

**Both sides are fenced verbatim.** Replies are markdown; rendering them raw would inject their headings and lists
into the document. A capture is a record, not a rendering of one.

## One conversation is not one file

Neither agent stores a conversation the way you would guess, and the script reconciles both:

- **Codex** segments one session across several rollout files that all report the same `session_id`. They are
  grouped by that id and read as one. The files' own names carry different ids — do not group by those.
- **Claude Code** resumes a session by copying its parent's transcript under a new id, so two transcripts overlap
  almost entirely. Because turn timestamps are millisecond-precise, any two transcripts sharing one exact turn are
  treated as the same conversation and merged. A parent can hold a turn the resume dropped — an instruction
  abandoned mid-keystroke, say — and merging keeps it where dropping the parent would lose it.

## Capturing a live conversation

A capture taken now cannot contain the turns that follow it, including the one that asked for it. Re-running
overwrites it with a longer version. The file is always a prefix of the truth, never wrong — this is not data loss.

## The expiry reminder

`scripts/uncaptured.mjs` reports conversations that are near the end of their cache's retention and have never been
captured. It is meant to run from a session-start hook, and Step 4 of the plan registers it.

```
node skills/capture-conversation/scripts/uncaptured.mjs --agent claude|cursor|codex
  --within <days>   widen the expiry window (for testing)
  --force           ignore the throttle (for testing)
```

**It never blocks, never writes a capture, and always exits 0**, even when it fails. A reminder that can break
someone's session start is worse than no reminder.

**It speaks once a day per repository**, not once per session. The stamp lives in `~/.cache/capture-conversation/`,
outside the repo — it is per-machine state, and committing it would let one developer's reminder silence another's.
The throttle is shared across agents, so opening three agents in a day is one reminder rather than three.

**It knows about merged conversations.** Every capture carries a `<!-- capture:covers … -->` marker naming the
transcripts it was assembled from, so a transcript absorbed into a merged conversation is not reported as missing.

**It skips transcripts with no conversation in them** — an agent opened and closed leaves a file with nothing to
capture, and reporting it daily until it expires is a false alarm. That check costs a read, so it runs against the
handful of candidates rather than every transcript on disk.

**Codex retention is unconfirmed.** The 30-day window is Claude Code's `cleanupPeriodDays` default, applied to Codex
as a guess; the reminder says so on any Codex row rather than implying a certainty it does not have.

## Cursor

Not supported. The reminder hook fires in Cursor, but there is no reader for its conversations. Adding one means a
third file under `scripts/sources/`; nothing else changes.
