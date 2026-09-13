/**
 * Workers AI, behind the one seam route and Workflow code use (AGENTS.md → AI code): embeddings
 * with the 768-dimension BGE model and the map and reduce summary calls with Llama 3.3. Wrappers do
 * not retry; the Workflow step does. The test-only `AI_FAKE` binding selects a deterministic fake:
 * embeddings are a seeded hash of the text, summaries are canned JSON that echoes the transcript's
 * own `[h:mm:ss]` markers, and a marker in the prompt drives the failure paths.
 */

import { STRICTER_RETRY_SUFFIX } from "../prompts/summary";

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
/** Texts per `embed` call: well under the model's input cap, one Vectorize upsert batch each. */
export const EMBEDDING_BATCH = 20;
export const SUMMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** Room for five takeaways with timestamps and a three-sentence summary, several times over. */
export const SUMMARY_MAX_TOKENS = 1024;

export type Embedder = {
  /** One vector per text, each `EMBEDDING_DIMENSIONS` wide; at most `EMBEDDING_BATCH` texts. */
  embed(texts: readonly string[]): Promise<number[][]>;
};

export type Summarizer = {
  /** The model's raw text for one section's map prompt. */
  summarizeSection(prompt: string): Promise<string>;
  /** The model's raw text for the reduce prompt over the section answers. */
  reduceSections(prompt: string): Promise<string>;
};

export type AiClient = Embedder & Summarizer;

export function ai(env: { AI?: Ai; AI_FAKE?: string }): AiClient {
  if (env.AI_FAKE !== undefined)
    return fakeClient(parseFakeOptions(env.AI_FAKE));
  if (!env.AI) throw new Error("AI binding is not configured");
  return realClient(env.AI);
}

/** The client over a binding. Exported so tests can drive it with a stub. */
export function realClient(binding: Ai): AiClient {
  const complete = async (prompt: string): Promise<string> => {
    const result = (await binding.run(SUMMARY_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: SUMMARY_MAX_TOKENS,
    })) as { response?: unknown };
    if (typeof result?.response !== "string") {
      throw new Error("SUMMARY_FAILED: the model returned no response text");
    }
    return result.response;
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
    summarizeSection: complete,
    reduceSections: complete,
  };
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
export const FAKE_INVALID = "[[invalid]]";
export const FAKE_THROW = "[[throw]]";

const invalidOnceSeen = new Set<string>();

export function resetAiFake(): void {
  invalidOnceSeen.clear();
}

type FakeOptions = {
  /** `embed` throws, for the EMBEDDING_FAILED path. */
  embedThrows: boolean;
};

function parseFakeOptions(raw: string): FakeOptions {
  const value = JSON.parse(raw) as Partial<FakeOptions> | null;
  return { embedThrows: value?.embedThrows ?? false };
}

function fakeClient(options: FakeOptions): AiClient {
  const complete = async (prompt: string): Promise<string> => {
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
    return cannedSummary(prompt);
  };
  return {
    async embed(texts) {
      requireBatch(texts);
      if (options.embedThrows)
        throw new Error("EMBEDDING_FAILED: canned failure");
      return texts.map((text) => fakeEmbedding(text));
    },
    summarizeSection: complete,
    reduceSections: complete,
  };
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
