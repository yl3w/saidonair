/**
 * The vector store behind ingestion and retrieval (docs/PRD.md §6; docs/specs/m3-3-ai-vectorize.md
 * §3.1). Every operation names its namespace, and the only namespace is `shared-catalog`: user
 * emails are never namespaces (AGENTS.md hard rule 3). Vectorize's id-based calls take no namespace,
 * so the scope is enforced here: `getByIds` answers only ids stored in the namespace, and
 * `deleteByIds` deletes only ids it has confirmed there. Ids carry the vector generation,
 * `${episodeId}:${generationId}:${chunkIndex}`, so retrieval can check a match against the episode's
 * active generation (M4) and an attempt can delete a whole generation by count.
 */

export const SHARED_NAMESPACE = "shared-catalog";
export type Namespace = typeof SHARED_NAMESPACE;

/** Every PRD §6 field; `channelId` and `episodeId` are the filter fields, `generationId` is diagnostic. */
export type ChunkMetadata = {
  episodeId: string;
  channelId: string;
  generationId: string;
  channelTitle: string;
  title: string;
  startSec: number;
  endSec: number;
  text: string;
  publishedAt: number;
};

export type VectorRecord = {
  id: string;
  values: number[];
  metadata: ChunkMetadata;
};
export type VectorMatch = {
  id: string;
  score: number;
  metadata: ChunkMetadata;
};
export type QueryOptions = {
  topK: number;
  /**
   * A union of exactly two shapes, never an open record: a chat question searches the caller's
   * eligible channels or one scoped episode, and PRD §6 forbids an unfiltered query. Keeping it a
   * union makes "no filter" and "both filters" unrepresentable rather than merely discouraged.
   */
  filter?: QueryFilter;
};

/**
 * The channel-set form of an unscoped question, or the single-episode form of a scoped one (PRD §6).
 * A union rather than an open record so that a filter naming neither field cannot be written, which
 * is the rule that matters: chat must never send an unfiltered query. It does **not** exclude a
 * literal carrying both fields — excess-property checking against a union admits any member's
 * property — and the `?: never` arms that would are not assignable to the platform's own
 * index-signature filter type. Not worth a double cast: the caller picks one shape from the
 * question's scope, so "both at once" is unreachable rather than merely discouraged.
 */
export type QueryFilter =
  | { channelId: { $in: string[] } }
  | { episodeId: { $eq: string } };

export type VectorStore = {
  upsert(ns: Namespace, records: readonly VectorRecord[]): Promise<void>;
  /** The given ids that exist in the namespace, in the order given. */
  getByIds(ns: Namespace, ids: readonly string[]): Promise<string[]>;
  query(
    ns: Namespace,
    vector: readonly number[],
    options: QueryOptions,
  ): Promise<VectorMatch[]>;
  deleteByIds(ns: Namespace, ids: readonly string[]): Promise<void>;
};

// Vectorize's documented ceilings (developers.cloudflare.com/vectorize/platform/limits, read
// 2026-09-13): 1000 vectors per upsert through the binding, 50 matches when metadata is returned.
// getByIds is kept to 20 ids per call, the figure the binding has enforced; smaller batches cost
// nothing but a call.
export const UPSERT_BATCH = 200;
export const GET_BY_IDS_BATCH = 20;
export const DELETE_BATCH = 1000;
export const QUERY_TOP_K_MAX = 50;

const EPISODE_ID = "[A-Za-z0-9_-]{11}";
const VECTOR_ID = new RegExp(`^(${EPISODE_ID}):([^:]+):(\\d+)$`);

export function vectorId(
  episodeId: string,
  generationId: string,
  index: number,
): string {
  return `${episodeId}:${generationId}:${index}`;
}

/** The ids of one whole generation, `0..count-1`. */
export function generationIds(
  episodeId: string,
  generationId: string,
  count: number,
): string[] {
  return Array.from({ length: count }, (_, index) =>
    vectorId(episodeId, generationId, index),
  );
}

export function parseVectorId(
  id: string,
): { episodeId: string; generationId: string; index: number } | null {
  const match = VECTOR_ID.exec(id);
  if (!match) return null;
  return {
    episodeId: match[1] ?? "",
    generationId: match[2] ?? "",
    index: Number(match[3]),
  };
}

