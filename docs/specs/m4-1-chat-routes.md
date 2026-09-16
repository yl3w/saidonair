# Feature spec — M4.1 Chat routes

**Implements:** part of `docs/specs/chat-origin-scope.md` §4.8; roadmap `docs/specs/chat-origin-scope-plan.md`.
**Product contract:** `docs/PRD.md` §4.5, §5.2, §7 (route table).
**Written:** 2026-09-15.
**Status:** implemented 2026-09-16, awaiting commit. All fourteen criteria met.

## 1. Summary

The three chat routes that need no model call, over a User DO layer that already exists, plus the scope column every
later chunk depends on. Nothing here answers anything: `POST /chats/:id/messages` belongs to M4.2, which brings the
answering path it cannot work without.

After this chunk the API can create a chat, list the caller's chats, and return one chat's messages with their
citation snapshots and the scope each was sent under. No screen calls any of it yet.

## 2. Decisions this spec makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | `about_episode_id` is added to `0001_init.sql` in place; the User DO keeps one migration file | **Reversed by the owner 2026-09-16.** This spec first proposed a second migration to spare the owner's local DO a wipe. The owner would rather keep one readable file and clean the DO, which is the governance PRD §5.4 already states and what the `channel_follows` drop did in 2026-09-10. Cost: a `/clean-local` before the next `pnpm dev`, and no upgrade path for storage that already applied `0001_init` |
| 2 | `about_episode_id` is written on the user message and null on the reply | The hint is a property of the question asked, not of the answer given. It also keeps `completeAssistantMessage` untouched |
| 3 | `getChat` is added to the DO facade | `ChatMessagesResponse` carries `{ chat, messages }`, and the DO can list chats or fetch messages but cannot fetch one chat. `requireChat` already exists inside `chats.ts` and only needs exporting |
| 4 | An unknown `chatId` is a `NOT_FOUND` `DomainError` | It is the caller's own DO, so a chat that is not there is not theirs. Matches `requireChat`'s existing behaviour |
| 5 | `appendExchange` takes the hint now, though nothing passes one until M4.2 | Storage and its writer belong together; M4.2 then adds no migration and no column plumbing |

## 3. Contract

### 3.1 Storage

`chat_messages` gains one nullable column in `0001_init.sql`, after `channel_id`:

```sql
about_episode_id TEXT,
```

No `CHECK` and no foreign key: episode ids are cross-DO references validated through Registry methods, never SQLite
foreign keys (PRD §5.2). `MessageRow`, `MESSAGE_COLUMNS` and the `ChatMessage` type carry it; `appendExchange` gains
an optional `aboutEpisodeId`, validated with the `requireEpisodeId` already imported into `chats.ts`, written on the
user row and `NULL` on the assistant row.

### 3.2 The DO facade

One new method beside the existing five:

```ts
getChat(chatId: string): Chat
```

### 3.3 Routes (`apps/api/src/routes/chats.ts`, mounted at `/chats`)

| Route | Body / query | Answers |
|---|---|---|
| `POST /chats` | `CreateChatBody` — `{ title? }` | `201` `ChatResponse` |
| `GET /chats` | — | `200` `ChatsResponse`, most recently updated first |
| `GET /chats/:chatId/messages` | `?limit=` (default 50, max 200) | `200` `ChatMessagesResponse` — `{ chat, messages }`, ascending sequence |

Every route resolves inside the caller's own User DO, so a caller can never read another's chats and no route checks
a role (PRD §2, §9: the API enforces no authorization). `POST /chats` stays open and unchanged by the origin rule of
`chat-origin-scope.md` — the web is the only gate, and it simply never offers creation except from a summary.

### 3.4 The document

`chats` joins the tag list in `apps/api/src/lib/openapi.ts`, and the three operations join `OPERATIONS` in
`apps/api/test/openapi.test.ts`, which asserts declared tags equal used tags and registered operations equal that
list. Each route carries a `describeRoute` block in the shape `routes/preferences.ts` uses.

## 4. Acceptance criteria

1. `userMigrations` holds exactly one migration, and a fresh DO applies it with `about_episode_id` present on
   `chat_messages`.
2. Storage that already applied `0001_init` is not upgraded: it is wiped (`/clean-local`) before the next
   `pnpm dev`. There is no migration to test for this, which is the cost decision 1 accepts.
3. `appendExchange` with an `aboutEpisodeId` stores it on the user message and `NULL` on the assistant message.
4. `appendExchange` with no hint stores `NULL` on both.
5. `appendExchange` with a malformed episode id raises `INVALID_INPUT` and writes nothing.
6. `getMessages` returns `aboutEpisodeId` on every message, `null` where none was given.
7. `getChat` returns the chat; an unknown id raises `NOT_FOUND`.
8. `POST /chats` answers `201` with the created chat; a `title` over 200 characters is `400`.
9. `GET /chats` answers the caller's chats, most recently updated first, and never another caller's.
10. `GET /chats/:chatId/messages` answers `{ chat, messages }` in ascending sequence with sources attached.
11. `limit` is honoured, defaults to 50 and is capped at 200.
12. An unknown `chatId` on either message route is `404`.
13. Two identities creating chats see only their own in `GET /chats`.
14. The OpenAPI document lists exactly the three new operations under one `chats` tag, and `openapi.test.ts` passes
    unchanged but for its `OPERATIONS` entries.

## 5. Out of scope

`POST /chats/:id/messages` and everything behind it — retrieval, the prompt, citations, the four validation branches,
the staleness rule (all M4.2). Every web change, including `Ask` (M4.3). Setting `chats.title`, searching chats and
deleting a chat, which `design-phase.md` §4.9 records as open and no chunk closes. Any change to
`completeAssistantMessage` or `failAssistantMessage`.

## 6. `AGENTS.md` and PRD alignment

PRD §5.2 already carries `about_episode_id` and §7 already carries the three routes, both amended 2026-09-15; this
chunk implements them and changes neither. `AGENTS.md` needs no edit: its retrieval line was updated with the spec,
and the route conventions it states are the ones this chunk follows.
