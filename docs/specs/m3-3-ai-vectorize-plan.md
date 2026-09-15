# Implementation plan — M3.3 AI and Vectorize adapters

**Implements:** `docs/specs/m3-3-ai-vectorize.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 5 of the 2026-09-12 plan except the Workflow binding (M3.5) and the
retrieval generation-check test (M4).
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 on `main` (committed as `795ca1b`): the four steps
landed together, `pnpm check` green with 31 test files and 242 tests (28 and 207 before), the probe run and removed.
No new dependencies.
**Shape:** three code steps and one probe step, each ending with `pnpm check` green and one commit when the owner
asks. Steps 1 to 3 are independent of each other. Decisions this plan makes are marked **plan decision** and stand
unless vetoed.

## Definition of complete

Spec §4, all eight criteria.

### Step 1 — The vector store and its fake  (size: M)

**Files:** `apps/api/src/lib/vectorize.ts`, `apps/api/wrangler.jsonc`, `apps/api/src/bindings.d.ts`,
`apps/api/vitest.config.ts`, `apps/api/test/setup.ts`, `apps/api/test/vectorize.test.ts`.

- 1.1 `wrangler.jsonc`: the `vectorize` binding with `remote: true` in all three environments, index named by tier
  (`test/wrangler-config.test.ts` enforces the suffix rule); `bindings.d.ts` types it; `vitest.config.ts` gains
  `remoteBindings: false`.
- 1.2 `vectorize.ts`: the contract of spec §3.1; the real store over `env.VECTORS` with batching constants;
  namespace enforcement per spec §2 on `getByIds` and `deleteByIds`.
- 1.3 The fake behind `VECTORIZE_FAKE` (a JSON object, `{}` for defaults), exported `resetVectorFake()` called from
  `test/setup.ts`. **Plan decision:** the fake store keeps `namespace` beside each record so the ownership check runs
  the same code path as the real store.

**Tests:** spec §4.2–4.4.

**Done when:** `pnpm check` green; the existing suite still passes with the binding present (M3.1 Step 0.2 said it
would).

### Step 2 — Workers AI wrappers, prompts, and the fake  (size: M)

**Files:** `apps/api/src/lib/ai.ts`, `apps/api/src/prompts/summary.ts`, `apps/api/wrangler.jsonc`,
`apps/api/src/bindings.d.ts`, `apps/api/vitest.config.ts`, `apps/api/test/ai.test.ts`.

- 2.1 `wrangler.jsonc`: the `ai` binding with `remote: true` in all three environments.
- 2.2 `prompts/summary.ts`: `PROMPT_VERSION`, `mapPrompt`, `reducePrompt`, `stricterRetrySuffix`, the two approved
  texts verbatim. **Plan decision:** `PROMPT_VERSION` is `"2026-09-13"`; a later prompt edit sets the date of the
  edit.
- 2.3 `ai.ts`: `ai(env)` per spec §3.2; the real embedder calls `env.AI.run(EMBEDDING_MODEL, { text })` and checks
  dimensions; the real summarizer calls `SUMMARY_MODEL` with the prompt as a single user message and returns the
  response text. The fake per spec §2.

**Tests:** spec §4.1 and 4.7.

**Done when:** `pnpm check` green.

### Step 3 — Pure summary helpers  (size: M)

**Files:** `apps/api/src/lib/summary.ts`, `apps/api/test/summary.test.ts`, `AGENTS.md` (layout line).

- 3.1 `formatTranscript`, `sectionize`, `parseSummary` per spec §3.3. **Plan decision:** sentence counting splits on
  `.`, `!`, or `?` followed by whitespace or end of text, ignoring a decimal point between digits.

**Tests:** spec §4.5 and 4.6.

**Done when:** `pnpm check` green.

### Step 4 — Probe  (size: S)

**Files:** none committed.

- 4.1 A temporary `GET /__probe/ai` route embeds one sentence and summarises the ten-minute fixture from
  `TRANSCRIPTS_FAKE` through the real bindings under `pnpm dev` (`--env dev`, so `media-rag-dev`, which the owner
  creates first). Record the
  vector dimension, the raw summary text, and whether `parseSummary` accepted it. Delete the route.

**Done when:** the observations are in the walkthrough record and `git status` is clean of the probe.

## Walkthrough record

Run on 2026-09-13 against the working tree after `afb2b02`, under `wrangler dev --env dev` (so `media-rag-dev` and
the account's Workers AI through the dev environment's `remote: true` bindings; the log showed both as `remote` and
`⎔ Establishing remote connection...`). Two temporary routes, deleted afterwards; `index.ts` is back at its committed
content.

| Leg | Observation |
|---|---|
| `embed` of one sentence | 768 dimensions in 427 ms; first values `0.0228, 0.0047, 0.0003`. |
| `upsert` of one probe vector (`probe000001:probe-gen:0`, namespace `shared-catalog`, full `ChunkMetadata`) | Accepted in 1.1 s with a mutation id. `getByIds` then saw nothing for 20 reads over 23 s, so the probe's `deleteByIds` correctly deleted nothing. `wrangler vectorize info` later showed the mutation processed at 18:02:34 UTC, about 80 s after the upsert, and `get-vectors` returned the vector **with its `namespace` field and metadata**, so the ownership filter in `getByIds` is sound. A second vector inserted through the CLI at 18:04:0x was processed at 18:04:14, about 10 s later. Visibility latency on this fresh index was 10–80 s, not the "few seconds" the docs give; M3.5's verify step (eight retries, exponential from 5 s, about 21 minutes in total) absorbs that with room. |
| cleanup route: `getByIds` → `query` → `deleteByIds` → `getByIds` | Both probe vectors present on the first read; `query` with the channel filter and the second vector's own values ranked it first at 0.999999 and the other at 0.032, both with metadata intact; `deleteByIds` confirmed both and deleted them in 1.0 s; `getByIds` reported them gone after 19 reads, 21 s. `info` still counted 2 a few seconds later: the delete mutation is asynchronous too. |
| `summarizeSection` of the ten-minute English fixture (one section of 12 chunks, prompt 12,552 characters) | 9.2 s; the model answered fenced JSON (```` ```json ```` … ```` ``` ````) of 1,070 characters, three sentences, five takeaways, four tags; `parseSummary(raw, 600)` accepted it. Every takeaway carried `[0:00:00]`: the fixture repeats ten sentences, so the model chose the first marker for all; the tags came back lower-case already, one as a joined word (`softwaredevelopment`). |

Decisions made while implementing (plan decisions, stand unless vetoed):

- Batch constants: `UPSERT_BATCH = 200` (the binding allows 1000; a chunk's metadata is a few KiB, so 200 keeps a
  request small), `GET_BY_IDS_BATCH = 20`, `DELETE_BATCH = 1000`, `QUERY_TOP_K_MAX = 50` (the documented cap when
  metadata is returned). The limits page (read 2026-09-13) does not state a `getByIds` or `deleteByIds` ceiling.
- The fake is a stub `Vectorize` behind `realStore`, so the namespace filter, the id-ownership check, and the
  batching run the same code in tests as in production; `throwOn` was added to the fake's options for M3.5's
  failure paths; `fakeVectorIds()` is exported for assertions.
- `upsert` refuses a record whose id does not parse as `${episodeId}:${generationId}:${index}` or whose metadata names
  a different video: nothing but our own ids is ever written.
- `embed` also refuses an empty batch; a vector with a non-finite value is `EMBEDDING_FAILED`.
- The fake summarizer's takeaways reuse the first three `[h:mm:ss]` markers of the prompt, so M3.5's tests get
  `startSec` values that map back to real chunk times; `resetAiFake()` clears its once-only memory.
- `countSentences` treats a run of terminal punctuation as one boundary, so "Ends with dots..." is one sentence.
- Vectorize's `query` is called with `returnValues: false` and `returnMetadata: "all"`.
