# Feature spec — M4.3 The chat screens

**Implements:** the last of `docs/specs/chat-origin-scope.md` §4.8; roadmap `docs/specs/chat-origin-scope-plan.md`.
**Product contract:** `docs/PRD.md` §4.5, §6, §7; visual system `docs/design.md`.
**Artboards:** https://claude.ai/code/artifact/2ac197c6-36ab-45e0-9a30-3deb23e9cbc4 — the six additions of
2026-09-16, over the core anatomy `docs/specs/design-phase.md` §4.9 already drew.
**Written:** 2026-09-16.
**Status:** written, awaiting the owner's go.
**Depends on:** M4.1 (`97247d5`) and M4.2 — the four routes exist, answering works, and the whole Knowledge Project
channel is scoped-searchable in dev.

## 1. Summary

The screens. `Ask` on a summary becomes the only way into a chat; `/chats` lists what exists and offers no way to
make one; `/chats/:id` is the conversation, with the scope chip in its URL and every message showing the scope it
was sent under. Account's chat-rules field returns, because `system_rules` finally shapes something.

This chunk also implements two rules the API deliberately left to the reader's view: **sources group by episode**,
and **timestamps ascend within a group**.

After it, M4 is complete and chat works for a person rather than for `curl`.

## 2. Decisions this spec makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | `Ask` navigates to `/chats/new` and hands the scope over in memory; **nothing is in the URL** | Owner decision 2026-09-16. `new` is a reserved segment so the composer route is one pattern. Scope is the screen's state: an existing chat recovers it from its last question, which is more authoritative than a parameter, and a chat that does not exist yet has only the navigation to carry it. A chat id is minted by the first send, which keeps an abandoned `Ask` out of the history |
| 2 | Six source cards stack; nothing collapses | Unscoped keeps six chunks, so six episodes is the ceiling, and a card is three lines. Collapsing would hide the evidence the citation exists to show — and grouping already means a scoped reply is one card, not eight |
| 3 | On a phone the role gutter becomes a line above the message | The 64 px gutter does not fit at 390 px. Roles stay words, never colour or alignment: a right-aligned bubble would be the "no bubbles" rule of §4.9 broken to save 64 px |
| 4 | The chip keeps its `✕` rather than a labelled "Search everything" control | Owner decision 2026-09-16. The line beneath the composer — "Searches this episode only." / "Searches every channel you follow." — does the explaining, and a labelled control is heavier chrome for a mode a reader changes rarely |
| 5 | Grouping and sorting happen in the view, not in a shared helper | One screen renders sources. A helper would be a second home for a rule whose only consumer is this component |

## 3. Contract

### 3.1 Routes

| Route | Screen | Notes |
|---|---|---|
| `/chats` | `Chats.tsx` | The history. No create control, no search, no delete |
| `/chats/new` | `Chat.tsx` | The composer before a chat exists; `lib/ask-scope.ts` carries the scope across the navigation |
| `/chats/:chatId` | `Chat.tsx` | The conversation; the chip is state, recovered from the last question on load. **Its own bar, no rail** (2026-09-17): a screen about one object takes a way back and no destinations (`docs/design.md` §3), and a chat has no acts to put on the right |

`/chats` joins primary navigation for the first time (`docs/design.md` §3 anticipated it). The phone's tab bar goes
from two destinations to three, each still 44 px.

### 3.2 `Ask`, on the reading screen

Joins the chrome beside `Episode` and `Done`, and renders only when the episode has a published summary, an active
vector generation, and a channel eligible for this caller (`chat-origin-scope.md` §4.1). Otherwise **absent, not
disabled**. `GET /episodes/:episodeId` already answers everything the condition needs.

### 3.3 The conversation

