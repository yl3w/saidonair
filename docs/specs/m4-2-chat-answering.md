# Feature spec — M4.2 Chat retrieval and answering

**Implements:** part of `docs/specs/chat-origin-scope.md` §4.8; roadmap `docs/specs/chat-origin-scope-plan.md`.
**Product contract:** `docs/PRD.md` §4.5, §5.2, §6, §7 (route table), §8.
**Written:** 2026-09-16.
**Status:** written, awaiting the owner's go.
**Depends on:** M4.1 (`97247d5`) for `about_episode_id`, `getChat` and the three routes it joins.

## 1. Summary

The path that turns a question into an answer: embed it, retrieve from the channels the caller follows or from one
scoped episode, validate what comes back, ask the model for prose, and store the reply with the chunks that fed it
as its citations. It adds `POST /chats/:id/messages` — the route M4.1 deliberately withheld, because answering runs
inline and a send route without one would store a pending reply nothing completes.

After this chunk chat works end to end over HTTP. No screen calls it; that is M4.3.

## 2. Decisions this spec makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | One over-fetch, sized by scope: keep 8 of 16 scoped, 6 of 24 unscoped | PRD §6, revised 2026-09-16. A loop has no natural bound and costs a round trip per pass; one over-fetch satisfies "fetch additional candidates" with a ceiling. Scoped is **deeper** because one episode is one voice, and over-fetches **less** because its rejections are correlated — the episode is available with an active generation or it is not. Both counts stay under `QUERY_TOP_K_MAX = 50`, the most Vectorize returns with metadata |
| 1b | Sources are deduplicated by episode | Several chunks from one episode are one citation, at its best-scoring start time. A reply cites sources, not passages — and without this, eight scoped chunks would render as eight cards for one episode |
| 2 | One to three valid chunks still answer; zero is a stored reply | A thin answer beats no answer, and the source cards show exactly how thin. Zero never reaches the model, so it can never answer from its weights under the product's citation framing (owner decision 2026-09-16) |
| 3 | A batched **state** lookup, `listEpisodeStates`, not a record one | Corrected 2026-09-16 after reading the code. `episodes.listByEpisodeIds` already batches `EpisodeRecord`s, but `EpisodeRecord.processing` deliberately omits `activeVectorGeneration` so it never crosses to the wire — and that is the field validation turns on. `EpisodeState` carries it, alongside `status` and `channelId`, so validation needs `listStatesByIds` beside the existing `listByEpisodeIds`, exposed on the facade. Twelve singular RPCs would be the wrong shape regardless |
| 4 | `AiClient` gains `answer`, with its own `CHAT_MODEL` and `CHAT_MAX_TOKENS` | Both existing methods hardcode `response_format: json_schema` (`lib/ai.ts:50`) and chat needs prose. A separate constant means tuning chat cannot silently move summarisation, even while both name the same model today |
| 5 | The last ten exchanges go into the prompt | Owner decision 2026-09-16. Chats now begin at a summary with a sticky chip, so an extended conversation about one episode is the common case. §5's successor is history sized by context budget |
| 6 | `prompt_version` on the reply, `CHECK` on `failure_code` deferred to the end of M4 | Owner decision 2026-09-16: the column is added while the wipe is already paid. The deferred `CHECK` follows M3's `outcome_code`, which was constrained only once every value had been produced for real |
| 7 | The 2048-byte filter split is deferred, with its threshold recorded | Thirty `UC…` ids are about 720 bytes; the limit binds past roughly eighty follows. PRD §6 requires it eventually, so it is named in §5 rather than passed over in silence |
| 8 | `eligibleChannelIds` moves to `lib/eligibility.ts` | Chat needs the identical set that `routes/channels.ts:705` computes privately. A second copy would drift, and drift here means answering from a channel the caller does not follow |
| 9 | The three fixed replies are API strings, not web copy | PRD §7 keeps user-facing phrases in the web, but these are **stored message content**, not rendered state. PRD §4.5 already fixes the wording of one of them, so the API is where they live |

## 3. Contract

### 3.1 `lib/chat.ts`

```ts
export async function answer(
  deps: { user: UserStub; registry: RegistryStub; ai: AiClient; vectors: VectorStore },
  input: { chatId: string; message: string; aboutEpisodeId?: string | null },
): Promise<Exchange>
```

Everything it reaches is injected, so every branch tests against the existing fakes with no network.

### 3.2 The five outcomes, in order

