# Implementation plan — Publication deletes every superseded vector generation

**Implements:** `docs/specs/vector-generation-cleanup.md` under `AGENTS.md`.
**Written:** 2026-09-17, against `main` at `759ec93` plus the uncommitted `chat-relevance-rerank` work.
**Status:** Steps 1–4 COMPLETE 2026-09-17, 390 tests. Step 5 is owner-triggered and not yet run.

**Step 2.4 was wrong, and the correction is the interesting part of this change.** The plan called the two existing
assertions a mechanical rename. One of them could not be renamed: it seeded an `available` episode, which
`seedEpisode` gives an `active_vector_generation` and **no attempt row**, and the superseded set is read from that
ledger. That fixture state is one the product cannot produce — `beginAttempt` mints a generation and inserts its row
in the same call — so three tests were asserting cleanup against a shape that only exists in the test suite. They now
run a real first publication instead, which also made two of them stronger: "preserving first availability" is
asserted against a first publication that actually happened rather than a seeded `1`.

Changing `seedEpisode` itself to insert the row would have been the deeper fix and was rejected as too wide: about
ninety call sites, several asserting `latestAttempt: null` on a seeded episode.
**Shape:** three code steps and a docs step, each ending with `pnpm check` green. Steps 1–2 are one change split at
the module boundary and land together; Step 3 is the Workflow side; Step 4 is docs. Decisions this plan makes are
marked **plan decision** and stand unless vetoed.
**No migration, no schema change, no wipe.** Every field this needs is already in
`episode_ingestion_attempts` (§4.1 of the spec), so `pnpm dev` keeps its data and no `/clean-local` is owed.
**One deliberate deletion of live data at the end** — Step 5 retries one episode, which deletes two superseded
generations from the dev Vectorize index. That is the whole point, and it runs only on the owner's word.

## Definition of complete

Spec §5, all nine criteria.

### Step 1 — The ledger query  (size: S)

**Files:** `apps/api/src/do/registry/attempts.ts`, `apps/api/test/registry-attempts.test.ts`.

- 1.1 `generationsFor(sql, episodeId)`, beside the existing `previousWithGeneration`. One statement:
  `WHERE episode_id = ? AND generation_id IS NOT NULL AND staged_chunk_count IS NOT NULL ORDER BY created_at ASC,
  attempt_id ASC`, projecting `{ generationId, chunkCount, running: status === "running" }`.
- 1.2 **Plan decision:** ascending, so the caller's list is oldest first and the deletes replay in a stable order.
  `previousWithGeneration` is descending because it wants the newest; these are different questions and both stay.
- 1.3 **Plan decision:** the `staged_chunk_count IS NOT NULL` filter lives in SQL rather than in the caller. An
  attempt that never staged wrote no vectors, so it is not an orphan that was missed — it is not an orphan at all,
  and a null count downstream could only become a zero-length id list or a crash.
- 1.4 Tests: rows in insert order; an unstaged attempt absent; a `running` row present and flagged.

### Step 2 — What publication returns  (size: M)

**Files:** `apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry/processing.ts`,
`apps/api/test/registry-attempts.test.ts`.

- 2.1 `PublicationResult.previousGeneration: StagedGeneration | null` → `supersededGenerations: StagedGeneration[]`.
  **Replace it, do not add beside it:** two fields answering almost the same question is how a caller ends up
  deleting one generation and believing it deleted all of them.
- 2.2 In `completeAttempt`, delete the `previous` computation that reads `episode.activeVectorGeneration` before
  publishing. Compute the set **after** `episodes.publish`, from `generationsFor`, excluding the now-active
  generation and any `running` row, deduplicated by generation id.
- 2.3 The invariant of spec §4.2 goes in the doc comment, at the only place it can be enforced: the set is computed
  exactly once, in the one transaction that has just written a non-null active generation. Say why, not just what —
  "every generation that is not the active one" is a dangerous sentence wherever the active one might be null.
- 2.4 Update the two existing assertions (`registry-attempts.test.ts:154` and `:692`) from `previousGeneration` to
  the list. **Plan decision:** these two are a mechanical rename, not a re-reading — one asserts "nothing to clean
  on a first publication" and the other "the replaced generation comes back", and both still say that.
- 2.5 New tests: criteria 1, 3, 4, 5, 6.

`pnpm check` green.

### Step 3 — The Workflow deletes each one  (size: S)

**Files:** `apps/api/src/workflows/ingest.ts`, `apps/api/test/workflow-ingest.test.ts`.

- 3.1 Replace the `if (published.previousGeneration)` block with a loop over `published.supersededGenerations`,
  one `discard` per generation, everything else unchanged.
- 3.2 The step name becomes `cleanup:${generationId}`. **`step.do` names a step for replay, so a loop reusing one
  name would collide** — this is the only part of the change that could break the Workflow rather than the data.
  `discard`'s `name` parameter widens from `"discard" | "cleanup"` to a string; its two call sites keep their words.
- 3.3 `replaced:` on both `ingest.published` log lines reads `supersededGenerations.length > 0`, and the line gains
  `superseded`, the count (criterion 9).
- 3.4 Tests: criteria 7 and 8 — two superseded generations delete under distinct step names, and a throwing discard
  leaves the episode published and the attempt `available`.

`pnpm check` green.

### Step 4 — The docs  (docs only)

- 4.1 PRD §4.2 rule 26 says the publication deletes "the previous generation". It becomes every superseded one, with
  the reason in one clause: a singular delete cannot retry a miss.
- 4.2 PRD §9's open-defect entry from `chat-relevance-rerank.md` is amended rather than removed — the mechanism is
  fixed here, the stray itself is cleared by Step 5, and what remains open is detection (spec §6).
- 4.3 Mark this plan complete with the test count.

### Step 5 — Clear the stray, on the owner's word  (size: S)

Not automatic, and not part of `pnpm check`: it deletes live vectors.

- 5.1 With `pnpm dev` running, Owner Retry `pduZ-bfcKAQ` on The Knowledge Project. It is `available`, so the retry
  opens a `replace` window and leaves the summary and vectors serving until the replacement publishes
  (`routes/channels.ts:519`).
- 5.2 On publication, two generations — `04109673…` and the one this attempt supersedes — are deleted.
- 5.3 Confirm with the probe: a sweep of that channel should show one generation per episode and no duplicate
  scores. Before the change it showed 17 of 50 candidate slots held by the dead set.
- 5.4 **This costs a real re-ingest** — a DownSub transcript fetch, 105 embeddings and a summary. Worth naming
  rather than discovering: it also rewrites that episode's summary with the current prompt, which is a change to
  something the owner may have read.

## Order and risk

Steps 1–2 change no behaviour on their own: nothing reads the new field until Step 3. Step 3 is the only step that
can misbehave at runtime, and its one real hazard is the step name (3.2). Everything is additive to the index —
nothing deletes more than the code already intended to delete — **except** that the set is now larger by exactly the
generations previous publications failed to remove, which is the change being asked for.

The rollback is the same shape as the change: nothing is written that a previous version could not read, since no
schema moves.
