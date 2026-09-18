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

## ⚠ Screening is not built yet

**Do not commit a capture until `screen.mjs` exists.** Captures can contain anything that was pasted into a
conversation, including keys and command output. Until the screening step lands, write captures to a scratch
directory with `--out` and read them yourself before anything is staged.

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

## Cursor

Not supported. The reminder hook fires in Cursor, but there is no reader for its conversations. Adding one means a
third file under `scripts/sources/`; nothing else changes.
