# Implementation plan — Chat retrieval: a cross-encoder decides relevance

**Implements:** `docs/specs/chat-relevance-rerank.md` under `AGENTS.md`.
**Written:** 2026-09-17, against `main` at `759ec93`.
**Status:** COMPLETE 2026-09-17, 387 tests. Steps 1–6 all landed in one pass, uncommitted at time of writing.
Step 3 found **nothing**: all 22 existing chat and route assertions passed untouched, because `fakeClient.rerank`
scores descending by input order and every one of them stays above the floor — the suite asserted behaviour, not
implementation. Step 1 needed one thing the plan did not foresee: `query` is missing from the platform's own
`Ai_Cf_Baai_Bge_Reranker_Base_Input` (its JSDoc is there, the field is not), so the call takes a narrow local type
and a single cast, documented at the seam. The `[[throw]]` marker had to become its own `[[rerank-throw]]`: the
question reaches the answering prompt verbatim, so the shared marker failed the answer too and the fallback under
test could never run.
**Shape:** four code steps plus a docs step, each ending with `pnpm check` green and one commit when the owner asks.
Step 1 is independent; Steps 2–3 need it; Step 4 is web-only and independent of all three. Decisions this plan makes
are marked **plan decision** and stand unless vetoed.
**No migration, no schema change, no wipe.** Nothing here touches Durable Object storage, so no `/clean-local` is
owed and a running `pnpm dev` keeps its data.
**Runtime note:** `AGENTS.md` requires Workers runtime behaviour to be exercised under `wrangler dev`, not only in
Node. Step 5 is that walkthrough, and it is the only step that spends a real model call.

## Definition of complete

Spec §5, all eleven criteria.

### Step 1 — The rerank seam in `lib/ai.ts`  (size: S)

**Files:** `apps/api/src/lib/ai.ts`, `apps/api/test/ai.test.ts`.

- 1.1 `export const RERANK_MODEL = "@cf/baai/bge-reranker-base";` beside `CHAT_MODEL`. **Plan decision:** its own
  constant, for the reason decision 4 of `m4-2-chat-answering.md` gave `CHAT_MODEL` one — tuning retrieval must not
  be able to move answering.
- 1.2 A `Reranker` type, `rerank(query, passages): Promise<number[]>`, added to the `AiClient` intersection beside
  `Embedder`, `Summarizer` and `Answerer`. Do not widen the existing three.
- 1.3 `realClient.rerank`: runs `RERANK_MODEL` with `{ query, contexts: passages.map((text) => ({ text })), top_k:
  passages.length }`. **`top_k` is not optional** — the runtime returns only that many rows, so omitting it leaves
  the tail unscored, which reads downstream as "irrelevant" and would silently reintroduce a worse version of the
  defect this fixes. Map `response` back through each row's `id` (the input index) into an array in input order; a
  missing index is `0`. A non-array `response` throws `RERANK_FAILED: the model returned no scores`.
- 1.4 Short-circuit: no passages answers `[]` without calling the binding (criterion 2).
- 1.5 `fakeClient.rerank`: `1 / (index + 1)` by default, so every existing test keeps cosine order; `0` for a passage
  containing `FAKE_IRRELEVANT = "[[irrelevant]]"`; throws when the **query** carries `FAKE_RERANK_THROW =
  "[[rerank-throw]]"`. **Plan decision:** the marker goes on the query rather than a passage, so a test can fail the
  whole call without making one chunk special — and it is **its own marker, corrected during Step 1**: the question
  is copied verbatim into the answering prompt, so the shared `FAKE_THROW` failed the answer as well and the
  fallback under test could never run.
- 1.6 Tests: order preservation with a shuffled `response`, `top_k` asserted on the fake binding, the empty case, the
  missing-index case, and the throw.

`pnpm check` green.

### Step 2 — Validate everything, then rank  (size: M)

**Files:** `apps/api/src/lib/chat.ts`, `apps/api/test/chat.test.ts`.

- 2.1 `validate` loses its `keep` parameter and returns every candidate that passes the three existing tests
  (available, eligible, generation current), in cosine order. Its doc comment keeps those three and drops the count.
- 2.2 A new step between validation and the prompt: rerank the survivors' `metadata.text`, pair each score with its
  match, sort by score descending, and take `keep`. **Plan decision:** a stable sort on score alone, so an exact tie
  keeps cosine order — the reranker returned identical scores for genuinely duplicated vectors during the probe, and
  arbitrary order between equals would make a test flaky for no reason.