**No rail of other chats, and the screen takes its own bar** (owner decision 2026-09-17). §3 reserves a rail for
navigation *about* what is on the page; a list of different conversations navigates away from it, `/chats` is one
click away in the nav, and a chat here is not a workspace — it begins at a summary, serves a few questions, and is
left. The bar carries a way back and **the chat's name**, which is its first question. The transcript opens with that
same question, but the bar is sticky and the question is not — a screen into a long answer, the bar is the only thing
saying which conversation this is. It is truncated, because a question is as long as someone felt like typing. The
right side stays empty: nothing renames or deletes a chat, so there are no acts to put there. Back is `goBack()` with
`/chats` as the fallback, as a channel's bar does — the browser's own history is what "the page I came from" means
(§3), and the fallback is for a pasted link.

Roles in the left gutter, no bubbles. A question shows the scope it was sent under — "Asked about *<title>*", or
nothing at all when it was global. An answer renders as plain text with newlines preserved; only `youtube.com` URLs
linkify (PRD §7).

**Sources group by episode and ascend within a group.** The API stores one source per retrieved chunk in score
order; the view groups them and sorts each group's timestamps. A scoped reply is therefore one card carrying up to
eight moments, and an unscoped one is up to six cards, each with one or more.

A `truncated` reply carries one line beneath it — "Answer shortened." — and no `Try again`: the same question would
stop in the same place. A `failed` reply carries `Try again`, which resends the same question as a new attempt and
keeps the failed reply above it (§4.9).

### 3.4 The chip

Sticky until dismissed, and held as the screen's state. **A reload recovers it from the chat's last question** —
every question stores its own `aboutEpisodeId`, so the conversation says what it is searching. Seeded once per load,
deliberately: re-seeding after every send would undo a dismissal from the question before it. Beneath the composer, one line says which of the two is in force — the only thing
telling a reader that widening exists.

### 3.5 Account

The `system_rules` field returns, against `GET`/`PUT /preferences`, which have been registered and tested since
2026-09-15 and called by nothing. Labelled as applying to chat answers alone.

## 4. Acceptance criteria

1. `Ask` renders on an eligible, summarised episode with an active generation, and is absent otherwise.
2. `Ask` navigates to `/chats/new` with the scope in memory and creates nothing; leaving without sending adds no
   chat to `/chats`.
3. The first send creates the chat and replaces the URL with `/chats/:chatId`; the scope carries over in state.
3b. Reloading a scoped chat recovers the chip from its last question; reloading `/chats/new` lands unscoped.
4. Dismissing the chip widens the next question; a dismissal that is never sent does not survive a reload, because
   the conversation still says scoped.
5. A message sent with the chip carries `aboutEpisodeId`; one sent after dismissal does not.
6. Each message renders the scope it was sent under; a global one renders no mark.
7. Several sources from one episode render as **one card**, its timestamps ascending, not in stored order.
8. Six sources across six episodes render as six cards, in stored score order.
9. A truncated reply shows "Answer shortened." and offers no `Try again`.
10. A failed reply offers `Try again`, which sends the same question again and leaves the failed reply above it.
11. `/chats` lists chats with their origin episode or "Across everything you follow", and exposes no control that
    creates, searches or deletes one.
12. Primary navigation carries Chats; the phone's tab bar has three 44 px destinations.
13. Account saves and clears `systemRules`, and a saved value returns on reload.
14. Every screen meets §4.10's floor: 4.5:1 text, nothing meaningful under 12 px, 44 px touch targets, and no state
    carried by colour alone.

## 5. Out of scope

The three gaps `design-phase.md` §4.9 records and this chunk does not close: nothing sets `chats.title`, nothing
searches chats, nothing deletes one. The two deferrals of `m4-2-chat-answering.md` §5 — the 2048-byte filter split
and context-budget history. Any change to the answering path. A global "ask anything" entry, which is the cold start
the origin rule exists to remove and should be refused if proposed.

## 6. `AGENTS.md` and PRD alignment

PRD §7 already describes these screens and needs no edit. `docs/design.md` §3 said Chats joins navigation "when M4
builds the screen" — this is that, so the line becomes past tense. `AGENTS.md` needs nothing: the web's conventions
are unchanged and it stays typecheck-and-lint only.
