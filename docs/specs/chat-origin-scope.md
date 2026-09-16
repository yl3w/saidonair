# Feature spec — Chats begin at a summary: origin and per-message scope

**Status:** written 2026-09-15, awaiting owner approval. Part of M4.
**PRD:** §4.5 (chats and retrieval), §5.2 (schema), §6 (retrieval), §7 (Reading, Chats, the route table), §8, §9.
**Depends on:** most of chat, which is unbuilt — corrected 2026-09-15 after reading the code. What exists is the
User DO storage layer: `apps/api/src/do/user/chats.ts` carries `createChat`, `listChats`, `getMessages`, the
two-phase `appendExchange`, `completeAssistantMessage`, `failAssistantMessage` and citation snapshots, with
migrations under `apps/api/migrations/user/`, and `/preferences` is registered. What does not exist is everything
else: no `routes/chats.ts`, no retrieval or answering path anywhere in `src/`, no web screen. What this spec needs
and already has is the reading screen it hangs off (Design phase), the vectors it queries (M3), and the `episodeId`
metadata index. **This spec is therefore a slice through M4's chat work, not a standalone change**, and is delivered
across the three chunks of §4.8 rather than on its own.
**Supersedes:** nothing. It amends the chat behaviour §4.5 has carried since the 2026-09-12 restart, none of which
was ever built.

## 1. Summary

Chat was specified as a global surface — an empty chat, a blank box, every message searching everything the reader
follows. This spec changes where a chat begins and where its scope lives, and changes nothing else about it.

A chat now begins at a summary and nowhere else: `Ask` on `/read/:episodeId` is the only entry, and the chat it
opens is scoped to that episode. The scope is a property of each **message** — one optional `aboutEpisodeId` on
`POST /chats/:id/messages`, one nullable `chat_messages.about_episode_id` — and never of the chat, so no chat holds
state that follow changes could invalidate. The reader sees the scope as a chip that is sticky until dismissed and
rides in the URL as `?about=<episodeId>`. Dismissing it returns the chat to every eligible channel.

The API delta is one optional field. The schema delta is one nullable column. Everything else is web and retrieval.

## 2. Why this shape

### 2.1 The two faults in a global chat

**The blank box has no cold start.** A reader meets an empty input with no idea what the corpus can answer, tests it
with the question it is worst at — "summarise everything" — and judges the feature on its weakest answer. The
summary already on screen does that job better, so the first impression is of a feature that duplicates one.

**`topK: 3` over an unguided pool is the retrieval this product can least afford.** §7 designs every screen for
thirty follows. Three chunks — about three minutes of speech — drawn from thirty channels may be three unrelated
shows, and nothing in the question says which one was meant. There is no repair available to the reader either:
`Try again` resends the same question (`design-phase.md` §4.9), so the only correction is rephrasing, which is query
engineering pushed onto the reader.

Both faults are fixed by where a chat begins, not by anything in the prompt or the model.

### 2.2 The measured constraint

`summary-quality.md` §4.3 records three A/Bs against the live model: `llama-3.3-70b` has a stylistic prior for
"The guest…" that prompt instructions do not shift, and a participant-extraction call that put
"David Freeberg (guest, former White House advisor)" directly into the prompt still produced **0% named**, with a
possibly hallucinated name for the trouble. Attribution in generated prose was tried and abandoned.

This bears directly on chat. Untargeted retrieval maximises the number of distinct voices in one prompt, which is
the worst case for a fault already known and accepted. Episode-scoped retrieval minimises it. The citations carry
attribution **structurally** — channel and episode titles are stored, not generated — which is why source cards are
the part of a reply worth investing in and the prose is not.

### 2.3 What chat is for, and what it is not

The bar is not "is a chat nice" but **what this adds over the summary already on the screen**. Three things clear it:

1. **Detail below the summary's resolution.** Sections and takeaways compress an hour; the specific number, the
   company named once, the caveat attached to a claim are in the transcript and nowhere else. This is the strongest
   case and the one episode scope serves best.
2. **"Did they actually say that?"** Verification of a half-remembered or second-hand claim, checkable in one click
   through a timestamped citation.
3. **Cross-episode synthesis.** The differentiated use, one dismissal away rather than the default.

