/**
 * Workers AI, behind the one seam route and Workflow code use (AGENTS.md → AI code): embeddings
 * with the 768-dimension BGE model and the map and reduce summary calls with Llama 3.3, both in JSON
 * mode against `SUMMARY_RESPONSE_SCHEMA` (docs/specs/summary-json-mode.md §3.3). Wrappers do not
 * retry; the Workflow step does. The test-only `AI_FAKE` binding selects a deterministic fake:
 * embeddings are a seeded hash of the text, summaries are canned JSON that echoes the transcript's
 * own `[h:mm:ss]` markers, and a marker in the prompt drives the failure paths.
 */

import { STRICTER_RETRY_SUFFIX } from "../prompts/summary";
import { SUMMARY_RESPONSE_SCHEMA, SYNTHESIS_RESPONSE_SCHEMA } from "./summary";

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
/** Texts per `embed` call: well under the model's input cap, one Vectorize upsert batch each. */
export const EMBEDDING_BATCH = 20;
export const SUMMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** Room for eight takeaways with timestamps, a three-sentence summary, and eight tags, several times over. */
export const SUMMARY_MAX_TOKENS = 1024;
/**
 * Chat names the same model as summarisation today, through its own constant so tuning one cannot
 * silently move the other. Both are aliases rather than identities: asking for `-fp8-fast` is served
 * `-sd`, a speculative-decoding variant (probed 2026-09-16).
 */
export const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** A scoped answer draws on up to eight chunks, so a ceiling below its evidence is the wrong constraint. */
export const CHAT_MAX_TOKENS = 1024;
/**
 * The cross-encoder that decides whether a retrieved chunk bears on the question
 * (docs/specs/chat-relevance-rerank.md §4.1). Its own constant, like `CHAT_MODEL`: tuning retrieval
 * must not be able to move answering. It scores the (question, passage) pair jointly rather than
 * comparing two independently made embeddings, which is why its scores separate where the
 * embedder's cosine does not — §2 of that spec is the measurement.
 */
export const RERANK_MODEL = "@cf/baai/bge-reranker-base";

export type Embedder = {
  /** One vector per text, each `EMBEDDING_DIMENSIONS` wide; at most `EMBEDDING_BATCH` texts. */
  embed(texts: readonly string[]): Promise<number[][]>;
};

export type Summarizer = {
  /** The model's raw text for one section's map prompt. */
  summarizeSection(prompt: string): Promise<string>;
  /**
   * The model's raw text for the synthesis prompt: the executive summary and the tags of the whole
   * episode. It is not asked for takeaways and its schema does not admit them.
   */
  synthesise(prompt: string): Promise<string>;
};

export type Answer = {
  text: string;
  /**
   * The model stopped because it hit `CHAT_MAX_TOKENS`, so the text ends mid-sentence. The caller
   * trims and keeps it rather than failing the reply (docs/PRD.md §9, 2026-09-16).
   */
  truncated: boolean;
};

export type Answerer = {
  /** The model's prose for a chat question. No JSON mode: there is nothing to parse. */
  answer(prompt: string): Promise<Answer>;
};

export type Reranker = {
  /**
   * One relevance score per passage, **in the order given** — not sorted, and never shorter than the
   * input. The caller pairs them back to its own candidates by index, so a reordering here would
   * silently mis-attribute every score.
   */
  rerank(query: string, passages: readonly string[]): Promise<number[]>;
};

export type AiClient = Embedder & Summarizer & Answerer & Reranker;

export function ai(env: { AI?: Ai; AI_FAKE?: string }): AiClient {
  if (env.AI_FAKE !== undefined)
    return fakeClient(parseFakeOptions(env.AI_FAKE));
  if (!env.AI) throw new Error("AI binding is not configured");
  return realClient(env.AI);
}

/** The client over a binding. Exported so tests can drive it with a stub. */
export function realClient(binding: Ai): AiClient {
  const complete =
    (schema: unknown) =>
    async (prompt: string): Promise<string> => {
      const result = (await binding.run(SUMMARY_MODEL, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: SUMMARY_MAX_TOKENS,
        response_format: { type: "json_schema", json_schema: schema },
      })) as { response?: unknown };
      // JSON mode answers a parsed object; a string passes through unchanged; anything else, including
      // the platform's "JSON Mode couldn't be met", is a failed call the Workflow step retries.
      if (typeof result?.response === "string") return result.response;
      if (result?.response !== null && typeof result?.response === "object") {
        return JSON.stringify(result.response);
      }
      throw new Error("SUMMARY_FAILED: the model returned no response");
    };
  return {
    async embed(texts) {
      requireBatch(texts);
      const result = (await binding.run(EMBEDDING_MODEL, {
        text: [...texts],
      })) as {
        data?: unknown;
      };
      return requireVectors(result?.data, texts.length);
    },
    summarizeSection: complete(SUMMARY_RESPONSE_SCHEMA),
    synthesise: complete(SYNTHESIS_RESPONSE_SCHEMA),
    async answer(prompt) {
      const result = await binding.run(CHAT_MODEL, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: CHAT_MAX_TOKENS,
      });
      const raw = result as ChatCompletion;
      if (typeof raw?.response !== "string") {
        throw new Error("ANSWER_FAILED: the model returned no response");
      }
      return { text: raw.response, truncated: isTruncated(raw) };
    },
    async rerank(query, passages) {
      if (passages.length === 0) return [];
      const inputs: RerankInput = {
        query,
        contexts: passages.map((text) => ({ text })),
        // Never optional. The runtime returns only `top_k` rows, so a smaller value leaves the tail
        // unscored, and an unscored passage reads downstream as irrelevant — which is a quieter,
        // worse version of the defect this model was added to fix.
        top_k: passages.length,
      };
      const result = (await binding.run(
        RERANK_MODEL,
        inputs as never,
      )) as RerankResponse;
      return requireScores(result?.response, passages.length);
    },
  };
}

