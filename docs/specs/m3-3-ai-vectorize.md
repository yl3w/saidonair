# Feature spec — M3.3 AI and Vectorize adapters

**Written:** 2026-09-13, against `main` at `e37181c`. The third of seven M3 child specs; roadmap
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` §2 (Related episodes, Long episodes, Publishing, Embedding model id), §3.1,
§3.2, §4; PRD §4.4 and §6. Hard rule 3 of `AGENTS.md` is enforced here.
**Status:** approved with the split of 2026-09-13; not started. Plan: `docs/specs/m3-3-ai-vectorize-plan.md`. Needs
only `TranscriptChunk` from M3.1. No new dependencies.

## 1. Summary

The two Cloudflare services the Workflow will call, behind the seams `AGENTS.md` names, with fakes that let a whole
attempt run in the pool. `lib/ai.ts` wraps Workers AI: embeddings with `@cf/baai/bge-base-en-v1.5` and the map and
reduce summary calls with `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and the two approved prompts. `lib/summary.ts`
is the pure half: `[h:mm:ss]` transcript formatting, 45-minute sections on chunk boundaries, JSON shape validation,
the timestamp-to-`startSec` mapping, and the raw-text fallback decision. `lib/vectorize.ts` is the namespaced store
with hard rule 3 enforced in code, generation-aware ids, and an in-memory fake. `wrangler.jsonc` gains `AI` and
`VECTORS` with `remote: true`. Nothing calls any of it yet; a removable probe exercises both real bindings under
`wrangler dev` once.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Where the pure summary logic lives | New `lib/summary.ts` beside `lib/ai.ts`; `prompts/summary.ts` keeps only the two templates and `PROMPT_VERSION`. | `ai.ts` stays the binding wrapper `AGENTS.md` describes; sectioning and validation are testable without a fake. |
| Hard rule 3 on id-based calls | `getByIds(ns, ids)` returns only ids whose stored `namespace` is `ns`; `deleteByIds(ns, ids)` reads first and deletes only the ids confirmed in `ns`. `Namespace` is a one-member literal type, so a wrong namespace is a compile error and a runtime throw. | Vectorize's `getByIds` and `deleteByIds` accept no namespace; the helper is where `AGENTS.md` says the scope is enforced. |
| The fake store | `VECTORIZE_FAKE` selects an in-memory map per namespace, module-level for the isolate, cleared by `test/setup.ts` after every test. Its JSON carries `visibilityDelayReads` (default 0): how many `getByIds` calls after an upsert omit the new ids. `query` computes cosine similarity over stored vectors and honours `filter.channelId.$in`. | Real behaviour where it matters (asynchronous visibility, filters), no network. |
| The fake AI | `AI_FAKE` embeddings are deterministic per text (a seeded hash spread over 768 dimensions, unit-normalised). Summaries are canned, with per-call overrides selected by a marker in the input (`[[invalid-once]]`, `[[invalid]]`, `[[throw]]`) so validation, the one retry, the fallback, and a failure are testable. | Determinism makes vector ids, centroids, and related lookups reproducible. |
| Related candidates | Nothing in `ai.ts`. The Workflow (M3.5) averages the per-batch vector sums `embed` returns, queries the store with `topK: 20` and no filter, dedupes by `videoId` excluding its own; the Registry keeps available ones, at most five (M3.2). | The list is small and the Registry already validates availability. |
| Retrieval's generation check | Out of this chunk. `parseVectorId` is the contract M4 uses; the retrieval test of the 2026-09-12 plan's Step 5 moves to the M4 plan. | Nothing queries for chat until M4; a test of code that does not exist would test the fake. |
| Embedding batch and dimension | 20 texts per `embed` call; the wrapper throws `EMBEDDING_FAILED` when any vector is not 768 wide. | Matches the parent pipeline; well under the model's input cap. |
| Timestamp markers | `formatTranscript` writes `[h:mm:ss]` on every chunk line, hours included below one hour (`[0:04:12]`); `parseSummary` accepts `h:mm:ss` and `mm:ss`. | One marker shape in the prompt; tolerance on the way back. |

## 3. Contract

### 3.1 `lib/vectorize.ts`

```ts
export const SHARED_NAMESPACE = "shared-catalog";
export type Namespace = typeof SHARED_NAMESPACE;
export type ChunkMetadata = { videoId; channelId; generationId; channelTitle; title; startSec; endSec; text; publishedAt };
export type VectorRecord = { id: string; values: number[]; metadata: ChunkMetadata };
export type VectorMatch = { id: string; score: number; metadata: ChunkMetadata };
export type VectorStore = {
  upsert(ns: Namespace, records: VectorRecord[]): Promise<void>;
  getByIds(ns: Namespace, ids: string[]): Promise<string[]>;               // the ids present in ns
  query(ns: Namespace, vector: number[], options: { topK: number; filter?: { channelId: { $in: string[] } } }): Promise<VectorMatch[]>;
  deleteByIds(ns: Namespace, ids: string[]): Promise<void>;
};
export function vectorStore(env): VectorStore;                              // VECTORIZE_FAKE or env.VECTORS
export function vectorId(videoId, generationId, index): string;             // `${videoId}:${generationId}:${index}`
export function generationIds(videoId, generationId, count): string[];
export function parseVectorId(id): { videoId; generationId; index } | null;
```

The helper splits records and ids into batches below the API's per-call ceilings; the ceilings are exported
constants set from Cloudflare's documentation at implementation. Metadata carries every PRD §6 field; `channelId` and
`videoId` are the filter fields, `generationId` is diagnostic only.