export function vectorStore(env: {
  VECTORS?: Vectorize;
  VECTORIZE_FAKE?: string;
}): VectorStore {
  if (env.VECTORIZE_FAKE !== undefined)
    return fakeStore(parseFakeOptions(env.VECTORIZE_FAKE));
  if (!env.VECTORS) throw new Error("VECTORS binding is not configured");
  return realStore(env.VECTORS);
}

/** The store over a bound index. Exported so tests can drive it with a stub index. */
export function realStore(index: Vectorize): VectorStore {
  return {
    async upsert(ns, records) {
      requireNamespace(ns);
      for (const record of records) requireOwnedRecord(record);
      for (const batch of batches(records, UPSERT_BATCH)) {
        await index.upsert(
          batch.map((record) => ({
            id: record.id,
            values: record.values,
            namespace: ns,
            metadata: record.metadata,
          })),
        );
      }
    },
    async getByIds(ns, ids) {
      requireNamespace(ns);
      const present = new Set<string>();
      for (const batch of batches(ids, GET_BY_IDS_BATCH)) {
        for (const vector of await index.getByIds([...batch])) {
          if (vector.namespace === ns) present.add(vector.id);
        }
      }
      return ids.filter((id) => present.has(id));
    },
    async query(ns, vector, options) {
      requireNamespace(ns);
      requireTopK(options.topK);
      const result = await index.query([...vector], {
        topK: options.topK,
        namespace: ns,
        returnValues: false,
        returnMetadata: "all",
        ...(options.filter ? { filter: options.filter } : {}),
      });
      return result.matches.map((match) => ({
        id: match.id,
        score: match.score,
        metadata: requireChunkMetadata(match.id, match.metadata),
      }));
    },
    async deleteByIds(ns, ids) {
      requireNamespace(ns);
      const confirmed = await this.getByIds(ns, ids);
      for (const batch of batches(confirmed, DELETE_BATCH)) {
        await index.deleteByIds([...batch]);
      }
    },
  };
}

function requireNamespace(ns: string): void {
  if (ns !== SHARED_NAMESPACE) {
    throw new Error(
      `vectorize: namespace must be ${SHARED_NAMESPACE}, got ${ns}`,
    );
  }
}

/** An id of our shape whose metadata names the same video: nothing else is ever written. */
function requireOwnedRecord(record: VectorRecord): void {
  const parsed = parseVectorId(record.id);
  if (!parsed || parsed.episodeId !== record.metadata.episodeId) {
    throw new Error(
      `vectorize: id ${record.id} does not belong to its metadata`,
    );
  }
}

function requireTopK(topK: number): void {
  if (!Number.isInteger(topK) || topK < 1 || topK > QUERY_TOP_K_MAX) {
    throw new Error(`vectorize: topK must be between 1 and ${QUERY_TOP_K_MAX}`);
  }
}