/**
 * **`query` is missing from the platform's own input type.** `Ai_Cf_Baai_Bge_Reranker_Base_Input`
 * carries the JSDoc for it — "A query you wish to perform against the provided contexts" — and then
 * declares only `top_k` and `contexts`, so the one field the model cannot work without does not
 * typecheck (workers-types 5.20260907.1, verified against the live model 2026-09-17). Hence the local
 * type and the single `as never` at the call: the same treatment `ChatCompletion` gets below, and for
 * the same reason — do not widen the platform types to claim a contract Cloudflare has not published.
 * Recheck on the next workers-types bump; when the field appears, this type and the cast both go.
 */
type RerankInput = {
  query: string;
  contexts: { text: string }[];
  top_k: number;
};

/** One row per context, carrying the context's **input index** as `id`. */
type RerankResponse = {
  response?: unknown;
};

/**
 * Scores back in input order. A row for an index that never arrives scores `0` rather than throwing:
 * the model omitting a context is a relevance judgement of sorts, and one missing row must not cost a
 * reader the whole answer. A non-array `response` is a failed call, which the caller catches.
 */
function requireScores(response: unknown, expected: number): number[] {
  if (!Array.isArray(response)) {
    throw new Error("RERANK_FAILED: the model returned no scores");
  }
  const scores = new Array<number>(expected).fill(0);
  for (const row of response) {
    const { id, score } = (row ?? {}) as { id?: unknown; score?: unknown };
    if (typeof id !== "number" || typeof score !== "number") continue;
    if (!Number.isInteger(id) || id < 0 || id >= expected) continue;
    if (!Number.isFinite(score)) continue;
    scores[id] = score;
  }
  return scores;
}

/**
 * What `run()` actually answers, which is more than the platform's declared output type admits: a
 * full OpenAI `chat.completion` (probed 2026-09-16). Narrow and local on purpose — widening the
 * platform types would claim a contract Cloudflare has not published.
 */
type ChatCompletion = {
  response?: unknown;
  choices?: { finish_reason?: unknown }[];
  usage?: { completion_tokens?: unknown };
};

/**
 * Both checks, never one. `finish_reason` is explicit but undeclared, so a runtime that stopped
 * sending it would fail open and report every answer complete with no compile error; the token count
 * is declared but only a proxy, true of an answer that happens to end exactly at the cap.
 */
function isTruncated(raw: ChatCompletion): boolean {
  const reason = raw.choices?.[0]?.finish_reason;
  if (typeof reason === "string") return reason === "length";
  const used = raw.usage?.completion_tokens;
  return typeof used === "number" && used >= CHAT_MAX_TOKENS;
}

function requireBatch(texts: readonly string[]): void {
  if (texts.length === 0 || texts.length > EMBEDDING_BATCH) {
    throw new Error(
      `EMBEDDING_FAILED: embed takes 1 to ${EMBEDDING_BATCH} texts, got ${texts.length}`,
    );
  }
}

/** One vector per text, every one `EMBEDDING_DIMENSIONS` wide, or the step fails as `EMBEDDING_FAILED`. */
function requireVectors(data: unknown, expected: number): number[][] {
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(
      `EMBEDDING_FAILED: expected ${expected} vectors, got ${Array.isArray(data) ? data.length : typeof data}`,
    );
  }
  for (const vector of data) {
    if (
      !Array.isArray(vector) ||
      vector.length !== EMBEDDING_DIMENSIONS ||
      !vector.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      throw new Error(
        `EMBEDDING_FAILED: a vector is not ${EMBEDDING_DIMENSIONS} finite numbers (got ${
          Array.isArray(vector) ? vector.length : typeof vector
        })`,
      );
    }
  }
  return data as number[][];
}

// --- the fake (AI_FAKE) -------------------------------------------------------------------------

/** Markers a test puts in a prompt to drive the summarizer's failure paths. */
export const FAKE_INVALID_ONCE = "[[invalid-once]]";
/** Drives `answer` to a reply that stops mid-sentence, for the trim path. */
export const FAKE_TRUNCATE = "[[truncate]]";
/** In a **passage**, drives `rerank` to score it zero, so the relevance floor is drivable. */
export const FAKE_IRRELEVANT = "[[irrelevant]]";
/**
 * In the **question**, drives `rerank` to throw, so its fallback is drivable. Its own marker rather
 * than `FAKE_THROW`: the question is copied verbatim into the answering prompt, so the shared marker
 * would fail the answer too and a test could never see the fallback it was written for.
 */