| # | Condition | Stored | AI | Vectorize |
|---|---|---|---|---|
| 1 | `aboutEpisodeId` names no catalog episode | **nothing** — `400` before `appendExchange` | no | no |
| 2 | The caller has no eligible follows | the fixed reply below | no | no |
| 3 | The scoped episode's channel is not eligible | the refusal below | no | no |
| 4 | Retrieval returns nothing that validates | the empty reply below | no | **yes** |
| 5 | Otherwise | the model's prose and its sources | yes | yes |

Outcome 1 is the only one that writes nothing; a malformed hint must not leave an orphan question. Outcomes 2–5
store the question first, so a reader always sees what they asked above whatever came back. Outcome 4 differs from
2 and 3 in exactly one observable way — Vectorize was called — and the tests assert that difference.

The three stored replies, verbatim:

- **2:** `Chat requires following at least one approved channel.` (fixed by PRD §4.5)
- **3:** `That episode's channel is no longer one you follow, so it cannot be searched. Remove the episode to ask across everything you follow.`
- **4:** `Nothing in what you follow covers that.`

All three are stored `completed` with no sources. They are content, not status: a reader rereading the conversation
next week sees the same sentence, which is why they cannot live in the web.

### 3.3 Retrieval

Embed the question with the existing `EMBEDDING_MODEL`. Then one query, namespace `shared-catalog`:

- **Unscoped:** `filter: { channelId: { $in: [...eligibleChannelIds] } }`
- **Scoped:** `filter: { episodeId: { $eq: aboutEpisodeId } }`, only after confirming that episode's channel is in
  the same eligible set — the hint narrows and never widens (`chat-origin-scope.md` §4.2)

`topK` is `SCOPED_CANDIDATES = 16` or `UNSCOPED_CANDIDATES = 24`. Validate matches in score order and keep the first
`SCOPED_KEEP = 8` or `UNSCOPED_KEEP = 6` that pass
all three tests: the episode is available, its channel is still eligible, and the generation `parseVectorId`
(`lib/vectorize.ts:85`) reads out of the match's id equals that episode's `activeVectorGeneration` — the vector
id is where the generation lives, and there is no generation metadata index to filter on (PRD §6). Episode facts
come from `listEpisodeStates` in one call.

**A citation is the vector's own metadata, not a second lookup.** `ChunkMetadata` already carries `episodeId`,
`channelId`, `channelTitle`, `title` and `startSec` — exactly the five fields `chat_message_sources` stores — so the
Registry is consulted for *validity* and never for the snapshot. That is also why a later catalog change cannot
rewrite a stored source.

Never send an unfiltered query, and never drop the channel filter to fit a limit.

### 3.4 The model call

`lib/ai.ts` gains, beside the two JSON-mode methods and leaving them untouched:

```ts
answer(prompt: string): Promise<string>
```

running `CHAT_MODEL` with `CHAT_MAX_TOKENS = 1024` and **no** `response_format`. 1024 rather than the 768 first
proposed, because eight chunks is roughly 3,200 tokens of source and an answer ceiling below its evidence is the
wrong constraint. **Hitting the ceiling truncates silently** — the model stops mid-sentence and the reply stores as
completed — which is unhandled here and named in §5. `fakeClient` gains a matching `answer`
honouring the existing `[[throw]]` marker so the failure path is drivable.

`prompts/chat.ts` holds the prompt and `CHAT_PROMPT_VERSION`: the caller's `systemRules`, the last
`HISTORY_EXCHANGES = 10` exchanges oldest first, the surviving chunks each labelled with episode title, channel
title and start time, then the question. **It never mentions citations and never asks for a marker** — code attaches
the sources from the chunks that survived §3.3, so a reply cannot cite an episode that did not feed it.

### 3.5 Schema

`chat_messages` gains one column in `0001_init.sql`, edited in place as decision 1 of M4.1 established:

```sql
prompt_version TEXT,
```

Written on the assistant reply when it completes, null on the question — the mirror of `about_episode_id`.

`failure_code` takes a closed set: `EMBEDDING_FAILED`, `RETRIEVAL_FAILED`, `MODEL_FAILED`, `ANSWER_TIMEOUT`. The
matching `CHECK` is added at the end of M4, not here (decision 6).

**A `/clean-local` scoped to `UserDO` is owed before the next `pnpm dev`.**

### 3.6 The route