/** Metadata we wrote ourselves, read back by name; anything else is corruption, not input. */
function requireChunkMetadata(id: string, value: unknown): ChunkMetadata {
  const m =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const str = (key: string) =>
    typeof m?.[key] === "string" ? (m[key] as string) : null;
  const num = (key: string) =>
    typeof m?.[key] === "number" && Number.isFinite(m[key])
      ? (m[key] as number)
      : null;
  const episodeId = str("episodeId");
  const channelId = str("channelId");
  const generationId = str("generationId");
  const channelTitle = str("channelTitle");
  const title = str("title");
  const text = str("text");
  const startSec = num("startSec");
  const endSec = num("endSec");
  const publishedAt = num("publishedAt");
  if (
    episodeId === null ||
    channelId === null ||
    generationId === null ||
    channelTitle === null ||
    title === null ||
    text === null ||
    startSec === null ||
    endSec === null ||
    publishedAt === null
  ) {
    throw new Error(`vectorize: vector ${id} has malformed metadata`);
  }
  return {
    episodeId,
    channelId,
    generationId,
    channelTitle,
    title,
    startSec,
    endSec,
    text,
    publishedAt,
  };
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

// --- the fake (VECTORIZE_FAKE) ------------------------------------------------------------------

type FakeOptions = {
  /** How many `getByIds` reads after an upsert omit the new ids: Vectorize applies writes asynchronously. */
  visibilityDelayReads: number;
  /** Methods that throw, for the failure paths (a cleanup that fails, a related lookup that fails). */
  throwOn: ("upsert" | "getByIds" | "query" | "deleteByIds")[];
};

type StoredVector = {
  values: number[];
  metadata: ChunkMetadata;
  namespace: string;
};

const fakeVectors = new Map<string, StoredVector>();
const fakePendingReads = new Map<string, number>();

export function resetVectorFake(): void {
  fakeVectors.clear();
  fakePendingReads.clear();
}

/** What the fake holds, for assertions: every id, in insertion order. */
export function fakeVectorIds(): string[] {
  return [...fakeVectors.keys()];
}

function parseFakeOptions(raw: string): FakeOptions {
  const value = JSON.parse(raw) as Partial<FakeOptions> | null;
  return {
    visibilityDelayReads: value?.visibilityDelayReads ?? 0,
    throwOn: value?.throwOn ?? [],
  };
}

function fakeStore(options: FakeOptions): VectorStore {
  // A store configured without a delay sees every write at once, including writes an earlier,
  // delayed configuration left pending: the operator "waited long enough".
  if (options.visibilityDelayReads === 0) fakePendingReads.clear();
  const failing = (method: FakeOptions["throwOn"][number]) => {
    if (options.throwOn.includes(method)) {
      throw new Error(`vectorize fake: ${method} is configured to fail`);
    }
  };
  // The fake index behind the same real-store code path, so namespace and ownership checks are shared.
  const index: Vectorize = {
    async describe() {
      return {
        dimensions: 768,
        vectorCount: fakeVectors.size,
        processedUpToDatetime: 0,
        processedUpToMutation: 0,
      } as unknown as VectorizeIndexInfo;
    },
    async query(vector, queryOptions) {
      failing("query");
      const filter = queryOptions?.filter as
        | { channelId?: { $in?: string[] }; episodeId?: { $eq?: string } }
        | undefined;
      const allowed = filter?.channelId?.$in;
      const onlyEpisode = filter?.episodeId?.$eq;
      const matches: VectorizeMatch[] = [];
      for (const [id, stored] of fakeVectors) {
        if (stored.namespace !== queryOptions?.namespace) continue;
        if (allowed && !allowed.includes(stored.metadata.channelId)) continue;
        if (onlyEpisode && stored.metadata.episodeId !== onlyEpisode) continue;
        matches.push({
          id,
          score: cosine([...vector], stored.values),
          metadata: stored.metadata,
        });
      }
      matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const top = matches.slice(0, queryOptions?.topK ?? 10);
      return { matches: top, count: top.length };
    },
    async queryById() {
      throw new Error("vectorize fake: queryById is not implemented");
    },
    async insert(vectors) {
      return this.upsert(vectors);
    },
    async upsert(vectors) {
      failing("upsert");
      for (const vector of vectors) {
        fakeVectors.set(vector.id, {
          values: [...vector.values],
          metadata: vector.metadata as ChunkMetadata,
          namespace: vector.namespace ?? "",
        });
        if (options.visibilityDelayReads > 0) {
          fakePendingReads.set(vector.id, options.visibilityDelayReads);
        }
      }
      return { mutationId: crypto.randomUUID() };
    },
    async deleteByIds(ids) {
      failing("deleteByIds");
      for (const id of ids) {
        fakeVectors.delete(id);
        fakePendingReads.delete(id);
      }
      return { mutationId: crypto.randomUUID() };
    },
    async getByIds(ids) {
      failing("getByIds");
      const found: VectorizeVector[] = [];
      for (const id of ids) {
        const stored = fakeVectors.get(id);
        if (!stored) continue;
        const pending = fakePendingReads.get(id) ?? 0;
        if (pending > 0) {
          fakePendingReads.set(id, pending - 1);
          continue;
        }
        found.push({
          id,
          values: stored.values,
          namespace: stored.namespace,
          metadata: stored.metadata,
        });
      }
      return found;
    },
  };
  return realStore(index);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