export const FAKE_RERANK_THROW = "[[rerank-throw]]";
export const FAKE_INVALID = "[[invalid]]";
export const FAKE_THROW = "[[throw]]";

const invalidOnceSeen = new Set<string>();

export function resetAiFake(): void {
  invalidOnceSeen.clear();
}

type FakeOptions = {
  /** `embed` throws, for the EMBEDDING_FAILED path. */
  embedThrows: boolean;
  /**
   * `synthesise` never answers valid JSON, for the path where the three sentences are lost and the
   * allocated takeaways are published anyway. A prompt marker cannot drive this one: the synthesis
   * prompt is built from the section answers, so a marker in the transcript fails the map instead.
   */
  synthesisInvalid: boolean;
};

function parseFakeOptions(raw: string): FakeOptions {
  const value = JSON.parse(raw) as Partial<FakeOptions> | null;
  return {
    embedThrows: value?.embedThrows ?? false,
    synthesisInvalid: value?.synthesisInvalid ?? false,
  };
}

function fakeClient(options: FakeOptions): AiClient {
  const complete =
    (canned: (prompt: string) => string) =>
    async (prompt: string): Promise<string> => {
      if (prompt.includes(FAKE_THROW))
        throw new Error("SUMMARY_FAILED: canned failure");
      if (prompt.includes(FAKE_INVALID))
        return "I am sorry, I cannot produce that JSON.";
      // The retry re-sends the prompt with the stricter suffix: same prompt, second answer.
      const key = prompt.replace(STRICTER_RETRY_SUFFIX, "");
      if (prompt.includes(FAKE_INVALID_ONCE) && !invalidOnceSeen.has(key)) {
        invalidOnceSeen.add(key);
        return "Here is my answer: { not: json";
      }
      return canned(prompt);
    };
  return {
    async embed(texts) {
      requireBatch(texts);
      if (options.embedThrows)
        throw new Error("EMBEDDING_FAILED: canned failure");
      return texts.map((text) => fakeEmbedding(text));
    },
    summarizeSection: complete(cannedSummary),
    synthesise: complete(
      options.synthesisInvalid
        ? () => "I am sorry, I cannot produce that JSON."
        : cannedSynthesis,
    ),
    async answer(prompt) {
      if (prompt.includes(FAKE_THROW))
        throw new Error("ANSWER_FAILED: canned failure");
      // Not FAKE_INVALID: those markers mean unparseable JSON, and prose has nothing to parse.
      if (prompt.includes(FAKE_TRUNCATE)) {
        return {
          text: "The hosts spend most of the segment on this. Their first point is that the",
          truncated: true,
        };
      }
      return { text: cannedAnswer(prompt), truncated: false };
    },
    async rerank(query, passages) {
      // The marker goes on the query, not a passage: a test failing the call should not have to make
      // one chunk special, and a passage marker already means something else.
      if (query.includes(FAKE_RERANK_THROW))
        throw new Error("RERANK_FAILED: canned failure");
      // Descending by input order, so a test that says nothing about relevance sees the order the
      // vector query returned — every test written before the reranker existed still means what it meant.
      return passages.map((passage, index) =>
        passage.includes(FAKE_IRRELEVANT) ? 0 : 1 / (index + 1),
      );
    },
  };
}

/** Echoes the question back so a test can assert what reached the model. */
function cannedAnswer(prompt: string): string {
  const question = prompt.split("\n").filter(Boolean).at(-1) ?? "";
  return `Answering from the transcripts. ${question}`;
}

/** The synthesis answer's two fields; the takeaways are not its to produce. */
function cannedSynthesis(_prompt: string): string {
  return JSON.stringify({
    executiveSummary:
      "A canned synthesis of the episode. It says what the sections say. Nothing more.",
    topicTags: ["canned", "test"],
  });
}

/** Valid JSON of the expected shape whose takeaways reuse the first markers found in the prompt. */
function cannedSummary(prompt: string): string {
  const markers = [...prompt.matchAll(/\[(\d+:\d{2}:\d{2})\]/g)].map(
    (m) => m[1] ?? null,
  );
  const at = (i: number) => markers[i] ?? null;
  return JSON.stringify({
    executiveSummary:
      "A canned summary of the section. It says what the transcript says. Nothing more.",
    takeaways: [
      { text: "First canned takeaway.", at: at(0) },
      { text: "Second canned takeaway.", at: at(1) },
      { text: "Third canned takeaway.", at: at(2) },
    ],
    topicTags: ["canned", "test"],
  });
}

/** A unit vector derived from the text alone: the same text always embeds identically. */
export function fakeEmbedding(text: string): number[] {
  let seed = fnv1a(text);
  const values: number[] = [];
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    // xorshift32
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    const value = seed / 0xffffffff - 0.5;
    values.push(value);
    norm += value * value;
  }
  const scale = 1 / Math.sqrt(norm);
  return values.map((v) => v * scale);
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}
