# Implementation roadmap — M4 Chat

**Implements:** `docs/specs/chat-origin-scope.md` under `AGENTS.md`; product contract `docs/PRD.md` §4.5, §5.2, §6,
§7, §8, §9.
**Written:** 2026-09-15, against `main` at `455c9e8`.
**Status:** M4.1 implemented 2026-09-16, awaiting commit. M4.2 and M4.3 not started.
**Shape:** three chunks, each with its own spec and plan, in the shape M3 used. Origin and scope are **not** a chunk:
they are woven through all three, so chat is never built global and then amended.

## What already exists — never re-plan it

Read before planning anything. The User DO chat layer shipped with the 2026-09-12 API restart and is tested:

| Exists | Where |
|---|---|
| `chats`, `chat_messages`, `chat_message_sources`, `user_preferences` tables | `apps/api/migrations/user/0001_init.sql` |
| `createChat`, `listChats`, `getMessages`, `appendExchange`, `completeAssistantMessage`, `failAssistantMessage` | `apps/api/src/do/user/chats.ts`, faced in `apps/api/src/do/user.ts` |
| Tests for all of the above | `apps/api/test/user-chats.test.ts` |
| `Chat`, `ChatMessage`, `ChatSource`, `ChatsResponse`, `ChatResponse`, `ChatMessagesResponse`, `ChatExchangeResponse`, `CreateChatBody`, `SendMessageBody` | `packages/shared/src/index.ts` |
| `GET`/`PUT /preferences`, registered and tested | `apps/api/src/routes/preferences.ts`, `apps/api/test/routes-preferences.test.ts` |
| The reading screen `Ask` hangs off, and the vectors chat queries | Design phase, M3 |
| The `episodeId` metadata index scoped retrieval needs | Created before M3's first upsert; guarded by `apps/api/test/wrangler-config.test.ts:175` |

**Nothing else exists.** There is no `routes/chats.ts`, no retrieval or answering path anywhere in `apps/api/src/`,
and no web screen — the Design phase deleted the placeholder rather than stubbing it.

## The three chunks

| # | Spec and plan | Carries | Size | Depends on | Product-visible | Status |
|---|---|---|---|---|---|---|
| M4.1 | `m4-1-chat-routes.md`, `-plan.md` | `routes/chats.ts` (three routes), `about_episode_id` and its plumbing, `getChat` on the DO, the OpenAPI entry | M | nothing | no: no screen calls them yet | implemented 2026-09-16, awaiting commit |
| M4.2 | `m4-2-chat-answering.md`, `-plan.md` | `lib/chat.ts`, the widened `lib/vectorize.ts` filter union and its fake, `POST /chats/:id/messages` with `aboutEpisodeId` and the four branches, the chat prompt, staleness reconciliation | L | M4.1 | no: still no screen | not started |
| M4.3 | `m4-3-chat-web.md`, `-plan.md` | `/chats` as a history, `/chats/:id` with the sticky chip, `Ask` on the reading screen, per-message scope, `Try again`, Account's chat-rules field | L | M4.2, **and three artboards** | yes: the whole feature | not started |

## Decisions the split made (2026-09-15)

These are the split's, not the spec's, and the owner may reverse any of them.

1. **`POST /chats/:id/messages` is M4.2, not M4.1.** Answering is inline (spec §4.8), so the route cannot ship before
   the path that answers it — it would store a pending reply nothing completes. M4.1 therefore carries the three
   routes that need no model call, and the send route arrives with its answer.
2. **`about_episode_id` lands in M4.1, before anything writes it.** It is storage, and storage belongs with the
   chunk that already touches `do/user/chats.ts`. M4.2 then adds no migration. **Owner decision 2026-09-16:** it goes
   into `0001_init.sql` in place, the User DO keeps one migration file, and the owner's local storage is wiped rather
   than upgraded — a `/clean-local` is owed before the next `pnpm dev`.
3. **Origin and scope are woven, not chunked.** M4.1 carries the column, M4.2 the retrieval branch, M4.3 the chip and
   the `Ask` entry. No chunk builds a global chat that a later one corrects.
4. **M4.3 is gated on design work.** `chat-origin-scope.md` §4.7 names three artboards that do not exist — the chip
   in both states, the per-message scope mark, and `/chats` without a create control. M4.3 cannot start without them,
   and that gate is the reason it is last rather than merely large.
5. **Unread receipts are audited, not built.** M4's line in PRD §10 carries them, but the Design phase delivered
   reading as an act with `POST`/`DELETE …/read`. M4.1 opens with a read of that surface; if it is complete, the
   milestone line is the only thing to correct. **Audited 2026-09-16: complete.** `POST`/`DELETE
   /channels/:id/episodes/:episodeId/read` (`routes/channels.ts:466`, `:492`), `read` on an eligible caller's
   episode (`routes/episodes.ts:44`), `unread=true` on `/digest` (`routes/digest.ts:63`) and `unreadCount` on
   `/follows` (`routes/follows.ts:76`), over a tested `do/user/reads.ts`. Nothing is owed but PRD §10's M4 line,
   which is the owner's to change.

## Definition of complete for M4 Chat

All nineteen criteria of `chat-origin-scope.md` §5, plus each chunk spec's own. `pnpm check` green at every chunk
boundary. The owner's click-through against a live catalog, which is what closed the Design phase and M3.
