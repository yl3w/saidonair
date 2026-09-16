# Implementation plan — M4.2 Chat retrieval and answering

**Implements:** `docs/specs/m4-2-chat-answering.md` under `AGENTS.md`; parent `docs/specs/chat-origin-scope.md`;
roadmap `docs/specs/chat-origin-scope-plan.md`.
**Written:** 2026-09-16, against `main` at `dda864b`.
**Status:** in progress. **Step 1 complete 2026-09-16 (`21860eb`)**, 348 tests. **Step 2 complete 2026-09-16**, 352
tests. **Step 3 complete 2026-09-16**, 355 tests. **Step 4 complete 2026-09-16**, 367 tests. **Step 5 complete 2026-09-16**, 372 tests. Criterion 16 was
short at first — only `MODEL_FAILED` and `ANSWER_TIMEOUT` had tests — and `EMBEDDING_FAILED` and `RETRIEVAL_FAILED`
were covered the same day, which also met the precondition for the deferred `failure_code` CHECK.
**Shape:** five code steps, each ending with `pnpm check` green and one commit when the owner asks. Steps 1–3 are
independent of each other and all feed Step 4; Step 5 needs Step 4. Nothing here touches the web or the Registry's
write paths. Decisions this plan makes are marked **plan decision** and stand unless vetoed.
**Before starting:** this edits `0001_init.sql` again, so **a `/clean-local` scoped to `UserDO` is owed before the
next `pnpm dev`** — free if dev has not run since M4.1's wipe.

## Definition of complete

Spec §4, all nineteen criteria.

### Step 1 — The prose seam in `lib/ai.ts`  (size: S)

**Files:** `apps/api/src/lib/ai.ts`, `apps/api/test/ai.test.ts`.

- 1.1 `export const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";` and
  `export const CHAT_MAX_TOKENS = 1024;` beside the summary constants. **Plan decision:** a separate constant naming
  the same model today, so tuning chat cannot silently move summarisation. 1024 because a scoped answer draws on up
  to eight chunks — roughly 3,200 tokens of source — and a ceiling below the evidence is the wrong constraint.
  Reaching it is detectable, so 1.5 detects it.
- 1.2 `Answerer` type with `answer(prompt: string): Promise<{ text: string; truncated: boolean }>`, added to the
  `AiClient` intersection beside `Embedder` and `Summarizer`. Do not widen `Summarizer`: its two methods are the JSON-mode pair and stay that way.
- 1.3 `realClient`: `answer` runs `CHAT_MODEL` with `max_tokens: CHAT_MAX_TOKENS` and **no** `response_format`, and
  returns `result.response` when it is a string. A non-string answer is `throw new Error("ANSWER_FAILED: the model
  returned no response")` — the existing `complete` helper cannot be reused, because it exists to pass a schema.
- 1.4 `fakeClient`: `answer` honours `FAKE_THROW` (`throw new Error("ANSWER_FAILED: canned failure")`) and otherwise
  returns a canned prose paragraph that echoes a distinctive slice of the prompt, so a test can assert what reached
  the model. It must **not** honour `FAKE_INVALID`/`FAKE_INVALID_ONCE`: those markers mean "unparseable JSON", and
  prose has nothing to parse. Add `FAKE_TRUNCATE = "[[truncate]]"`, which answers a paragraph ending mid-sentence
  with `truncated: true`, so Step 4's trim is drivable without a real model.
- 1.5 Truncation detection in `realClient`, from the 2026-09-16 probe recorded in spec §3.4. The runtime answers a
  full `chat.completion`, so read `choices[0].finish_reason === "length"` through a **narrow local type** — it is
  absent from `Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Output`, so do not widen the platform types — and fall
  back to `usage.completion_tokens >= CHAT_MAX_TOKENS` when `finish_reason` is missing. **Plan decision:** both
  checks, not one. The declared field alone is a proxy; the undeclared one alone fails open, reporting every answer
  complete if a runtime change drops it, with no compile error to catch that.

**Tests:** `answer` returns the canned prose with `truncated: false`; `FAKE_TRUNCATE` returns `truncated: true`;
`FAKE_THROW` raises; the two JSON-mode methods are unchanged by all of it. Drive `realClient` with a stub binding
for the detection pair: a `finish_reason: "length"` payload, a payload with no `finish_reason` but
`completion_tokens` at the cap, and a clean `stop` payload.

**Done when:** `pnpm check` green.

### Step 2 — Batched episode state  (size: S)

**Files:** `apps/api/src/do/registry/episodes.ts`, `apps/api/src/do/registry.ts`,
`apps/api/test/registry-episodes.test.ts`.

- 2.1 `episodes.ts`: `listStatesByIds(sql, episodeIds: readonly string[]): EpisodeState[]`, built like
  `listByEpisodeIds` at line 333 — `chunk` for the 100-parameter ceiling, `placeholders` for the `IN`, input order
  preserved. It selects the same columns `getState` does. **Plan decision:** ids absent from the catalog are simply
  missing from the result rather than raising; the caller is validating candidates, and a vector whose episode has
  been removed is a rejection, not an error.
