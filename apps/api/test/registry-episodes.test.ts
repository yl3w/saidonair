import { describe, expect, it } from "vitest";
import type { DigestSelection } from "../src/do/registry/types";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  channelIds,
  declineAs,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  episodeIds,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
  seedAttempt,
  seedEpisode,
  seedSummary,
} from "./helpers";

async function twoChannels() {
  const stub = registry();
  await seedApprovedChannel(CHANNEL_A, "A");
  await seedApprovedChannel(CHANNEL_B, "B");
  return stub;
}

/** The whole range, one page: what a caller passes when it wants no bounds at all. */
function page(over: Partial<DigestSelection> = {}): DigestSelection {
  return { fromMs: null, toMs: null, after: null, limit: 50, ...over };
}

describe("registry episodes", () => {
  it("lists the digest newest first, in the window, with summaries, for the given channels only", async () => {
    const stub = await twoChannels();
    await seedEpisode(EPISODE_A, CHANNEL_A, { publishedAt: 3_000 });
    await seedSummary(EPISODE_A, {
      takeaways: [
        { text: "one", startSec: 5 },
        { text: "two", startSec: null },
      ],
      relatedEpisodeIds: [EPISODE_B, EPISODE_C, EPISODE_A],
    });
    await seedEpisode(EPISODE_B, CHANNEL_A, { publishedAt: 2_000 });
    await seedSummary(EPISODE_B, { format: "raw_fallback", rawText: "raw" });
    await seedEpisode(EPISODE_C, CHANNEL_B, { publishedAt: 2_500 });
    await seedSummary(EPISODE_C);
    await seedEpisode("old00000000", CHANNEL_A, { publishedAt: 500 });
    await seedSummary("old00000000");
    await seedEpisode("nosummary00", CHANNEL_A, { publishedAt: 4_000 });
    await seedEpisode("pending0000", CHANNEL_A, {
      publishedAt: 5_000,
      status: "pending",
    });

    const digest = await stub.listDigest([CHANNEL_A], page({ fromMs: 1_000 }));

    expect(digest.map((e) => e.episodeId)).toEqual([EPISODE_A, EPISODE_B]);
    expect(digest[0]).toMatchObject({
      channelTitle: "A",
      status: "available",
      summaryAvailableAt: 3_000,
      summary: {
        format: "structured",
        takeaways: [
          { text: "one", startSec: 5 },
          { text: "two", startSec: null },
        ],
        topicTags: ["tag"],
      },
      // EPISODE_C belongs to channel B, outside the scope; the episode never relates to itself.
      related: [{ episodeId: EPISODE_B, title: `Episode ${EPISODE_B}` }],
    });
    expect(digest[1]?.summary).toEqual({
      format: "raw_fallback",
      rawText: "raw",
    });

    const both = await stub.listDigest(
      [CHANNEL_A, CHANNEL_B],
      page({ fromMs: 1_000 }),
    );
    expect(both.map((e) => e.episodeId)).toEqual([
      EPISODE_A,
      EPISODE_C,
      EPISODE_B,
    ]);
    expect(both[0]?.related.map((r) => r.episodeId)).toEqual([
      EPISODE_B,
      EPISODE_C,
    ]);

    expect(await stub.listDigest([], page())).toEqual([]);
    await expectDomainError(
      stub.listDigest([CHANNEL_A], page({ fromMs: -1 })),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.listDigest([CHANNEL_A], page({ limit: 0 })),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.listDigest([CHANNEL_A], page({ limit: 201 })),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.listDigest(
        [CHANNEL_A],
        page({ after: { summaryAvailableAt: 1, episodeId: "nope" } }),
      ),
      "INVALID_INPUT",
    );
    await expectDomainError(stub.listDigest(["nope"], page()), "INVALID_INPUT");
  });

  it("orders the digest by first availability, not publication, and bounds the range on it", async () => {
    const stub = await twoChannels();
    // Published a month ago, summarised just now: today's digest. Published today, summarised earlier: behind it.
    await seedEpisode(EPISODE_A, CHANNEL_A, {
      publishedAt: 1_000,
      processedAt: 5_000,
    });
    await seedSummary(EPISODE_A);
    await seedEpisode(EPISODE_B, CHANNEL_A, {
      publishedAt: 9_000,
      processedAt: 4_000,
    });
    await seedSummary(EPISODE_B);
    await seedEpisode(EPISODE_C, CHANNEL_A, {
      publishedAt: 9_500,
      processedAt: 4_000,
    });
    await seedSummary(EPISODE_C);
    const ids = async (over: Partial<DigestSelection> = {}) =>
      (await stub.listDigest([CHANNEL_A], page(over))).map((e) => e.episodeId);

    expect(await ids()).toEqual([EPISODE_A, EPISODE_B, EPISODE_C]);
    expect(await ids({ fromMs: 4_500 })).toEqual([EPISODE_A]);
    // `from` is inclusive and `to` exclusive, so a reader's consecutive local days never overlap.
    expect(await ids({ fromMs: 4_000, toMs: 5_000 })).toEqual([
      EPISODE_B,
      EPISODE_C,
    ]);
    expect(await ids({ fromMs: 5_000 })).toEqual([EPISODE_A]);
    expect(await ids({ toMs: 4_000 })).toEqual([]);
    expect(
      (await stub.listDigest([CHANNEL_A], page()))[0]?.summaryAvailableAt,
    ).toBe(5_000);
  });

  it("pages the digest by cursor position, and answers the same page as compact rows", async () => {
    const stub = await twoChannels();
    // Five summaries sharing two availability times, so the video-id tiebreak carries the order.
    const ids = [
      "aa000000001",
      "aa000000002",
      "bb000000003",
      "bb000000004",
      "cc000000005",
    ];
    for (const [index, episodeId] of ids.entries()) {
      await seedEpisode(episodeId, index < 3 ? CHANNEL_A : CHANNEL_B, {
        publishedAt: 100 + index,
        processedAt: index < 2 ? 9_000 : index < 4 ? 8_000 : 7_000,
      });
      await seedSummary(episodeId);
    }
    const both = [CHANNEL_A, CHANNEL_B];
    const ordered = [
      "aa000000001",
      "aa000000002",
      "bb000000003",
      "bb000000004",
      "cc000000005",
    ];

    expect(
      (await stub.listDigest(both, page())).map((e) => e.episodeId),
    ).toEqual(ordered);

    // Two pages of two and one of one, walked by position: no overlap, no gap.
    const walked: string[] = [];
    let after = null as DigestSelection["after"];
    for (let read = 0; read < 3; read++) {
      const rows = await stub.listDigestRows(both, page({ after, limit: 2 }));
      walked.push(...rows.map((row) => row.episodeId));
      const last = rows.at(-1);
      after = last
        ? {
            summaryAvailableAt: last.summaryAvailableAt,
            episodeId: last.episodeId,
          }
        : null;
    }
    expect(walked).toEqual(ordered);
    expect(await stub.listDigestRows(both, page({ after, limit: 2 }))).toEqual(
      [],
    );

    // The compact row carries the day and the channel, and nothing else the calendar cannot use.
    const rows = await stub.listDigestRows(both, page({ limit: 1 }));
    expect(rows).toEqual([
      {
        episodeId: "aa000000001",
        channelId: CHANNEL_A,
        summaryAvailableAt: 9_000,
      },
    ]);
  });

  it("counts by status and lists available ids across more than one parameter batch", async () => {
    const stub = await twoChannels();
    const ids = episodeIds(120);
    for (const [i, episodeId] of ids.entries()) {
      await seedEpisode(episodeId, CHANNEL_A, {
        publishedAt: i,
        status: i < 110 ? "available" : "failed",
      });
    }
    await seedEpisode(EPISODE_A, CHANNEL_B, { status: "failed" });
    await seedEpisode(EPISODE_B, CHANNEL_B, { status: "pending" });

    // 1,000 channel ids, most of them absent: the IN lists are chunked under the 100-binding cap.
    const many = [...channelIds(998), CHANNEL_A, CHANNEL_B];
    const available = await stub.listAvailableEpisodeIds(many);
    expect(available).toHaveLength(110);
    expect(new Set(available.map((p) => p.channelId))).toEqual(
      new Set([CHANNEL_A]),
    );

    const counts = await stub.countEpisodesByChannel(many);
    expect(counts[CHANNEL_A]).toEqual({
      available: 110,
      pending: 0,
      failed: 10,
      skipped: 0,
    });
    // A plain group-by on status: no `waiting` count (wait reasons live on episode rows).
    expect(counts[CHANNEL_B]).toEqual({
      available: 0,
      pending: 1,
      failed: 1,
      skipped: 0,
    });
    expect(counts[many[0] ?? ""]).toMatchObject({ available: 0 });
    expect(Object.keys(counts)).toHaveLength(1000);
  });

  it("lists one channel's episodes in every status with processing detail and a limit", async () => {
    const stub = await twoChannels();
    await seedEpisode(EPISODE_A, CHANNEL_A, {
      publishedAt: 3_000,
      chunkCount: 7,
    });
    await seedSummary(EPISODE_A, { relatedEpisodeIds: [EPISODE_C] });
    await seedEpisode(EPISODE_B, CHANNEL_A, {
      publishedAt: 2_000,
      status: "failed",
      failureDetail: "CAPTIONS",
      attemptCount: 3,
    });
    await seedEpisode(EPISODE_C, CHANNEL_B, { publishedAt: 1_000 });
    await seedSummary(EPISODE_C);
    await seedEpisode("skipowner01", CHANNEL_A, {
      publishedAt: 500,
      status: "skipped",
      skipReason: "OWNER",
    });

    const all = await stub.listEpisodes(CHANNEL_A, {
      relatedScope: [CHANNEL_B],
    });
    expect(all.map((e) => e.episodeId)).toEqual([
      EPISODE_A,
      EPISODE_B,
      "skipowner01",
    ]);
    expect(all[0]).toMatchObject({
      summary: { format: "structured" },
      related: [{ episodeId: EPISODE_C }],
      processing: { chunkCount: 7, attemptCount: 1 },
    });
    // A timed-out publication: the one failure code, with the latest attempt's reason as detail.
    expect(all[1]).toMatchObject({
      status: "failed",
      summary: null,
      related: [],
      summaryAvailableAt: null,
      processing: {
        failureCode: "INGESTION_TIMEOUT",
        failureDetail: "CAPTIONS",
        attemptCount: 3,
        chunkCount: null,
        latestAttempt: null,
      },
    });
    // An owner-skip records the reason and, by the CHECK's own contract, the owner's email.
    expect(all[2]).toMatchObject({
      status: "skipped",
      skipReason: "OWNER",
      processing: { skippedByEmail: OWNER },
    });

    // Related titles outside the scope are dropped, not exposed.
    const narrow = await stub.listEpisodes(CHANNEL_A, { relatedScope: [] });
    expect(narrow[0]?.related).toEqual([]);

    const one = await stub.listEpisodes(CHANNEL_A, {
      limit: 1,
      relatedScope: [],
    });
    expect(one.map((e) => e.episodeId)).toEqual([EPISODE_A]);

    await expectDomainError(
      stub.listEpisodes(CHANNEL_A, { limit: 0, relatedScope: [] }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.listEpisodes(CHANNEL_A, { limit: 201, relatedScope: [] }),
      "INVALID_INPUT",
    );
    expect(
      await stub.listEpisodes(CHANNEL_B, { relatedScope: [] }),
    ).toHaveLength(1);
  });

  it("retry reopens a failed or skipped episode; skip closes a failed one and records whoever skipped; both refuse an active run", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, {
      status: "failed",
      attemptCount: 3,
      failureDetail: "PROVIDER_HTTP",
    });
    await seedEpisode(EPISODE_B, CHANNEL_A, {
      status: "skipped",
      skipReason: "SHORT",
    });
    await seedEpisode(EPISODE_C, CHANNEL_A, { status: "available" });
    await seedSummary(EPISODE_C);

    // No role is checked: whoever skips is recorded (PRD §9).
    const skipped = await stub.skipEpisode(ALICE, CHANNEL_A, EPISODE_A);
    expect(skipped.status).toBe("skipped");
    expect(skipped.skipReason).toBe("OWNER");
    expect(skipped.processing).toMatchObject({ skippedByEmail: ALICE });
    // Retry opens a fresh 48-hour `publish` window; nothing launches until M3.
    const retried = await stub.retryEpisode(CHANNEL_A, EPISODE_A);
    expect(retried.status).toBe("pending");
    expect(retried.skipReason).toBeNull();
    expect(retried.processing).toMatchObject({
      attemptCount: 0,
      failureCode: null,
      failureDetail: null,
      skippedAt: null,
      skippedByEmail: null,
      intent: "publish",
      windowStartedAt: expect.any(Number),
      windowDeadlineAt: expect.any(Number),
      nextAttemptAt: expect.any(Number),
    });
    expect(
      (retried.processing.windowDeadlineAt ?? 0) -
        (retried.processing.windowStartedAt ?? 0),
    ).toBe(48 * 60 * 60 * 1000);
    expect((await stub.retryEpisode(CHANNEL_A, EPISODE_B)).status).toBe(
      "pending",
    );
    // A retry touches one episode: the siblings keep their status and their summaries (spec §3.3).
    const siblings = await stub.listEpisodes(CHANNEL_A, { relatedScope: [] });
    expect(siblings.find((e) => e.episodeId === EPISODE_C)).toMatchObject({
      status: "available",
      summary: {
        format: "structured",
        executiveSummary: `Summary of ${EPISODE_C}`,
      },
    });
    await expectDomainError(
      stub.skipEpisode(OWNER, CHANNEL_A, EPISODE_C),
      "INVALID_STATE",
    );
    // Retry of an available episode opens a `replace` window and leaves its content in place.
    const replacing = await stub.retryEpisode(CHANNEL_A, EPISODE_C);
    expect(replacing).toMatchObject({
      status: "available",
      summary: { format: "structured" },
      summaryAvailableAt: 1,
      processing: { intent: "replace", attemptCount: 0 },
    });
    await expectDomainError(
      stub.retryEpisode(CHANNEL_B, EPISODE_A),
      "NOT_FOUND",
    );

    // A running attempt is the one thing that refuses Retry; channel status never does, and Skip
    // works in any channel status too (PRD §4.2 rules 16–18).
    await seedEpisode("ddddddddddd", CHANNEL_A, { status: "failed" });
    await seedAttempt("ddddddddddd", { status: "running" });
    await expectDomainError(
      stub.retryEpisode(CHANNEL_A, "ddddddddddd"),
      "INVALID_STATE",
    );
    await declineAs(OWNER, CHANNEL_A);
    expect(
      (await stub.skipEpisode(OWNER, CHANNEL_A, "ddddddddddd")).status,
    ).toBe("skipped");
    await seedEpisode("eeeeeeeeeee", CHANNEL_A, { status: "skipped" });
    expect((await stub.retryEpisode(CHANNEL_A, "eeeeeeeeeee")).status).toBe(
      "pending",
    );
  });
});