Three where it is weak: anything needing more than three chunks (the summary does it better), general-knowledge
drift where the model answers from its weights while the citations make that look authoritative, and cross-source
attribution per §2.2.

**Chat is a depth tool, not a discovery tool.** Global-first made it a mediocre discovery tool; origin-at-reading
makes it a good depth tool. A later global "ask anything" box on Queue would recreate the blank box this removes and
should be refused on those grounds.

### 2.4 The use pattern being optimised for

The PRD calls Said on Air "a personal, long-lived tool for a small, trusted set of users" (§1), so this is not market
sizing — it is the pattern the feature is tuned for, written down so it is not an imagined one.

**Primary: the analyst-listener.** Follows fifteen to thirty shows in a domain where claims have consequences.
The defining trait is not volume but that **they act on what was said and being wrong is costly** — which is what
makes a timestamped citation worth more to them than a good summary.

**Sharpest wedge: the writer or researcher.** Retrieval-with-citation is their workflow rather than an enhancement
to it, and they notice a bad citation immediately, which makes them the best source of feedback.

**Not the pattern, despite resembling it:** the professional keeping up with fifteen podcasts, whose need is
skimming and is already served by the summary; and the casual listener with three shows, who asks nothing.

**Health metric: source-link click-through**, not messages sent. A clicked `youtu.be/<id>?t=` means the answer was
worth verifying, which is the job. Messages sent measures curiosity. Expect chat to be **low-frequency without that
being failure** — the question to ask is what share of *read* episodes produce a question.

## 3. Decisions this spec makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | `Ask` on a summary is the only entry to a chat | A "new chat" control anywhere else restores the blank box §2.1 removes |
| 2 | Scope is per message, never on `chats` | Chat-level scope owes a policy for every unfollow, decline and re-approval, per chat; a hint owes nothing |
| 3 | The chip is sticky until dismissed | A one-shot chip can be missed; a persistent one is a standing disclosure of what is being searched |
| 4 | Scope rides in the web URL as `?about=` | A path identifies a resource, a query modifies one; a dismissable chip must leave a valid URL behind |
| 5 | The API carries it in the message body | It belongs to the message being created. A web-route question and an API-resource question need not agree |
| 6 | A hint narrows, never widens | Otherwise the parameter is a way to read chunks from a channel the caller does not follow |
| 7 | Dismissing widens the chat to global | **The reversal the owner is most likely to want.** Cross-source synthesis is the one thing chat does that a transcript search cannot |
| 8 | A chat's origin is its first message's hint, not a column | Scope lives on messages; a chat whose chip was dismissed before the first send honestly has no origin |
| 9 | An ineligible hint is refused out loud | A silent widening is the trust failure; it makes a thin answer indistinguishable from a missed one |
| 10 | Answering runs inline in the request | Seconds of mostly-waiting fits a request. `waitUntil` buys a polling loop and a severable tail; a Workflow per message pays startup latency where the reader is watching |
| 11 | Code attaches citations; the model writes prose | `summary-quality.md` §4.3 shows this model ignoring an explicit attribution ban and returning 0% named with names in its prompt. Attribution that cannot be hallucinated beats per-sentence provenance |
| 12 | A pending reply that outlives its request is failed inline | The cost of inline answering. Precedent is PRD §4.2 rule 17, which reconciles a dead Workflow instance the same way |

## 4. Contract

### 4.1 The entry

`Ask` joins the reading screen's chrome beside `Episode` and `Done`. It renders only when all three hold: the
episode has a published summary, its `active_vector_generation` is set, and its channel is in the caller's eligible
set (§4.3 of the PRD: active follows ∩ approved, paused or not). Otherwise it is absent — not disabled.

It navigates to a chat scoped to this episode and **writes nothing**. The chat is created by the first message, so
an abandoned `Ask` leaves no empty chat in the history. Until then the URL names no chat id.

### 4.2 Scope on a message

`POST /chats/:id/messages` takes `{ message, aboutEpisodeId? }`. The hint is stored on the **user** message in
`chat_messages.about_episode_id` and returned with it, never on the reply, and is never rewritten by later follow
changes. `chats` gains no column.

Validation order, because it decides which of three responses the reader gets:

