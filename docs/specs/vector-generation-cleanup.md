# Feature spec — Publication deletes every superseded vector generation

**Status:** IMPLEMENTED 2026-09-17, 391 tests. The live run found a second fault, §2.1; the stray it was run to clear is still in the index and needs one more Retry.
**PRD:** §4.2 (rules 24–26), §6 (retrieval boundaries), §9 (decisions).
**Depends on:** nothing. Independent of `chat-relevance-rerank.md`, though that spec is why this one is worth doing now.
**Occasioned by:** a stray generation found on 2026-09-17 while measuring retrieval for `chat-relevance-rerank.md`.

## 1. Summary

A replace publishes a new vector generation and then deletes the one it replaced. That delete is singular — it
names the generation that was active a moment earlier and nothing else — so a cleanup that misses is never retried,
and its vectors stay in the index forever.

This makes the delete **plural**: at publication, every generation of that episode that is not the newly-active one
goes. Nothing else changes — not the order, not the failure handling, not the schema.

One changed return type, one widened delete. The effect is that cleanup stops being a single attempt and becomes a
retry: any generation a previous publication failed to remove is carried out by the next one.

## 2. What is actually wrong

### 2.1 The stray

Episode `pduZ-bfcKAQ` ("I did it 8 Times!", 105 chunks) was published on 2026-09-15 and replaced on 2026-09-16.
Both generations are still in `media-rag-dev`; the Registry correctly says only the second is active.

Four other episodes were replaced in the same period and show one generation each, so this read as **one cleanup
that failed once** — and that reading was wrong. **Corrected 2026-09-17**, when the fix below ran for real and the
delete failed again, out loud this time:

```
VECTOR_DELETE_ERROR (code = 40007): too many ids in payload; max id count is 100, got 105
```

`DELETE_BATCH` was **1000**, carried over from the upsert ceiling and never measured. Vectorize refuses more than
**100** ids per delete. The episode has 105 chunks; the other four have 49, 69, 57 and 67. Nothing was transient:
**an episode over 100 chunks could never have a superseded generation deleted**, and one under it always could. The
sampling that looked like evidence of a blip was really the observation that only one episode is long.

Two faults, then, and this spec fixes the second by itself only for short episodes:

1. `DELETE_BATCH = 100`, measured (`lib/vectorize.ts`).
2. The delete is plural, so a generation that survived one publication is collected by the next (§3 decision 1).

Either alone leaves a hole. The ceiling alone would still lose any generation whose one cleanup attempt failed for
any other reason; the plural delete alone would retry a delete that is guaranteed to fail again.

### 2.2 Nothing a reader sees is wrong

Retrieval reads the generation out of each vector id and rejects anything that is not the episode's active one
(`lib/chat.ts`). A dead vector cannot be quoted, cited, or reach the model. There is no user-visible symptom, which
is why this survived unnoticed.

### 2.3 What it costs anyway

Vectorize cannot filter on generation — it lives inside the id string and carries no metadata index (PRD §6) — so
rejection happens *after* Vectorize has already chosen what to send. The dead vectors are spent candidates:

| | asked for | usable |
|---|---|---|
| A 50-wide sweep of that channel | 50 | 33 — **17 slots were the dead generation** |
| A real unscoped question, walkthrough of 2026-09-17 | 24 | 22 |

**This is newly worth fixing.** Before `chat-relevance-rerank.md`, retrieval took the top 6 by cosine and depth past
that was decoration. The fix that made a real question work depended on candidate **7 of 24** rising to first. A
shrunken candidate window was harmless a day ago and is not any more.

### 2.4 Why a miss is permanent

Cleanup is singular in both places it happens: `completeAttempt` returns the one generation that was active before
(`processing.ts:216`), and `describeAttempt` offers the one immediately-previous abandoned generation
(`processing.ts:260`). Neither looks further back, so a generation that survives one publication survives all of them.
`discard` swallows its own failures by design — correct for the attempt, since a published episode must not be marked
failed over a cleanup blip, but it means a cleanup that worked and one that did not are indistinguishable afterwards.
**That is what made a deterministic bug look like a rare one for a day**, and it is why §6's detection gap is the
part of this worth returning to.