`POST /chats/:chatId/messages`, joining the three M4.1 registered. `SendMessageBodySchema` gains
`aboutEpisodeId: Id.nullish()`. Answers `201` `ChatExchangeResponse` — the chat, the question, and the completed or
failed reply. `400` for a blank message or an episode id naming nothing; `404` for a chat that is not the caller's.
`chats` is already a declared tag; the operation joins `OPERATIONS` in `openapi.test.ts`.

### 3.7 Staleness

`CHAT_ANSWER_BUDGET_MS = 120_000`. A `pending` assistant message older than that is reconciled to `failed` with
`ANSWER_TIMEOUT` when `getMessages` reads it — a write inside a read, as PRD §4.2 rule 17 already does for a dead
Workflow instance. Two minutes is generous for an embed, a query and a model call, so a slow but living call is
never killed. Nothing polls; nothing sweeps.

## 4. Acceptance criteria

1. A question with no hint retrieves with the channel filter over exactly the caller's eligible channel ids.
2. A question with a hint retrieves with `{ episodeId: { $eq } }` and never the channel filter.
3. A hint whose episode is unknown to the catalog answers `400` and stores no message at all.
4. A hint whose channel is not eligible stores the §3.2 refusal, with zero AI and zero Vectorize calls.
5. A caller with no eligible follows stores PRD §4.5's sentence, with zero AI and zero Vectorize calls.
6. Retrieval that validates nothing stores the §3.2 empty reply, with zero AI calls and **one** Vectorize call.
7. One valid chunk answers, with exactly that one source.
8. A scoped question queries 16 candidates and keeps at most 8; an unscoped one queries 24 and keeps at most 6.
9. Chunks from one episode collapse to one source, at the best-scoring chunk's start time, so sources never outnumber
   the distinct episodes retrieved.
10. A match whose generation differs from the episode's `activeVectorGeneration` is skipped, and a deeper candidate
    takes its place.
11. A match whose episode is unavailable, or whose channel has become ineligible, is skipped the same way.
12. No query is ever sent without a filter, and none with a `topK` above 50, asserted on the fake across every branch.
13. A reply's sources are exactly its validated chunks after deduplication; its text carries no citation marker; the
    prompt contains no citation instruction.
14. A completed reply records `CHAT_PROMPT_VERSION`; the question's `prompt_version` is null.
15. Ten exchanges of history reach the prompt, oldest first; an eleventh does not.
16. An embedding failure, a retrieval failure and a model failure each fail the reply with their own code and leave
    the question stored `completed`.
17. A `pending` reply older than `CHAT_ANSWER_BUDGET_MS` reads as `failed` with `ANSWER_TIMEOUT`; a younger one
    still reads `pending`.
18. `POST /chats/:chatId/messages` answers `201` with chat, question and reply; a blank message is `400`; another
    caller's chat is `404`.
19. The OpenAPI document gains exactly this one operation under the existing `chats` tag.

## 5. Out of scope

**Three deferrals, all deliberate and all owed later:**

- **Truncation detection.** An answer reaching `CHAT_MAX_TOKENS` stops mid-sentence and stores as completed — the
  same class of silent failure `summary-json-mode` found in JSON mode. Whether the Workers AI binding surfaces a
  finish reason is unverified; if it does, a truncated answer should fail with a code rather than be stored. 1024
  makes it rarer, not impossible.

- **The 2048-byte filter split** of PRD §6. Thirty `UC…` ids are roughly 720 bytes; the limit binds past about
  eighty follows. Until then a single filter is correct, and splitting untested would be worse than not splitting.
- **History sized by context budget** (owner TODO, 2026-09-16). `HISTORY_EXCHANGES = 10` is a constant where the
  right answer is a calculation: fill the tokens left after chunks, preferences and scaffolding with as much recent
  history as fits. Recorded in PRD §11.

Everything web (M4.3). The `CHECK` on `failure_code`, which lands at the end of M4. Setting `chats.title`, searching
chats and deleting a chat, still open from `design-phase.md` §4.9. Per-sentence citation provenance, declined in
PRD §9. Any change to `summarizeSection` or `synthesise`.

## 6. `AGENTS.md` and PRD alignment

PRD §4.5, §6 and §7 already describe this path and need no edit; §5.2 gains `prompt_version` and §11 gains the
history TODO, both with this spec. `AGENTS.md` needs one line in its AI section: `answer` is the prose seam beside
the two JSON-mode methods, and chat's prompt and version live in `prompts/chat.ts`.