1. `aboutEpisodeId` names no episode in the catalog → `400`.
2. The caller has no eligible follows at all → the fixed response of PRD §4.5, no AI and no Vectorize call.
3. `aboutEpisodeId` names an episode whose channel is not in the caller's eligible set → a stored assistant reply
   saying the scope can no longer be searched and that the chip can be dismissed to search everything else. No AI
   call, no Vectorize call, no sources. **Never a global answer.**
4. Otherwise retrieve per §4.4.

### 4.3 The chip

One chip above the input, showing the episode title and a dismiss control. Sticky: it survives message sends and
reloads, persisting until dismissed. A second `Ask` **replaces** it; scope is one episode or none, never a set.

It is held in the URL as `/chats/:id?about=<episodeId>` — that is what makes it survive a reload, and it makes a
scoped chat linkable. Dismissing it strips the parameter and leaves `/chats/:id`, which is a valid chat URL.

### 4.4 Retrieval

Unscoped is unchanged: `filter: { channelId: { $in: eligibleChannelIds } }`, `topK: 3`, namespace `shared-catalog`,
with the 2048-byte filter split and score merge of PRD §6.

Scoped replaces the channel filter with `filter: { episodeId: { $eq: aboutEpisodeId } }` **after** confirming that
episode's channel is in the same eligible set. The replacement is safe only because the hint is strictly narrower
than the filter it replaces; this is the one place the channel filter may be absent, and it is never absent for any
other reason. Every other §6 rule stands unchanged — generation validation against `active_vector_generation`,
availability and eligibility revalidation, fetching more candidates when rejecting, and never an unfiltered query.

Two code facts this depends on:

- The `episodeId` metadata index **already exists** on the Vectorize index and predates this feature; it is guarded
  by `apps/api/test/wrangler-config.test.ts:175`. No index rebuild, which would otherwise be the blocker, since
  vectors written before an index exists are not filterable on that field.
- `QueryOptions.filter` in `apps/api/src/lib/vectorize.ts:39` is typed `{ channelId: { $in: string[] } }` and must be
  widened to a union with the episode form. The in-repo fake filters on `channelId` alone
  (`apps/api/src/lib/vectorize.ts:299`) and must be widened with it, or scoped retrieval is untestable.

### 4.5 `/chats` as a history

`/chats` lists conversations and offers **no way to create one**. It stays out of primary navigation, which remains
Queue and Sources. A chat is named by its first question, and each row shows the episode the chat began at — its
first message's hint — beside the name.

`/chats/:id` renders the transcript with **each message showing the scope it was sent under**, so a scoped answer is
distinguishable from a global one in scrollback. `Try again` resends the same question with the same hint.

### 4.6 Schema

One nullable column on `chat_messages`:

```sql
about_episode_id TEXT
```

No `CHECK`, no foreign key — episode ids are cross-DO references validated through Registry methods, not SQLite
foreign keys (PRD §5.2). It is added to `0001_init.sql` in place rather than as a second migration (owner decision
2026-09-16): the User DO keeps one migration file, and storage that already applied `0001_init` is wiped rather than
upgraded, which is the governance PRD §5.4 already describes. **A `/clean-local` is therefore owed before the next
`pnpm dev`.**

### 4.7 What the artboards do not yet have

