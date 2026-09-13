# Implementation plan — M3.3 AI and Vectorize adapters

**Implements:** `docs/specs/m3-3-ai-vectorize.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries Step 5 of the 2026-09-12 plan except the Workflow binding (M3.5) and the
retrieval generation-check test (M4).
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. No new dependencies.
**Shape:** three code steps and one probe step, each ending with `pnpm check` green and one commit when the owner
asks. Steps 1 to 3 are independent of each other. Decisions this plan makes are marked **plan decision** and stand
unless vetoed.

## Definition of complete

Spec §4, all eight criteria.

### Step 1 — The vector store and its fake  (size: M)

**Files:** `apps/api/src/lib/vectorize.ts`, `apps/api/wrangler.jsonc`, `apps/api/src/bindings.d.ts`,
`apps/api/vitest.config.ts`, `apps/api/test/setup.ts`, `apps/api/test/vectorize.test.ts`.

- 1.1 `wrangler.jsonc`: the `vectorize` binding with `remote: true`; `bindings.d.ts` types it.
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

- 2.1 `wrangler.jsonc`: the `ai` binding with `remote: true`.
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
  `TRANSCRIPTS_FAKE` through the real bindings under `wrangler dev` (`remote: true` reaches the account). Record the
  vector dimension, the raw summary text, and whether `parseSummary` accepted it. Delete the route.

**Done when:** the observations are in the walkthrough record and `git status` is clean of the probe.

## Walkthrough record

_Filled in during Step 4._
