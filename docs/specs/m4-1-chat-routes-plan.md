# Implementation plan — M4.1 Chat routes

**Implements:** `docs/specs/m4-1-chat-routes.md` under `AGENTS.md`; parent `docs/specs/chat-origin-scope.md`; roadmap
`docs/specs/chat-origin-scope-plan.md`.
**Written:** 2026-09-15, against `main` at `455c9e8`.
**Status:** complete 2026-09-16 on `main` (committed as `97247d5`). All four steps landed, `pnpm check` green, 39 test files and
343 tests (38 and 334 before). No new dependencies. Step 3.3 ran under `wrangler dev --env dev`: the three operations
serve, and a create/list/messages round trip answered 201/200/200 with an unknown chat 404.
**Amended 2026-09-16**, after the owner reversed spec decision 1: one migration file, not two. Step 1 was rebuilt
against `0001_init.sql` and the upgrade-path test deleted with the migration it tested (344 tests became 343).
**A `/clean-local` is owed before the next `pnpm dev`** — the owner's storage has `0001_init` recorded as applied and
will not re-run it, so `about_episode_id` is absent there until the DO is wiped.
**Shape:** three code steps, each ending with `pnpm check` green and one commit when the owner asks. Step 2 needs
Step 1's `getChat` and the `aboutEpisodeId` type; Step 3 needs Step 2's routes. Nothing here touches the web, the
Registry, a Workflow or `0001_init.sql`. Decisions this plan makes are marked **plan decision** and stand unless
vetoed.
**Before starting:** read spec §2 — decision 1 puts `about_episode_id` in `0001_init.sql` in place, the governance
PRD §5.4 describes, and accepts a `/clean-local` as the price of one migration file.

## Definition of complete

Spec §4, all fourteen criteria.

### Step 0 — The receipts audit  (size: S, no code)

Roadmap decision 5. Confirm what M4's "unread receipts" still owes before building anything.

- 0.1 Read `apps/api/src/routes/episodes.ts` and `apps/api/src/do/user/reads.ts` against PRD §4.4 and §7's route
  table: `POST`/`DELETE /channels/:id/episodes/:episodeId/read`, `read` on an eligible caller's episode, `unread=true`
  on `/digest`, and `unreadCount` on `/follows`.
- 0.2 Report to the owner: complete, or a named gap. **If complete**, the only change owed is PRD §10's M4 line,
  which still lists receipts as unbuilt. Do not fix it silently — it is the owner's call.

**Done when:** the owner has the finding. No commit.

### Step 1 — The scope column and `getChat`  (size: M)

**Files:** `apps/api/migrations/user/0001_init.sql`, `apps/api/src/do/user/chats.ts`,
`apps/api/src/do/user/types.ts`, `apps/api/src/do/user.ts`, `apps/api/test/user-chats.test.ts`.

- 1.1 `0001_init.sql`: add `about_episode_id TEXT,` to `chat_messages` after `channel_id`, with a comment naming
  `docs/PRD.md` §4.5 and why there is no `CHECK` and no foreign key (cross-DO reference, validated through Registry
  methods). `migrations/user/index.ts` does not change: the list stays one entry.
- 1.2 Nothing in `user-migrations.test.ts` changes either — it already asserts one version, and the table shape it
  checks is unaffected by a new column. **Do not add an upgrade-path test:** an edited migration has no upgrade path,
  and storage that already applied it is wiped instead.
- 1.3 `chats.ts`: `MessageRow` gains `about_episode_id: string | null`; `MESSAGE_COLUMNS` gains `about_episode_id`
  (it is a template literal listing columns for both `SELECT` and the row mapper — add it in the same position
  everywhere); the row mapper maps it to `aboutEpisodeId`.
- 1.4 `chats.ts`: `appendExchange(sql, chatId, content, now, aboutEpisodeId?)`. **Plan decision:** the parameter goes
  last and stays optional, so the existing four-argument call in `do/user.ts` keeps compiling and the diff stays
  honest about what changed. When present, validate with the `requireEpisodeId` already imported at the top of the
  file; when absent, write `NULL`. The user `INSERT` writes it, the assistant `INSERT` writes `NULL` — both column
  lists gain `about_episode_id` explicitly rather than relying on position.
- 1.5 `chats.ts`: export `getChat(sql, chatId): Chat` as a thin wrapper over the existing private `requireChat`, so
  the `NOT_FOUND` behaviour is defined in exactly one place.