- 2.2 `registry.ts` facade: `listEpisodeStates(episodeIds: string[]): EpisodeState[]`, validating ids with
  `requireEpisodeIds` as its neighbours do.

**Tests:** three ids answer three states in the order asked; an unknown id is absent rather than throwing; more than
100 ids still answer (the `chunk` path); `activeVectorGeneration` and `status` come back on each.

**Done when:** `pnpm check` green.

### Step 3 — Eligibility as a shared seam, and the scoped filter  (size: S)

**Files:** `apps/api/src/lib/eligibility.ts` (new), `apps/api/src/routes/channels.ts`,
`apps/api/src/lib/vectorize.ts`, `apps/api/test/vectorize.test.ts`.

- 3.1 `lib/eligibility.ts`: move `eligibleChannelIds` out of `routes/channels.ts:705` unchanged, exported, with a
  doc comment naming PRD §4.3's definition (active follows ∩ approved, paused or not). `routes/channels.ts` imports
  it and its four call sites are untouched. **Plan decision:** a move, not a rewrite — a behaviour change here would
  silently change what four existing routes return.
- 3.2 `lib/vectorize.ts`: widen `QueryOptions.filter` from `{ channelId: { $in: string[] } }` to a union with
  `{ episodeId: { $eq: string } }`. Keep it a union of the two shapes, not an open record, so a query with **no**
  filter cannot be written (PRD §6 forbids an unfiltered query). **Found while building it:** the union does not
  also exclude a literal carrying *both* fields — excess-property checking against a union admits any member's
  property — and the `?: never` arms that would exclude it are not assignable to the platform's index-signature
  filter type, needing a double cast through `unknown`. Not taken: the caller picks one shape from the question's
  scope, so both-at-once is unreachable rather than merely discouraged.
- 3.3 The in-file fake at line 294 filters on `channelId` alone; teach it the episode form too. Without this, every
  scoped-retrieval test would pass against a fake that ignores the filter.

**Tests:** the fake honours an episode filter and a channel filter; a scoped query returns only that episode's
chunks; the union rejects a malformed filter at the type level (a `// @ts-expect-error` line).

**Done when:** `pnpm check` green.

### Step 4 — `lib/chat.ts` and the prompt  (size: L)

**Files:** `apps/api/src/lib/chat.ts` (new), `apps/api/src/prompts/chat.ts` (new),
`apps/api/migrations/user/0001_init.sql`, `apps/api/src/do/user/chats.ts`, `apps/api/src/do/user/types.ts`,
`apps/api/src/do/user.ts`, `packages/shared/src/index.ts`, `apps/api/test/chat.test.ts` (new).

- 4.1 `0001_init.sql`: add `prompt_version TEXT,` and `truncated INTEGER,` to `chat_messages` after
  `about_episode_id`, with a comment naming spec §3.5. Plumb both exactly as M4.1 plumbed `about_episode_id`:
  `MessageRow`, `MESSAGE_COLUMNS`, the `toMessage` mapper, the DO `ChatMessage` type, and `ChatMessageSchema` in
  `packages/shared` (`Id` is wrong for either — `z.string().nullable()` for the version, `z.boolean().nullable()`
  for `truncated`, mapped from `0`/`1`/null since SQLite has no boolean).
- 4.2 `completeAssistantMessage` takes `promptVersion: string` and `truncated: boolean` and writes both;
  `failAssistantMessage` leaves both null. Both already exist and are tested; extend rather than replace.
- 4.2b `trimToSentence(text: string): string` as a pure local function in `lib/chat.ts`: cut at the last `.`, `?`
  or `!` that ends a sentence, dropping the dangling fragment. **If there is no boundary, return the text
  unchanged** — a fragment beats an empty reply, and this is the case that would otherwise blank an answer. Applied
  only when `truncated` is true; a clean answer is never rewritten.
- 4.3 `prompts/chat.ts`: `export const CHAT_PROMPT_VERSION = "2026-09-16";` and
  `chatPrompt({ systemRules, history, chunks, question }): string`. Order: the caller's rules if any, then the last
  ten exchanges oldest first, then the chunks each headed by episode title, channel title and a `mm:ss` start, then
  the question. **It names no citation and asks for no marker** — spec §3.4. A pure function of its input, so its
  shape is testable without a model.
- 4.4 `lib/chat.ts`: `answer(deps, input)` per spec §3.1, as a flat sequence of the five outcomes of spec §3.2 in
  order, each returning early. **Plan decision:** one function, no strategy objects — five branches read better as
  five `if`s than as a dispatch table, and the order is the contract.