`design-phase.md` §4.9 drew the conversation for a global chat. Three things in this spec are not in those
artboards and need drawing before the web is built: **the chip** in both its states, **the per-message scope mark**
in the transcript, and the **absence** of a new-chat control on `/chats` — which changes that screen from an entry
to a history. The states already drawn (pending, failed, the fixed no-follows reply, an answer with a linkified
URL, unfollow's effect on an old answer, the first run, the phone) are unchanged.

### 4.8 Answering, citations, and delivery

Phase two runs **inline**: the route stores the exchange, then embeds, queries, validates, prompts and calls
`completeAssistantMessage` before responding, so the reader gets a finished reply in one round trip. The two-phase
write is kept for the crash case — a failure between phases leaves the question stored and the reply pending rather
than losing both — and `failAssistantMessage` records a refusal or an error. A pending reply older than the
answering budget is reconciled to `failed` when a read notices it; nothing polls for it.

**Citations are attached by code.** The chunks that survived §4.4's validation become the reply's sources in score
order, and the model is asked for prose with no markers to emit and no citation instruction in its prompt. A reply
therefore cannot cite an episode that did not feed it.

This spec is delivered across three chunks, each with its own spec and plan, in the shape M3 used:

| Chunk | Carries |
|---|---|
| **m4-1** | `routes/chats.ts` — `POST /chats`, `GET /chats`, `GET /chats/:id/messages` — shared types, the generated OpenAPI entry, and the `about_episode_id` migration with its plumbing through `do/user/chats.ts`. No answering, so no `POST /chats/:id/messages` |
| **m4-2** | `lib/chat.ts` (eligibility → filter → embed → query → validate → prompt → complete), the widened `lib/vectorize.ts` filter union and its fake, `POST /chats/:id/messages` with `aboutEpisodeId` and §4.2's four branches, the chat prompt, and the staleness reconciliation |
| **m4-3** | `/chats` as a history, `/chats/:id` with the sticky chip, `Ask` on the reading screen, per-message scope in the transcript, `Try again`, and Account's chat-rules field returning (PRD §7) |

`POST /chats/:id/messages` cannot ship before m4-2: inline answering means a route without an answering path would
store a pending reply nothing completes. **m4-3 is gated on the three artboards of §4.7**, which are design work
before code.

## 5. Acceptance criteria

1. `Ask` renders on a summary that is published, has an active vector generation, and whose channel is eligible for
   the caller; it is absent — not disabled — when any of the three fails.
2. `Ask` creates nothing. Navigating away without sending leaves no chat in `GET /chats`.
3. A first message sent from `Ask` carries `aboutEpisodeId`, and its reply's sources all come from that episode.
4. `chat_messages.about_episode_id` is written on the user message and null on the reply.
5. The chip survives a page reload, because the URL carries it; dismissing it leaves `/chats/:id` valid.
6. A second `Ask` into the same chat replaces the chip rather than adding one.
7. A message sent after dismissal retrieves across every eligible channel, and its stored hint is null.
8. A hint whose channel has become ineligible produces the stored refusal of §4.2 step 3 — never a global answer —
   with no AI and no Vectorize call, verified by the fakes recording zero calls.
9. A caller with no eligible follows gets the fixed response of PRD §4.5 with no AI and no Vectorize call, reached in
   a chat whose follows dropped to zero after it began.
10. An `aboutEpisodeId` naming no catalog episode is `400`.
11. A scoped query sends `filter: { episodeId: { $eq: … } }` and an unscoped one sends the channel filter; neither
    ever sends an unfiltered query, asserted on the fake.
12. Scoped retrieval still rejects chunks from a non-active vector generation and fetches further candidates.
13. `GET /chats/:id/messages` returns each message's hint, so history renders the scope each was sent under.
14. A stored hint is unchanged after the reader unfollows and refollows the channel.
15. `/chats` exposes no control that creates a chat.
16. A reply's sources are exactly the validated chunks that fed it, in score order, and its text contains no citation
    markers; the prompt carries no citation instruction.
17. A reply is complete in the response to `POST /chats/:id/messages` — no second request is needed to read it.
18. A failure between phases leaves the question stored `completed` and the reply `pending`, never the question lost.
19. A pending reply older than the answering budget reads as `failed`, and `Try again` then sends a new attempt that
    keeps it above.

## 6. Out of scope

Per-sentence provenance — markers in the prose resolved to sources — which §4.8 declines and PRD §9 records as the
v2 if click-through ever asks for it. Setting `chats.title` from any route, searching chats, and deleting a chat — the three gaps `design-phase.md` §4.9
records, all still open and none closed here. Multi-episode or channel-level scope, which is the picker this spec
exists to avoid. Blending scoped and global results in one reply (episode first, global backfill) — the obvious v2,
deferred until the citation data of §2.4 says whether readers ask comparative questions. Any global "ask anything"
entry. Chat preference rules returning to Account, which rides with M4's chat screen but is its own change. The
reading screen's own behaviour, unchanged but for the new control.

## 7. `AGENTS.md` and PRD alignment

PRD §4.5, §5.2, §6, §7 (Reading, Chats, route table), §8 and §9 were updated with this spec on 2026-09-15; §9 carries
the decision and its costs. `AGENTS.md` needs one line in its retrieval section pointing `lib/vectorize.ts`'s widened
filter at PRD §6, and nothing else: the origin rule is product behaviour and belongs in the PRD, not there.
