import { describe, expect, it } from "vitest";
import {
  type ChunkMetadata,
  fakeVectorIds,
  GET_BY_IDS_BATCH,
  generationIds,
  parseVectorId,
  QUERY_TOP_K_MAX,
  realStore,
  resetVectorFake,
  SHARED_NAMESPACE,
  UPSERT_BATCH,
  type VectorRecord,
  vectorId,
  vectorStore,
} from "../src/lib/vectorize";

const VIDEO = "aaaaaaaaaaa";
const OTHER = "bbbbbbbbbbb";
const GEN = "11111111-1111-1111-1111-111111111111";

function metadata(
  videoId: string,
  channelId = "UCAAAAAAAAAAAAAAAAAAAAAA",
): ChunkMetadata {
  return {
    videoId,
    channelId,
    generationId: GEN,
    channelTitle: "Channel",
    title: `Episode ${videoId}`,
    startSec: 0,
    endSec: 60,
    text: "some transcript text",
    publishedAt: 1_000,
  };
}

/** A unit vector along one axis, so cosine similarity is exact. */
function axis(i: number, dims = 8): number[] {
  return Array.from({ length: dims }, (_, k) => (k === i ? 1 : 0));
}

function records(
  videoId: string,
  count: number,
  channelId?: string,
): VectorRecord[] {
  return generationIds(videoId, GEN, count).map((id, index) => ({
    id,
    values: axis(index % 8),
    metadata: {
      ...metadata(videoId, channelId),
      startSec: index * 60,
      endSec: index * 60 + 60,
    },
  }));
}

const fake = () => vectorStore({ VECTORIZE_FAKE: "{}" });

describe("vector ids", () => {
  it("round-trips and rejects malformed ids", () => {
    const id = vectorId(VIDEO, GEN, 7);
    expect(id).toBe(`${VIDEO}:${GEN}:7`);
    expect(parseVectorId(id)).toEqual({
      videoId: VIDEO,
      generationId: GEN,
      index: 7,
    });
    expect(generationIds(VIDEO, GEN, 3)).toEqual([
      `${VIDEO}:${GEN}:0`,
      `${VIDEO}:${GEN}:1`,
      `${VIDEO}:${GEN}:2`,
    ]);
    for (const bad of [
      "",
      "nope",
      `${VIDEO}:${GEN}`,
      `short:${GEN}:0`,
      `${VIDEO}:${GEN}:x`,
      `${VIDEO}:a:b:0`,
    ]) {
      expect(parseVectorId(bad)).toBeNull();
    }
  });
});