- 4.5 The retrieval half: `SCOPED_KEEP = 8`, `SCOPED_CANDIDATES = 16`, `UNSCOPED_KEEP = 6`,
  `UNSCOPED_CANDIDATES = 24`, `HISTORY_EXCHANGES = 10` as exported constants, chosen by whether the message carries
  a hint (PRD §6, 2026-09-16). **Plan decision:** pick the pair once at the top of the retrieval half and pass it
  down, rather than branching on `aboutEpisodeId` in three places. Assert at module load that neither candidate
  count exceeds `QUERY_TOP_K_MAX` — 50 is Vectorize's ceiling with metadata, and a future edit that raises one past
  it should fail loudly rather than at the first real question.
  Embed, query, then validate matches in score order against `listEpisodeStates` — available, channel
  still in the eligible set, and the generation matches. `parseVectorId` returns `{ episodeId, generationId, index }
  **or null** (`lib/vectorize.ts:85`), so an id that does not parse is a rejection like any other, never a throw and
  never a non-null assertion — the check is `parsed !== null && parsed.generationId === state.activeVectorGeneration`.
  Keep the first `KEEP` that pass. Sources come from `match.metadata`, never a second lookup (spec §3.3), and are
  then **deduplicated by episode**: several chunks from one episode become one source at the best-scoring chunk's
  `startSec`. Deduplicate after validation and before storing, so the count the reader sees is episodes, not
  passages — without it, eight scoped chunks would render as eight cards for a single episode.
- 4.6 Failures: wrap the embed, the query and the model call so each becomes `failAssistantMessage` with
  `EMBEDDING_FAILED`, `RETRIEVAL_FAILED` or `MODEL_FAILED`. The question stays `completed` in every case. **A
  truncated answer is not one of these** — it completes with `truncated = 1` and its trimmed text (spec decision
  1c). No `CHECK` on `failure_code` yet — spec decision 6 puts it at the end of M4.

**Tests:** spec §4.1–§4.16 in `chat.test.ts`, driving the AI and Vectorize fakes. The ones that matter most assert a
negative: outcomes 2 and 3 record **zero** AI and **zero** Vectorize calls, outcome 4 zero AI and exactly one
Vectorize call. Also the generation rejection promoting a deeper candidate, the scoped and unscoped pairs reaching
the fake as 16 and 24, eight chunks from one episode collapsing to one source, and that no query is ever sent
unfiltered.

**Done when:** `pnpm check` green.

### Step 5 — The route and staleness  (size: M)

**Files:** `apps/api/src/routes/chats.ts`, `apps/api/src/do/user/chats.ts`, `apps/api/src/do/user.ts`,
`packages/shared/src/index.ts`, `apps/api/test/openapi.test.ts`, `apps/api/test/routes-chats.test.ts`,
`apps/api/test/user-chats.test.ts`.

- 5.1 `SendMessageBodySchema` gains `aboutEpisodeId: Id.nullish()`. The existing `message` rule — trimmed, non-blank
  — is unchanged.
- 5.2 `routes/chats.ts`: `POST /:chatId/messages`, `validate("json", SendMessageBodySchema)`, calling `chat.answer`
  and answering `201` `ChatExchangeResponse` with the same `toMessage` mapper the `GET` already uses. Its
  `describeRoute` says the reply is complete in this response and names the three stored refusals.
- 5.3 `CHAT_ANSWER_BUDGET_MS = 120_000` in `do/user/chats.ts`. `getMessages` reconciles before it reads: a `pending`
  assistant row older than the budget becomes `failed` with `ANSWER_TIMEOUT`. **Plan decision:** this makes
  `getMessages` a write, so `do/user.ts` must wrap it in `#transaction` as `appendExchange` is — a read that writes
  is still a write, and the existing wrapper is why that is cheap to get right.
- 5.4 `openapi.test.ts`: add `"post /chats/{chatId}/messages"` to `OPERATIONS`. The `chats` tag already exists.

**Tests:** spec §4.17–§4.19. A round trip answering `201` with chat, question and reply; a blank message `400`; an
unknown episode hint `400` with nothing stored; another caller's chat `404`. For staleness, insert a pending reply
with an old `updated_at` and assert `getMessages` returns it `failed`, and that a fresh one stays `pending`.

**Done when:** `pnpm check` green.

## Walkthrough record

No screen calls any of this, so there is no browser walkthrough. The `wrangler dev` equivalent is a live
`POST /chats/:id/messages` against a real followed channel with a real summary: it must answer with sources whose
`youtu.be` links land on the right timestamps.

**Run 2026-09-16, partially.** Under `wrangler dev --env dev` the route answered `201` with the stored question and
a finished reply in one response, `promptVersion` set on the reply and null on the question, `truncated` false — so
the route, the inline answering, the two new columns and the response shape are verified against workerd. **The
answer-with-sources path was not exercised**: the dev Registry holds no follows for the owner, so every question
takes the no-follows branch. Completing it needs a channel added, approved and ingested in dev — minutes of work
that spends a DownSub credit and real neurons — and is owed before M4 is declared complete, not before this chunk
is.