- 2.3 The floor, applied before the cap, to scoped and unscoped alike (spec §4.3, owner decision 2026-09-17).
- 2.4 Decision 6's fallback: a throwing `rerank` is caught, logged as `chat.rerank_failed` with `{ candidates,
  validated }` and no text, and answering proceeds from cosine order and the keep count — today's behaviour exactly.
- 2.5 Outcome 4 when nothing survives the floor, in the wording the scope calls for: `NOTHING_FOUND_REPLY` as it
  stands, or the new `SCOPE_NOTHING_FOUND_REPLY = "Nothing in this episode covers that."` when the question was
  scoped. Both exported beside the three existing fixed replies, for the reason decision 9 of
  `m4-2-chat-answering.md` gave those: stored content, not rendered state. The existing `console.log` gains a third
  `event` value, `chat.below_floor`, beside `chat.no_matches` and `chat.none_validated`, so the three reasons for one
  sentence stay distinguishable in logs.
- 2.6 `chat.reranked` per spec §4.5.
- 2.7 Tests: criteria 3–8. Criterion 4 needs a fake that inverts the order to prove storage follows rerank and not
  cosine; criterion 7 needs a scoped question whose every chunk is below the floor, asserting the **scoped** sentence
  and not the unscoped one — the assertion that would have passed either way if the sentence were shared.

`pnpm check` green.

### Step 3 — The existing suite, honestly re-read  (size: S)

**Files:** `apps/api/test/chat.test.ts`, `apps/api/test/routes-chats.test.ts`.

Step 2 changes what "score order" means in a suite that asserts it in several places. **This step is deliberately
separate**: a step that both changes behaviour and rewrites the assertions about it can pass while proving nothing.

- 3.1 Re-read every assertion about kept counts and source order. Under `fakeClient`'s default descending scores they
  should all still hold; any that does not is either a real behaviour change to record in the spec or a test that was
  asserting the implementation. Say which, in the commit message.
- 3.2 `m4-2-chat-answering.md` §4 criteria 8 and 9 describe counts and score order. Amend their wording there to name
  the reranker, with a pointer to this spec — do not silently leave two specs disagreeing.

`pnpm check` green.

### Step 4 — The label  (size: S)

**Files:** `apps/web/src/lib/copy.ts`, `apps/web/src/components/SourceCards.tsx`, `docs/design.md`.

- 4.1 `SOURCES_LABEL` in `lib/copy.ts`. Proposed "Based on"; the owner's word wins.
- 4.2 Rendered above the cards at the label token, `text-label uppercase text-ink-3`, the same treatment the message
  gutter uses — it is chrome naming a group, not content.
- 4.3 Record the pattern in `docs/design.md` if it is a new one; link to it if it is not. **Do not invent a local
  rule in the component** (`AGENTS.md`).

`pnpm typecheck`/`lint` green (the web has no test runner).

### Step 5 — The walkthrough, and the numbers it produces  (size: S)

Under `pnpm dev`, against the real dev index, as the identity that hit the defect:

- 5.1 The original question, unscoped: no Knowledge Project card, and the Otherworld citations include Ep 42 at
  35:34 — the chunk cosine ranked 6th and never kept (spec §2.2). This is the acceptance test for the whole change.
- 5.2 A question with no coverage: "Nothing in what you follow covers that." with no cards.
- 5.3 The same question scoped: answers, with its timestamps. Then a question the scoped episode plainly does not
  cover: "Nothing in this episode covers that." **This is the step that earns the owner's floor-both decision** — if
  a fair scoped question comes back refused, `RELEVANCE_FLOOR` is wrong and this is where that shows.
- 5.4 Record the `chat.reranked` lines in the spec as the first real-question measurements of the floor.

### Step 6 — The PRD  (docs only)

- 6.1 §6 gains the rerank stage: the model, that "score order" now means rerank score, the floor and that it applies
  to every question, and the 512-token pair caveat beside the existing 480-token chunk cap.
- 6.2 §9 records the decision with §2's measurement — specifically that cosine has no expressible floor, since that
  is the finding a future reader will otherwise re-derive the expensive way.
- 6.3 The stale-generation defect (spec §6) gets its own line in §9 as a known open defect, so it survives this work.

## Order and risk

Step 1 is safe in isolation — nothing calls `rerank` until Step 2. Step 2 is the only step that can change an answer,
and its fallback (2.4) means the worst failure mode is today's behaviour. Step 4 is cosmetic and could ship first or
last. **Step 5 is not optional**: every number in the spec came from a probe worker, and the product path has never
run this model.
