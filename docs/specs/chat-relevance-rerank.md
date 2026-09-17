# Feature spec — Chat retrieval: a cross-encoder decides relevance

**Status:** written 2026-09-17, awaiting the owner's go.
**PRD:** §6 (retrieval boundaries), §4.5 (chats), §9 (decisions).
**Depends on:** M4 complete (`lib/chat.ts`, `lib/ai.ts`, `chat_message_sources`). Nothing else.
**Occasioned by:** a live defect, 2026-09-17 — an unscoped question about a true-crime episode cited
`What 12 Years of Failure Taught Steve Jobs About Success`. Reproduced, measured, and root-caused before this
spec was written; §2 is the measurement, not an argument.

## 1. Summary

Retrieval currently ranks by the embedding model's cosine score and keeps a fixed count — 6 unscoped, 8 scoped —
whatever those chunks turn out to be about. Nothing in the path ever asks whether a chunk bears on the question.
This adds the stage that does: the validated candidates are rescored by a **cross-encoder**,
`@cf/baai/bge-reranker-base`, and a question keeps only the chunks above a relevance floor, still capped at the
existing count.

One new Workers AI call per question. No schema change. No prompt change. The web changes one label.

## 2. What the defect measured

The question, its corpus and its filter were replayed against the live dev index on 2026-09-17. The probe
reproduced the stored citations exactly — ranks 0–5 were the six stored sources, in order — so everything below is
the live system, not a model of it.

### 2.1 Cosine score carries no usable signal here

| Question | Corpus coverage | Top cosine | Spread over 24 candidates |
|---|---|---|---|
| "what happened to eilish poe" | two episodes cover it | 0.68088 | 0.070 |
| "what did they say about quantum computing" | **none at all** | **0.71688** | 0.058 |
| "how should I think about compounding…" | partial | 0.74199 | 0.040 |

**A question with zero coverage scores higher than one the corpus answers.** The absolute value tracks how abstract
and wordy the question is, not whether an answer exists, so **no absolute floor is expressible**. The
mis-cited chunk scored 0.64794, *above* three genuinely on-topic chunks, so no relative floor separates it either:
`0.95 × top` keeps it, and `0.96 × top` keeps two chunks and discards the one the answer's best detail came from.
The consecutive gaps around the boundary are 0.0004, 0.0027, 0.0027 — there is no cliff to cut at.

**Tried and rejected:** `bge-base-en-v1.5` documents an instruction prefix for retrieval queries, and `lib/ai.ts`
embeds questions and chunks identically without one. Adding it makes this case **worse** — top drops to 0.599 and
the mis-cited chunk rises from rank 4 to rank 3. The embedder is not misconfigured; a bi-encoder is the wrong
instrument for this judgement.

### 2.2 A cross-encoder separates all three cases

`@cf/baai/bge-reranker-base` scores the (question, passage) pair jointly instead of comparing two independently
made embeddings. Same candidates, same order in:

| Question | Top rerank | Chunks ≥ 0.01 (of 24) |
|---|---|---|
| "what happened to eilish poe" | 0.53336 | **6** |
| "what did they say about quantum computing" | 0.00610 | **0** |
| "how should I think about compounding…" | 0.05915 | **1** |

**The mis-cited chunk falls from cosine rank 4 to rerank rank 22 of 24, scoring 0.00011** — four orders of
magnitude below the top. Two orders of magnitude separate a question the corpus answers from one it does not, where
cosine had them inverted.

It also improves the answer, not merely the citations: the highest-scoring chunk in the corpus for that question
(Ep 42 at 35:34, rerank 0.533) sat at **cosine rank 6** and was therefore never kept. The reader's best evidence was
being discarded by `UNSCOPED_KEEP = 6` every time.