### 3.2 `lib/ai.ts`

```ts
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
export const SUMMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export type Embedder = { embed(texts: string[]): Promise<number[][]> };     // ≤ 20 texts, each vector 768 wide
export type Summarizer = {
  summarizeSection(prompt: string): Promise<string>;                        // raw model text
  reduceSections(prompt: string): Promise<string>;
};
export function ai(env): Embedder & Summarizer;                             // AI_FAKE or env.AI
```

Wrappers do not retry: the Workflow step does. A wrong dimension throws an error prefixed `EMBEDDING_FAILED`; any
other failure propagates as thrown.

### 3.3 `lib/summary.ts`

```ts
export function formatTranscript(chunks: TranscriptChunk[]): string;        // one line per chunk: `[h:mm:ss] text`
export function sectionize(chunks: TranscriptChunk[], maxSec = 45 * 60): TranscriptChunk[][];
export type StructuredSummary = { executiveSummary: string; takeaways: { text: string; startSec: number | null }[]; topicTags: string[] };
export function parseSummary(raw: string, durationSec: number | null): StructuredSummary | null;
```

`parseSummary` extracts the JSON between the first `{` and the last `}` (models wrap output in prose or fences),
then validates: `executiveSummary` a non-empty string of at most three sentences; `takeaways` three to five objects
with non-empty `text` and `at` a string or null, `at` parsed to `startSec` and set null when absent, unparsable, or
beyond `durationSec` when known; `topicTags` one to eight non-empty strings, lower-cased and trimmed. Anything else is
`null`, which the caller treats as invalid output.

### 3.4 `prompts/summary.ts`

`PROMPT_VERSION` (a TEXT identifier stored with every summary; changing a prompt bumps it), `mapPrompt(transcript)`,
`reducePrompt(sectionSummaries)`, and `stricterRetrySuffix` appended on the one retry. The approved texts, moved here
from the 2026-09-12 plan:

> You summarise one episode of a YouTube channel for a reader who has not watched it. Return only JSON with three
> fields: `executiveSummary` (at most three sentences, plain prose, no hype), `takeaways` (three to five objects
> `{ "text", "at" }`: `text` is one concrete claim, example, or recommendation from the episode; `at` is the
> `[h:mm:ss]` marker nearest to where it is said, or null), `topicTags` (one to eight short lowercase tags). Use only
> what the transcript supports; do not invent names, numbers, or timestamps. Transcript follows, with `[h:mm:ss]`
> markers.

> You are given summaries of consecutive sections of one YouTube episode, each with timestamped takeaways. Return
> only JSON with the same three fields for the whole episode: `executiveSummary` (at most three sentences),
> `takeaways` (three to five, chosen or merged from the sections, each keeping the `at` timestamp of the section
> takeaway it comes from), `topicTags` (one to eight). Do not add anything the sections do not say.

### 3.5 Bindings

`wrangler.jsonc`, once per environment (`AGENTS.md` → Environments): `"ai": { "binding": "AI", "remote": true }`
and `"vectorize": [{ "binding": "VECTORS", "index_name": "<media-rag | media-rag-staging | media-rag-dev>",
"remote": true }]`, the index named by tier. `bindings.d.ts`: `AI: Ai`, `VECTORS: VectorizeIndex`, and the test-only
`AI_FAKE?` and `VECTORIZE_FAKE?`. `vitest.config.ts` pins both fakes and sets the pool's `remoteBindings: false`
(M3.1 Step 0.2), so tests never open a remote session.

## 4. Acceptance criteria

1. `embed` on the fake is deterministic and 768 wide; the real wrapper rejects a wrong dimension with
   `EMBEDDING_FAILED`; a call with more than 20 texts is refused before reaching the binding.
2. Every store method throws on a namespace other than `shared-catalog`; `getByIds` drops ids stored in another
   namespace; `deleteByIds` never deletes an id it did not confirm.
3. `vectorId` and `parseVectorId` round-trip; `parseVectorId` returns null for a malformed id; `generationIds(v, g,
   3)` is `[v:g:0, v:g:1, v:g:2]`.
4. With `visibilityDelayReads: 2`, the first two `getByIds` after an upsert miss the new ids and the third has them
   all; `query` honours the channel filter and never returns a vector from another channel.
5. `sectionize`: 40 minutes is one section; 100 minutes is three, split only on chunk boundaries, each at most
   45 minutes; `formatTranscript` markers read `[0:04:12]` and `[1:02:03]`.
6. `parseSummary`: valid JSON passes; fence-wrapped JSON passes; four sentences, two takeaways, six takeaways, zero
   tags, nine tags, and a non-string field each return null; `at` beyond the duration gives `startSec: null`;
   `mm:ss` is accepted; tags come back lower-cased.
7. The fake summarizer answers invalid JSON once then valid, invalid always, or throws, on the marker.
8. `pnpm check` green; the probe embedded one text and summarised one fixture with the real bindings under
   `wrangler dev`, its observations are recorded, and it left no trace in the tree.

## 5. Out of scope

The Workflow with its retries and timeouts, the centroid and related step (M3.5); retrieval and chat (M4); the
indexes and their metadata indexes (the owner's one-time setup; M3.1 Step 0 found none existed, and `media-rag-dev`
is the one this chunk's probe needs).

## 6. `AGENTS.md` and PRD alignment

No PRD change. `AGENTS.md` → repo layout gains a `lib/summary.ts` line; the AI code section's rules already hold
(every call through `lib/ai.ts`, prompts in `prompts/`, JSON validated by hand).