- 1.6 `types.ts`: `ChatMessage` gains `aboutEpisodeId: string | null`.
- 1.7 `do/user.ts`: `getChat(chatId: string): Chat` beside the other five chat methods, and `appendExchange` gains
  the optional `aboutEpisodeId` pass-through. Both follow the file's existing doc-comment style.

**Tests:** spec §4.1 and §4.3–4.7, all in `user-chats.test.ts`: a scoped exchange, an unscoped one, a malformed id
writing nothing, `getMessages` carrying the field, and `getChat` on a known and an unknown id. §4.2 has nothing to
test — it is the wipe, not a code path.

**Done when:** `pnpm check` green.

### Step 2 — The three routes  (size: M)

**Files:** `packages/shared/src/index.ts`, `apps/api/src/routes/chats.ts` (new), `apps/api/src/index.ts`,
`apps/api/test/routes-chats.test.ts` (new).

- 2.1 `shared`: `ChatMessageSchema` gains `aboutEpisodeId: Id.nullable().describe(...)`, describing it as the episode
  this question was scoped to and null for a global one, citing PRD §4.5. It is a response field, so no body schema
  changes here — `SendMessageBodySchema` is M4.2's to extend.
- 2.2 `routes/chats.ts`: one `new Hono<AppEnv>()` chained exactly as `routes/preferences.ts` does — same imports
  (`describeRoute`, `errorResponses`, `jsonResponse`, `validate`), same file-head doc comment naming
  `docs/PRD.md` §4.5 and `docs/specs/chat-origin-scope.md`, and one `tags: ["chats"]` per route.
  - `POST /` — `validate("json", CreateChatBodySchema)`, `c.var.user.createChat(body.title)`, answers
    `c.json<ChatResponse>({ chat }, 201)`. Its description says the API accepts creation from anywhere while the web
    offers it only from a summary, and points at `chat-origin-scope.md`.
  - `GET /` — `c.var.user.listChats()`, answers `ChatsResponse`.
  - `GET /:chatId/messages` — `validate("query", LimitQuerySchema)`, the schema `routes/channels.ts:403` already
    uses (`packages/shared/src/index.ts:1065`, "a positive integer; the default and the ceiling belong to the
    callee"). Nothing new is needed for the default or the cap: `getMessages` already owns them as
    `DEFAULT_MESSAGE_LIMIT = 50` and `MAX_MESSAGE_LIMIT = 200` in `do/user/chats.ts`, so the route passes `limit`
    straight through. Calls `getChat` then `getMessages`, answers `ChatMessagesResponse`.
- 2.3 `apps/api/src/index.ts`: import `chatRoutes` and add `app.route("/chats", chatRoutes)` after the `/digest`
  line, keeping the existing order of the block.
- 2.4 Confirm no error mapping is needed: `requireChat` already raises a `DomainError`, and the app's error
  middleware maps `NOT_FOUND` to 404. If it does not, that is a finding to report, not a fix to improvise.

**Tests:** spec §4.8–4.13 in `routes-chats.test.ts`, following `routes-preferences.test.ts` for the harness — create
returns 201 and the chat; a 201-character title is 400; list ordering by `updatedAt`; messages return `{ chat,
messages }` ascending with sources; `limit` default, honoured value and cap; unknown `chatId` 404 on the message
route; and two identities seeing only their own chats.

**Done when:** `pnpm check` green.

### Step 3 — The document  (size: S)

**Files:** `apps/api/src/lib/openapi.ts`, `apps/api/test/openapi.test.ts`.

- 3.1 `lib/openapi.ts`: add `{ name: "chats", description: … }` to the `tags` array, in the position matching the
  route mount order. The description says these are the caller's own conversations and that every chat searches the
  channels they currently follow.
- 3.2 `openapi.test.ts`: add `"post /chats"`, `"get /chats"` and `"get /chats/{chatId}/messages"` to `OPERATIONS`,
  in the same position the routes mount. The test asserts registered operations equal this list and declared tags
  equal used tags, so both edits are required together or it fails.
- 3.3 Run the doc locally under `wrangler dev` and open `/docs` to confirm the three operations render with their
  schemas — CLAUDE.md requires Workers runtime behaviour to be exercised under `wrangler dev`, not only in Node.

**Tests:** spec §4.14.

**Done when:** `pnpm check` green, and the three operations are visible at `/docs`.

## Walkthrough record

Nothing here is reachable from a screen, so there is no browser walkthrough. The `/docs` check in Step 3.3 is this
chunk's equivalent, and M4.3 carries the click-through for the feature as a whole.