## 3. Decisions this spec makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | A cross-encoder rerank stage, not an LLM relevance pass | Both were on the table on 2026-09-17. The reranker is purpose-built, one cheap classification call rather than a generation call, needs no prompt to maintain or version, and its scores are comparable across questions — §2.2 measures that. An LLM pass would need `PROMPT_VERSION`, JSON-mode handling, and its own failure mode, to do worse |
| 2 | A floor on the rerank score, **not** on cosine | §2.1: cosine is not a relevance measure. The floor this spec adds is the first one the product can defend |
| 3 | `RELEVANCE_FLOOR = 0.01`, both modes | Measured on three questions, which is three, so §4.5 logs what real questions score and the constant is tuned from that |
| 4 | **The floor applies to scoped questions too** (owner decision 2026-09-17, choosing against this spec's first draft) | The draft exempted scoped questions because a weak citation from the episode on screen misleads nobody. The owner's reading is the stronger one: a reader who asks a question the episode does not answer is owed that sentence, not eight timestamps offered as if they bore on it. It costs a fourth stored reply, §4.4 |
| 5 | Validation runs over every candidate, then reranking | Validation stops at the keep count today, which would hand the reranker an already-truncated list and waste the over-fetch §2.2 shows is load-bearing |
| 6 | A rerank failure falls back to cosine order and logs | A ranking refinement must never cost a reader their answer. Precedent: `ingest.related_failed` logs and continues |
| 7 | Zero survivors is outcome 4, in two wordings | "Nothing in what you follow covers that." is already the honest sentence, and §2.2 shows the floor reaching it for a question with no coverage — the outcome the product could not previously detect. A scoped miss needs its own sentence because that one names the wrong thing (§4.4) |
| 8 | The web labels the cards | They have always been *what the model was given*, presented as *what the answer rests on*. Reranking narrows the gap; it does not close it, because the model still chooses what to use |

## 4. Contract

### 4.1 `lib/ai.ts`

```ts
export const RERANK_MODEL = "@cf/baai/bge-reranker-base";

rerank(query: string, passages: readonly string[]): Promise<number[]>
```

One score per passage, **in the order given**. The runtime answers `{ response: [{ id, score }] }` where `id` is the
input index, and it returns only `top_k` rows — so `top_k` is always `passages.length`, or the tail comes back
unscored and silently reads as irrelevant. An empty `passages` answers `[]` without calling the model.

**A caveat to record, not to fix:** the model's sequence limit is 512 tokens for the pair, and PRD §6 caps a chunk at
480 for the embedder. A long chunk's tail is therefore truncated out of the pair. This is the same silent truncation
the chunk cap already exists to bound, and the scores in §2.2 were measured under it.

`fakeClient` gains a matching `rerank`: scores descending by input order, so existing tests see cosine order
preserved; a passage containing `FAKE_IRRELEVANT = "[[irrelevant]]"` scores `0`, so the floor is drivable; and the
existing `[[throw]]` marker in the **query** throws, so decision 6's fallback is drivable.

### 4.2 `lib/chat.ts`, retrieval order

Today: embed → query → validate, stopping at the keep count → prompt.
After: embed → query → **validate every candidate** → **rerank the survivors** → **order by rerank score**
→ **drop below the floor** → **take the keep count** → prompt.

`validate` loses its `keep` parameter. The keep counts and candidate counts are unchanged: `SCOPED_KEEP = 8` from
`SCOPED_CANDIDATES = 16`, `UNSCOPED_KEEP = 6` from `UNSCOPED_CANDIDATES = 24`. What changes is that the count is now
a **cap** rather than a quota — a question may answer from fewer, and §2.2's middle row answers from none.

`chat_message_sources` stores the kept chunks in **rerank order**, which is what PRD §6's "score order" now means.

### 4.3 The constant

```ts
export const RELEVANCE_FLOOR = 0.01;
```

Applied to every question, scoped or not. Chosen from §2.2: it keeps six on-topic chunks for a question the corpus
answers, one for a question it partly answers, and none for a question it does not.

**A floor over one episode is the riskier half.** An unscoped question that keeps nothing has been asked of a
corpus that genuinely does not cover it; a scoped one has been asked of a single episode, where sixteen candidates
are all the evidence there is and a floor set too high turns a working screen into a refusal. §4.5's log is what
answers that from real use, and `RELEVANCE_FLOOR` is one constant to move if it does.

### 4.4 The outcomes

The five outcomes of `m4-2-chat-answering.md` §3.2 keep their number, their order and their conditions. Outcome 4
gains a third way to be reached — every candidate scored below the floor — and, because the floor now applies to a
scoped question, a second sentence:

- **unscoped:** `Nothing in what you follow covers that.` (unchanged)
- **scoped:** `Nothing in this episode covers that.` (new)

Both are stored `completed` with no sources, like the three before them, and for the same reason: a reader rereading
the conversation next week must see the same sentence, so it is content and belongs to the API, not to the web
(`m4-2-chat-answering.md` decision 9). The scoped sentence is new wording and not fixed by the PRD; §4.5 of the PRD
fixes only the no-follows one.

Outcome 4's log line already distinguishes "Vectorize returned nothing" from "nothing validated"; it gains a third
value.

### 4.5 What is logged

On every answered question, counts and scores only — never question text, never transcript text (PRD §1):

```ts
console.log({
  event: "chat.reranked",
  scoped: scope !== null,
  candidates, validated, kept,
  topScore, keptFloor,      // rounded to four places
  belowFloor,               // count dropped by the floor
});
```

This is what turns `RELEVANCE_FLOOR` from a constant chosen on three questions into one measured on real ones.

### 4.6 The web

`SourceCards` gains a label above the cards, its copy in `lib/copy.ts` under PRD §7. Proposed: **"Based on"**.
`docs/design.md` governs the final word and the type token; nothing else about the cards changes.

## 5. Acceptance criteria

1. `rerank` returns one score per passage in input order, and requests `top_k` equal to the passage count.
2. `rerank` with no passages returns `[]` and calls no model.
3. An unscoped question reranks every validated candidate, not the first `UNSCOPED_KEEP` of them.
4. Sources are stored in rerank order, which may differ from cosine order — asserted with a fake that inverts them.
5. A chunk scoring below `RELEVANCE_FLOOR` is not kept, is not in the prompt, and is not stored as a source.
6. When every candidate is below the floor, the reply is the outcome-4 sentence, with zero calls to `answer`.
7. A scoped question is floored like an unscoped one, and when nothing clears it the reply is
   "Nothing in this episode covers that." — not the unscoped sentence — with zero calls to `answer`.
8. A rerank failure answers from cosine order and the keep count, logs `chat.rerank_failed`, and never fails the reply.
9. `chat.reranked` carries counts and scores and no text.
10. The five outcomes of `m4-2-chat-answering.md` §3.2 keep their order, their conditions and their wording.
11. The reading screen's source cards render under the label; no other card behaviour changes.

## 5a. What the product path measured

Walked through under `wrangler dev` against the dev index on 2026-09-17, as the identity that hit the defect. These
are `chat.reranked` lines from the real path, not the probe:

| Question | scoped | validated | top | ≥ floor | weakest kept |
|---|---|---|---|---|---|
| "what happened to eilish poe" | no | 24 | 0.5334 | 6 | 0.0113 |
| "what did they say about quantum computing" | no | 22 | 0.0061 | **0** | — |
| "what happened to eilish poe" (Ep 41) | yes | 16 | 0.1991 | 3 | 0.0302 |
| "what is the best way to train for a marathon" (Ep 41) | yes | 16 | 0.0011 | **0** | — |

The defect is gone: six Otherworld citations and no Knowledge Project card, with Ep 42 at 35:34 — the chunk cosine
ranked 6th and never kept — now **first**. The answer changed with it, from "the excerpts do not explicitly state
what happened to Eilish Poe" to the attack, the ten surgeries and the sentence handed down. That was never a
prompt problem.

**The margin is the thing to watch.** A question with no coverage topped out at 0.0061 and the weakest chunk kept
for a question with coverage scored 0.0113 — a factor of two, not of ten, and `RELEVANCE_FLOOR` sits between them
with little room either way. The scoped pair is wider (0.0011 against 0.0302). Nothing here is wrong; it is the
reason §4.5 logs every question rather than trusting four.

**Two second-order findings**, both from the same lines:

- The scoped question kept **3 of 16** where it would have kept 8. The floor bites hardest in the mode that has the
  least to draw on, exactly as §4.3 warned, and the owner's floor-both decision is what makes that honest rather
  than padded.
- `validated` reads 22 of 24 for the Knowledge Project question and 24 of 24 for the Otherworld one. The missing two
  are the stale vector generation below: dead candidates, paid for in the over-fetch, rejected after the fact.

## 6. Out of scope

- **The stale vector generation found by the same probe.** Episode `pduZ-bfcKAQ` has two generations live in
  `media-rag-dev`; the superseded one takes **17 of 50** candidate slots in its channel. Validation rejects them
  correctly, so no citation is wrong, but the over-fetch this spec leans on is being spent on dead vectors.
  `ingest.ts:357` does discard the previous generation after a replace and `discard` swallows every failure by
  design, so once a cleanup misses, nothing retries it and nothing detects it. **A separate defect with its own
  fix**, named here so it is not lost.
- **Tuning `RELEVANCE_FLOOR`.** §4.5 makes it measurable; measuring it is a later pass over real questions.