describe("episode states by id", () => {
  it("answers each state in the order asked, skipping ids the catalog does not hold", async () => {
    const reg = registry();
    await seedApprovedChannel(CHANNEL_A, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_A);
    await seedEpisode(EPISODE_B, CHANNEL_A, { status: "pending" });

    // Asked out of storage order, with an id that is not in the catalog between them.
    const states = await reg.listEpisodeStates([
      EPISODE_B,
      EPISODE_C,
      EPISODE_A,
    ]);

    expect(states.map((state) => state.episodeId)).toEqual([
      EPISODE_B,
      EPISODE_A,
    ]);
    expect(states[0]).toMatchObject({
      status: "pending",
      channelId: CHANNEL_A,
    });
    expect(states[1]).toMatchObject({
      status: "available",
      channelId: CHANNEL_A,
    });
  });

  it("carries the active vector generation chat validates against", async () => {
    const reg = registry();
    await seedApprovedChannel(CHANNEL_B, OWNER);
    await seedEpisode(EPISODE_A, CHANNEL_B);
    await seedSummary(EPISODE_A);

    const [state] = await reg.listEpisodeStates([EPISODE_A]);
    expect(state?.activeVectorGeneration).toEqual(expect.any(String));
  });

  it("holds together past the bound-parameter ceiling", async () => {
    const reg = registry();
    const ids = episodeIds(150);
    await seedApprovedChannel(CHANNEL_A, OWNER);
    for (const id of ids.slice(0, 120)) await seedEpisode(id, CHANNEL_A);

    const states = await reg.listEpisodeStates(ids);
    expect(states).toHaveLength(120);
    expect(states.map((state) => state.episodeId)).toEqual(ids.slice(0, 120));
  });

  it("rejects a malformed id rather than skipping it", async () => {
    await expectDomainError(
      registry().listEpisodeStates(["not-an-episode"]),
      "INVALID_INPUT",
    );
  });
});