## 3. Decisions this spec makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | Publication deletes **every** non-active generation, not the previous one (owner's design, 2026-09-17) | Turns a one-shot into a retry with no new machinery: whatever a past publication missed, the next one carries out. The singular delete is the reason a single failure is permanent |
| 2 | **Publish first, delete after — unchanged, and not negotiable** | The harm is wildly asymmetric. Deleting late costs candidate slots and is invisible. Deleting early empties an episode that is on screen and answerable, and since the floor-both decision of `chat-relevance-rerank.md` the reader would be told "Nothing in this episode covers that." about an episode they are reading — a confident, verifiable lie, and the worst failure this product can produce |
| 3 | No new sweep at attempt start | One already exists for the case that needs promptness: a half-written generation from a crashed attempt would otherwise pollute the candidate window for the whole of the new attempt (`ingest.ts:311`). Superseded generations are inert and can wait for the publication. A second sweep would be a second code path doing overlapping work |
| 4 | That existing start-discard stays **singular** | It exists for promptness on the generation most likely to be mid-write, not for hygiene. Decision 1 is the backstop for everything it does not reach |
| 5 | No periodic sweep, no cron | Over-engineering at fifteen episodes. Decision 1 makes the recurring path self-healing; §6 names what that leaves |
| 6 | The delete set comes from the attempt ledger | `episode_ingestion_attempts` already records `generation_id` **and** `staged_chunk_count` for every attempt ever made, so every orphan's ids are exactly reconstructable. No schema change, no new state, and nothing to enumerate from Vectorize |
| 7 | A generation belonging to a `running` attempt is excluded | Structurally unreachable — see §4.4 — but the exclusion is one predicate, and it makes the delete set provably safe from inside this module rather than by appeal to an invariant three files away |
| 8 | Cleanup stays best-effort for the attempt's outcome | Unchanged from today. A failed delete must never fail a published episode; what changes is that it is now retried |
| 9 | The existing stray is cleaned by Owner Retry, not by a script | Retry on an `available` episode opens a `replace` window and leaves the summary and vectors untouched until the replacement succeeds (`routes/channels.ts:519`). Under decision 1 its publication removes both older generations. A one-off cleanup route would exist to be used once |

## 4. Contract

### 4.1 The ledger query

`do/registry/attempts.ts` gains:

```ts
generationsFor(sql, episodeId): { generationId: string; chunkCount: number; running: boolean }[]
```

Every attempt row for the episode carrying both a `generation_id` and a `staged_chunk_count`. An attempt that never
reached staging has no count and therefore wrote no vectors, so it is not in the list at all.

### 4.2 What publication returns

`PublicationResult.previousGeneration: StagedGeneration | null` becomes:

```ts
supersededGenerations: StagedGeneration[]
```

Computed **after** `episodes.publish` has made the staged generation active, as every row from §4.1 that is not the
now-active generation and is not `running`, deduplicated by generation id. The order is oldest first.

**The invariant, stated where it is enforced:** the set is only ever computed in the one place where
`active_vector_generation` is known non-null, because it was just written in the same transaction. "Every generation
that is not the active one" is a dangerous sentence anywhere the active one might be null, and this function is the
only caller.

### 4.3 What the Workflow does

`ingest.ts` replaces its single `if (published.previousGeneration)` with a loop over `supersededGenerations`, one
`discard` each, unchanged in every other respect.

**Each delete needs its own step name.** `step.do` names a step for replay, so a loop reusing `"cleanup"` would
collide. The name is `cleanup:${generationId}`, which is unique by construction and says in the log which generation
a failure belonged to.

### 4.4 Concurrency, and why decision 7 is belt-and-braces

`beginAttempt` answers `{ kind: "running" }` for an existing attempt rather than starting a second
(`processing.ts:61`), and the Registry is a single-threaded Durable Object, so the check and the insert cannot
interleave. **At most one attempt per episode is ever `running`**, and the attempt that is publishing is that one.
No other attempt can therefore be staging a generation while this delete set is computed.

The residual case is a zombie: an instance whose attempt row was reconciled to failed while the instance itself is
still alive. It cannot cost data. A generation can only become active through `completeAttempt`, which refuses a
non-current attempt (`requireCurrent`), so a zombie's vectors can never be serving — they are orphans by definition,
and deleting them is the correct outcome. The worst interleaving leaves *more* orphans behind, which the next
publication collects.

### 4.5 What is logged

`ingest.published` gains `superseded`, the count. Each `discard` already logs its own failure with the generation id.
Counts and ids only; no text ever reaches a log (PRD §1).

## 5. Acceptance criteria

1. A publication with two older generations returns both, oldest first, and deletes both.
2. A publication with no older generation returns an empty list and calls Vectorize not at all.
3. The newly-active generation is never in the returned set.
4. A generation belonging to a `running` attempt is never in the returned set.
5. An attempt that never staged — no `staged_chunk_count` — contributes nothing to the set.
6. Duplicate generation ids across rows yield one entry.
7. Each superseded generation is deleted under its own step name, so two deletes in one instance do not collide.
8. A `discard` that throws leaves the episode published and the attempt `available`, exactly as today.
9. `ingest.published` carries the superseded count.

## 6. Out of scope

- **Cleanup on a failed attempt.** Deletion now happens only on a successful publication, so an episode whose
  re-ingests keep failing keeps its strays until one succeeds. Accepted: the strays are inert, retrieval already
  rejects them, and a failing episode is not producing new ones either.
- **An episode that is never re-ingested** keeps any stray it already has, forever. Decision 5's cron is the answer
  if that ever matters; at this scale it does not.
- **Detection.** This spec makes a missed cleanup self-correcting but still invisible. If the owner wants to *know*,
  the ledger already computes the orphan set from §4.1 and needs only somewhere to say so. Named, not built.
- **The existing stray**, which decision 9 leaves to an Owner Retry of `pduZ-bfcKAQ` once this lands.