describe("the vector store", () => {
  it("upserts, reads back, queries with a channel filter, and deletes a generation", async () => {
    const store = fake();
    await store.upsert(SHARED_NAMESPACE, records(VIDEO, 3));
    await store.upsert(
      SHARED_NAMESPACE,
      records(OTHER, 2, "UCBBBBBBBBBBBBBBBBBBBBBB"),
    );
    const ids = generationIds(VIDEO, GEN, 3);
    expect(
      await store.getByIds(SHARED_NAMESPACE, [...ids, `${VIDEO}:${GEN}:9`]),
    ).toEqual(ids);

    const all = await store.query(SHARED_NAMESPACE, axis(0), { topK: 10 });
    expect(all[0]?.id).toBe(`${VIDEO}:${GEN}:0`);
    expect(all.map((m) => m.id)).toContain(`${OTHER}:${GEN}:0`);
    const filtered = await store.query(SHARED_NAMESPACE, axis(0), {
      topK: 10,
      filter: { channelId: { $in: ["UCBBBBBBBBBBBBBBBBBBBBBB"] } },
    });
    expect(filtered.map((m) => m.metadata.channelId)).toEqual([
      "UCBBBBBBBBBBBBBBBBBBBBBB",
      "UCBBBBBBBBBBBBBBBBBBBBBB",
    ]);
    expect(filtered[0]).toMatchObject({
      id: `${OTHER}:${GEN}:0`,
      score: 1,
      metadata: { videoId: OTHER },
    });

    await store.deleteByIds(SHARED_NAMESPACE, ids);
    expect(await store.getByIds(SHARED_NAMESPACE, ids)).toEqual([]);
    expect(fakeVectorIds()).toEqual(generationIds(OTHER, GEN, 2));
  });

  it("writes exactly one namespace, which is what lets `clean-local` wipe the dev index whole", () => {
    // `wrangler vectorize list-vectors` returns ids without namespaces and `delete-vectors` takes none, so
    // the skill's wipe is index-wide. That is namespace-scoped in substance only while this holds (hard
    // rule 3). If a second namespace is ever added, this fails and the skill needs rethinking first.
    expect(SHARED_NAMESPACE).toBe("shared-catalog");
  });

  it("refuses every other namespace, ids that do not match their metadata, and an oversized topK", async () => {
    const store = fake();
    const ns = "alice@example.com" as never;
    await expect(store.upsert(ns, records(VIDEO, 1))).rejects.toThrow(
      /namespace must be shared-catalog/,
    );
    await expect(store.getByIds(ns, [vectorId(VIDEO, GEN, 0)])).rejects.toThrow(
      /namespace/,
    );
    await expect(store.query(ns, axis(0), { topK: 3 })).rejects.toThrow(
      /namespace/,
    );
    await expect(
      store.deleteByIds(ns, [vectorId(VIDEO, GEN, 0)]),
    ).rejects.toThrow(/namespace/);
    await expect(
      store.upsert(SHARED_NAMESPACE, [
        {
          id: vectorId(OTHER, GEN, 0),
          values: axis(0),
          metadata: metadata(VIDEO),
        },
      ]),
    ).rejects.toThrow(/does not belong/);
    await expect(
      store.upsert(SHARED_NAMESPACE, [
        { id: "not-an-id", values: axis(0), metadata: metadata(VIDEO) },
      ]),
    ).rejects.toThrow(/does not belong/);
    await expect(
      store.query(SHARED_NAMESPACE, axis(0), { topK: QUERY_TOP_K_MAX + 1 }),
    ).rejects.toThrow(/topK/);
    await expect(
      store.query(SHARED_NAMESPACE, axis(0), { topK: 0 }),
    ).rejects.toThrow(/topK/);
  });

  it("drops ids stored in another namespace on read and never deletes an id it did not confirm", async () => {
    const deleted: string[][] = [];
    const fetched: string[][] = [];
    // A stub index holding one vector in our namespace and one, with an id of our shape, elsewhere.
    const stub = {
      async getByIds(ids: string[]) {
        fetched.push(ids);
        return ids.flatMap((id) =>
          id === vectorId(VIDEO, GEN, 0)
            ? [
                {
                  id,
                  values: axis(0),
                  namespace: SHARED_NAMESPACE,
                  metadata: metadata(VIDEO),
                },
              ]
            : id === vectorId(VIDEO, GEN, 1)
              ? [
                  {
                    id,
                    values: axis(1),
                    namespace: "someone-else",
                    metadata: metadata(VIDEO),
                  },
                ]
              : [],
        );
      },
      async deleteByIds(ids: string[]) {
        deleted.push(ids);
        return { mutationId: "m" };
      },
    } as unknown as Vectorize;
    const store = realStore(stub);
    const ids = generationIds(VIDEO, GEN, 3);
    expect(await store.getByIds(SHARED_NAMESPACE, ids)).toEqual([
      vectorId(VIDEO, GEN, 0),
    ]);
    await store.deleteByIds(SHARED_NAMESPACE, ids);
    expect(deleted).toEqual([[vectorId(VIDEO, GEN, 0)]]);
    // Batches stay under the ceiling.
    fetched.length = 0;
    await store.getByIds(
      SHARED_NAMESPACE,
      generationIds(VIDEO, GEN, GET_BY_IDS_BATCH * 2 + 1),
    );
    expect(fetched.map((batch) => batch.length)).toEqual([
      GET_BY_IDS_BATCH,
      GET_BY_IDS_BATCH,
      1,
    ]);
  });

  it("splits upserts into batches under the ceiling", async () => {
    const sizes: number[] = [];
    const stub = {
      async upsert(vectors: unknown[]) {
        sizes.push(vectors.length);
        return { mutationId: "m" };
      },
    } as unknown as Vectorize;
    await realStore(stub).upsert(
      SHARED_NAMESPACE,
      records(VIDEO, UPSERT_BATCH + 5),
    );
    expect(sizes).toEqual([UPSERT_BATCH, 5]);
  });

  it("simulates asynchronous visibility: the configured number of reads miss new ids, then all appear", async () => {
    const store = vectorStore({
      VECTORIZE_FAKE: JSON.stringify({ visibilityDelayReads: 2 }),
    });
    const ids = generationIds(VIDEO, GEN, 2);
    await store.upsert(SHARED_NAMESPACE, records(VIDEO, 2));
    expect(await store.getByIds(SHARED_NAMESPACE, ids)).toEqual([]);
    expect(await store.getByIds(SHARED_NAMESPACE, ids)).toEqual([]);
    expect(await store.getByIds(SHARED_NAMESPACE, ids)).toEqual(ids);
  });

  it("can be told to fail one method, for the cleanup and related-lookup failure paths", async () => {
    const store = vectorStore({
      VECTORIZE_FAKE: JSON.stringify({ throwOn: ["deleteByIds", "query"] }),
    });
    await store.upsert(SHARED_NAMESPACE, records(VIDEO, 1));
    await expect(
      store.deleteByIds(SHARED_NAMESPACE, generationIds(VIDEO, GEN, 1)),
    ).rejects.toThrow(/configured to fail/);
    await expect(
      store.query(SHARED_NAMESPACE, axis(0), { topK: 1 }),
    ).rejects.toThrow(/configured to fail/);
    expect(
      await store.getByIds(SHARED_NAMESPACE, generationIds(VIDEO, GEN, 1)),
    ).toHaveLength(1);
    resetVectorFake();
    expect(fakeVectorIds()).toEqual([]);
  });

  it("requires a binding or the fake", () => {
    expect(() => vectorStore({})).toThrow(/VECTORS binding/);
  });
});
