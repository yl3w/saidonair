import {
  introspectWorkflowInstance,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { chunkTranscript } from "../src/lib/chunk";
import type { TranscriptResult } from "../src/lib/transcripts/types";
import {
  fakeVectorIds,
  generationIds,
  SHARED_NAMESPACE,
  vectorStore,
} from "../src/lib/vectorize";
import {
  classify,
  ingestAttempt,
  TRANSCRIPT_STEP,
  UPSERT_STEP,
  VERIFY_DELAYS_SEC,
} from "../src/workflows/ingest";
import { fakeStep, stepNames } from "./fake-step";
import {
  EPISODE_AUTH_FAILS,
  EPISODE_ENGLISH,
  EPISODE_HTTP_FAILS,
  EPISODE_LIMIT_FAILS,
  EPISODE_LIVE,
  EPISODE_NO_CAPTIONS,
  EPISODE_NON_ENGLISH,
  EPISODE_PARSE_FAILS,
  EPISODE_RATE_LIMITED,
  EPISODE_SHORT,
  EPISODE_UNPLAYABLE,
  englishSegments,
  FAKE_TRANSCRIPTS,
  type FakeTranscriptEntry,
} from "./fixtures/transcripts";
import {
  ALICE,
  CHANNEL_A,
  EPISODE_B,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  userDO,
} from "./helpers";

const ENGLISH_CHUNKS = chunkTranscript(englishSegments()).length;

function inRegistry<T>(work: (sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(registry(), (_, ctx) => work(ctx.storage.sql));
}

function generations(episodeId: string) {
  return inRegistry((sql) =>
    sql
      .exec<{ active: string | null; staged: string | null }>(
        "SELECT active_vector_generation AS active, staged_vector_generation AS staged FROM episodes WHERE episode_id = ?",
        episodeId,
      )
      .one(),
  );
}

function storedRelated(episodeId: string) {
  return inRegistry(
    (sql) =>
      sql
        .exec<{ related: string }>(
          "SELECT related_episode_ids_json AS related FROM episode_summaries WHERE episode_id = ?",
          episodeId,
        )
        .one().related,
  );
}

async function pendingNow(episodeId: string) {
  await seedEpisode(episodeId, CHANNEL_A, {
    status: "pending",
    window: { intent: "publish", startedAt: Date.now() },
  });
}

async function begin(
  episodeId: string,
  trigger: "channel_ingestion" | "owner_retry" = "channel_ingestion",
) {
  const start = await registry().beginAttempt(
    episodeId,
    trigger,
    trigger === "owner_retry" ? OWNER : undefined,
  );
  if (start.kind !== "started") throw new Error("expected a started attempt");
  return start.attempt.attemptId;
}

async function run(episodeId: string, attemptId: string, startDelaySec = 0) {
  const step = fakeStep();
  const result = await ingestAttempt(step, env, {
    attemptId,
    episodeId,
    channelId: CHANNEL_A,
    startDelaySec,
  });
  return { step, result };
}

/** Registers one more canned video for a test, restored by `afterEach`. */
function withEpisode(episodeId: string, entry: FakeTranscriptEntry) {
  env.TRANSCRIPTS_FAKE = JSON.stringify({
    ...FAKE_TRANSCRIPTS,
    episodes: { ...FAKE_TRANSCRIPTS.episodes, [episodeId]: entry },
  });
}

const english = (
  segments = englishSegments(),
  durationSec = 600,
): FakeTranscriptEntry => ({
  segments,
  durationSec,
  captionStatus: "english",
});

afterEach(() => {
  env.AI_FAKE = "{}";
  env.VECTORIZE_FAKE = "{}";
  env.TRANSCRIPTS_FAKE = JSON.stringify(FAKE_TRANSCRIPTS);
});

describe("classify", () => {
  const result = (over: Partial<TranscriptResult>) => ({
    result: {
      segments: englishSegments(3),
      durationSec: 600,
      captionStatus: "english" as const,
      ...over,
    },
  });
  it("orders duration before captions, and never calls an unknown duration short", () => {
    expect(classify(result({}))).toMatchObject({ kind: "process" });
    expect(
      classify(
        result({ durationSec: 179, captionStatus: "none", segments: null }),
      ),
    ).toEqual({
      kind: "finish",
      outcome: { status: "skipped", code: "SHORT" },
    });
    expect(classify(result({ durationSec: 180 }))).toMatchObject({
      kind: "process",
    });
    expect(
      classify(
        result({ durationSec: null, captionStatus: "none", segments: null }),
      ),
    ).toEqual({
      kind: "finish",
      outcome: { status: "waiting", code: "CAPTIONS" },
    });
    expect(
      classify(result({ captionStatus: "non_english", segments: null })),
    ).toEqual({
      kind: "finish",
      outcome: { status: "skipped", code: "NON_ENGLISH" },
    });
    expect(classify(result({ captionStatus: "none", segments: null }))).toEqual(
      {
        kind: "finish",
        outcome: { status: "waiting", code: "CAPTIONS" },
      },
    );
  });

  it("maps provider failures: unplayable skips, exhausted credits wait, the rest fail", () => {
    expect(classify({ failure: "UNPLAYABLE" })).toEqual({
      kind: "finish",
      outcome: { status: "skipped", code: "UNPLAYABLE" },
    });
    expect(classify({ failure: "PROVIDER_LIMIT" })).toEqual({
      kind: "finish",
      outcome: { status: "waiting", code: "PROVIDER_LIMIT" },
    });
    for (const code of [
      "PROVIDER_AUTH",
      "PROVIDER_RATE_LIMIT",
      "PROVIDER_HTTP",
      "PROVIDER_PARSE",
    ] as const) {
      expect(classify({ failure: code })).toEqual({
        kind: "finish",
        outcome: { status: "failed", code },
      });
    }
    expect(classify({ tooLarge: true, durationSec: 100 })).toEqual({
      kind: "finish",
      outcome: { status: "failed", code: "TRANSCRIPT_TOO_LARGE" },
    });
  });
});

describe("ingestAttempt", () => {
  it("publishes an English episode: transcript, stage, verify, summarize, related, publish", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    const attemptId = await begin(EPISODE_ENGLISH);
    const { staged } = await generations(EPISODE_ENGLISH);

    const { step, result } = await run(EPISODE_ENGLISH, attemptId);

    expect(result).toEqual({
      attemptId,
      ended: "published",
      chunkCount: ENGLISH_CHUNKS,
      replaced: false,
    });
    expect(stepNames(step)).toEqual([
      "load",
      "transcript",
      "stage",
      "stage:0",
      "verify:0",
      "summarize:0",
      "related",
      "publish",
    ]);
    expect(step.sleeps).toEqual([]);
    const episode = await registry().getEpisode(CHANNEL_A, EPISODE_ENGLISH);
    expect(episode).toMatchObject({
      status: "available",
      summaryAvailableAt: expect.any(Number),
      summary: {
        format: "structured",
        topicTags: ["canned", "test"],
      },
      processing: {
        chunkCount: ENGLISH_CHUNKS,
        intent: null,
        latestAttempt: {
          attemptId,
          status: "available",
          stagedChunkCount: ENGLISH_CHUNKS,
        },
      },
    });
    // The runtime reaches the episode from the transcript step, and is what the takeaway budget of a
    // reduced summary is computed from (lib/summary.ts takeawayBudget).
    expect(episode?.processing.durationSec).toBeGreaterThan(0);
    const summary = episode?.summary;
    if (summary?.format !== "structured")
      throw new Error("expected a structured summary");
    // The fake echoes the transcript's own markers, so the takeaways point at real chunk times.
    // The fake echoes the transcript's own markers: the first three chunks' starts.
    expect(summary.takeaways.map((t) => t.startSec)).toEqual(
      chunkTranscript(englishSegments())
        .slice(0, 3)
        .map((c) => Math.floor(c.startSec)),
    );
    expect(fakeVectorIds().sort()).toEqual(
      generationIds(EPISODE_ENGLISH, staged ?? "", ENGLISH_CHUNKS).sort(),
    );
    expect(await generations(EPISODE_ENGLISH)).toEqual({
      active: staged,
      staged: null,
    });
  });

  it("sleeps the stagger first when asked", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    const { step } = await run(
      EPISODE_ENGLISH,
      await begin(EPISODE_ENGLISH),
      6,
    );
    expect(step.sleeps).toEqual([{ name: "stagger", seconds: 6 }]);
  });

  it.each([
    [EPISODE_SHORT, "skipped", "SHORT", "skipped", 1],
    [EPISODE_NON_ENGLISH, "skipped", "NON_ENGLISH", "skipped", 1],
    [EPISODE_UNPLAYABLE, "skipped", "UNPLAYABLE", "skipped", 1],
    // A live or upcoming video is a deterministic skip, one provider call, window closed.
    [EPISODE_LIVE, "skipped", "UNPLAYABLE", "skipped", 1],
    [EPISODE_NO_CAPTIONS, "waiting", "CAPTIONS", "pending", 1],
    [EPISODE_LIMIT_FAILS, "waiting", "PROVIDER_LIMIT", "pending", 1],
    [EPISODE_AUTH_FAILS, "failed", "PROVIDER_AUTH", "pending", 1],
    [
      EPISODE_HTTP_FAILS,
      "failed",
      "PROVIDER_HTTP",
      "pending",
      (TRANSCRIPT_STEP.retries?.limit ?? 0) + 1,
    ],
    [
      EPISODE_RATE_LIMITED,
      "failed",
      "PROVIDER_RATE_LIMIT",
      "pending",
      (TRANSCRIPT_STEP.retries?.limit ?? 0) + 1,
    ],
    [
      EPISODE_PARSE_FAILS,
      "failed",
      "PROVIDER_PARSE",
      "pending",
      (TRANSCRIPT_STEP.retries?.limit ?? 0) + 1,
    ],
  ] as const)(
    "%s finishes %s %s and leaves the episode %s",
    async (episodeId, status, code, episodeStatus, transcriptAttempts) => {
      await seedApprovedChannel(CHANNEL_A, "A");
      await pendingNow(episodeId);
      const attemptId = await begin(episodeId);
      const { step, result } = await run(episodeId, attemptId);
      expect(result).toEqual({
        attemptId,
        ended: "finished",
        outcome: { status, code },
      });
      expect(stepNames(step)).toEqual(["load", "transcript", "finish"]);
      expect(step.calls.find((c) => c.name === "transcript")?.attempts).toBe(
        transcriptAttempts,
      );
      const episode = await registry().getEpisode(CHANNEL_A, episodeId);
      expect(episode?.status).toBe(episodeStatus);
      expect(episode?.processing.latestAttempt).toMatchObject({
        attemptId,
        status,
        outcomeCode: code,
      });
      expect(episode?.processing.failureCode).toBeNull();
      if (episodeStatus === "pending")
        expect(episode?.processing.nextAttemptAt).toEqual(expect.any(Number));
      expect(fakeVectorIds()).toEqual([]);
    },
  );

  it("finishes EMBEDDING_FAILED after the step's retries and leaves the staged count behind", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    const attemptId = await begin(EPISODE_ENGLISH);
    env.AI_FAKE = JSON.stringify({ embedThrows: true });
    const { step, result } = await run(EPISODE_ENGLISH, attemptId);
    expect(result).toMatchObject({
      ended: "finished",
      outcome: { status: "failed", code: "EMBEDDING_FAILED" },
    });
    expect(step.calls.find((c) => c.name === "stage:0")?.attempts).toBe(
      (UPSERT_STEP.retries?.limit ?? 0) + 1,
    );
    const episode = await registry().getEpisode(CHANNEL_A, EPISODE_ENGLISH);
    expect(episode?.status).toBe("pending");
    expect(episode?.processing.latestAttempt).toMatchObject({
      outcomeCode: "EMBEDDING_FAILED",
      stagedChunkCount: ENGLISH_CHUNKS,
    });
    expect(episode?.processing.nextAttemptAt).toEqual(expect.any(Number));
  });

  it("finishes VECTORIZE_INCOMPLETE when an upsert fails, and when the generation never becomes readable", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    env.VECTORIZE_FAKE = JSON.stringify({ throwOn: ["upsert"] });
    const first = await run(EPISODE_ENGLISH, await begin(EPISODE_ENGLISH));
    expect(first.result).toMatchObject({
      outcome: { status: "failed", code: "VECTORIZE_INCOMPLETE" },
    });

    env.VECTORIZE_FAKE = JSON.stringify({ visibilityDelayReads: 1_000 });
    const second = await run(EPISODE_ENGLISH, await begin(EPISODE_ENGLISH));
    expect(second.result).toMatchObject({
      outcome: { status: "failed", code: "VECTORIZE_INCOMPLETE" },
    });
    const checks = stepNames(second.step).filter((n) =>
      n.startsWith("verify:"),
    );
    expect(checks).toHaveLength(VERIFY_DELAYS_SEC.length + 1);
    expect(second.step.sleeps.map((s) => s.seconds)).toEqual([
      ...VERIFY_DELAYS_SEC,
    ]);
    expect(second.step.sleeps[0]?.name).toBe("verify-wait:0");
  });

  it("retries an invalid summary once, falls back to raw text when it stays invalid, and fails when the model does", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const marked = (marker: string) =>
      english(
        englishSegments(120).map((s, i) =>
          i === 0 ? { ...s, text: `${s.text} ${marker}` } : s,
        ),
      );

    withEpisode("invalidonce", marked("[[invalid-once]]"));
    await pendingNow("invalidonce");
    const once = await run("invalidonce", await begin("invalidonce"));
    expect(once.result).toMatchObject({ ended: "published" });
    expect(stepNames(once.step)).toContain("summarize:0:retry");
    expect(
      (await registry().getEpisode(CHANNEL_A, "invalidonce"))?.summary?.format,
    ).toBe("structured");

    withEpisode("invalidalwy", marked("[[invalid]]"));
    await pendingNow("invalidalwy");
    const always = await run("invalidalwy", await begin("invalidalwy"));
    expect(always.result).toMatchObject({ ended: "published" });
    const fallback = (await registry().getEpisode(CHANNEL_A, "invalidalwy"))
      ?.summary;
    expect(fallback).toMatchObject({ format: "raw_fallback" });
    if (fallback?.format === "raw_fallback")
      expect(fallback.rawText).toMatch(/cannot produce/);

    withEpisode("throwsummar", marked("[[throw]]"));
    await pendingNow("throwsummar");
    const failed = await run("throwsummar", await begin("throwsummar"));
    expect(failed.result).toMatchObject({
      outcome: { status: "failed", code: "SUMMARY_FAILED" },
    });
    expect(
      (await registry().getEpisode(CHANNEL_A, "throwsummar"))?.status,
    ).toBe("pending");
  });

  it("summarises a long episode section by section and synthesises over them", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    withEpisode("longepisode", english(englishSegments(1200, 5), 6000)); // 100 minutes
    await pendingNow("longepisode");
    const { step, result } = await run(
      "longepisode",
      await begin("longepisode"),
    );
    expect(result).toMatchObject({ ended: "published" });
    const names = stepNames(step);
    expect(
      names.filter((n) => n.startsWith("summarize:")).length,
    ).toBeGreaterThanOrEqual(5);
    expect(names).toContain("synthesise");
    expect(names.filter((n) => n.startsWith("stage:")).length).toBeGreaterThan(
      1,
    );
    // The reduce prompt is built from formatSectionSummary, so it carries [h:mm:ss] markers and the
    // fake echoes real times back. Serialising the internal shape gave seconds, and every reduced
    // takeaway came back null.
    const summary = (await registry().getEpisode(CHANNEL_A, "longepisode"))
      ?.summary;
    if (summary?.format !== "structured")
      throw new Error("expected a structured summary");
    expect(summary.takeaways.length).toBeGreaterThan(0);
    expect(summary.takeaways.every((t) => t.startSec !== null)).toBe(true);
  });

  it("keeps the allocated takeaways when the synthesis fails, instead of falling back to raw text", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    env.AI_FAKE = JSON.stringify({ synthesisInvalid: true });
    withEpisode("nosynthesis", english(englishSegments(1200, 5), 6000)); // 100 minutes
    await pendingNow("nosynthesis");
    const { step, result } = await run(
      "nosynthesis",
      await begin("nosynthesis"),
    );
    expect(result).toMatchObject({ ended: "published" });
    expect(stepNames(step)).toContain("synthesise:retry");

    const summary = (await registry().getEpisode(CHANNEL_A, "nosynthesis"))
      ?.summary;
    // The takeaways never depended on that call, so the reader keeps a navigable summary.
    if (summary?.format !== "structured")
      throw new Error("expected a structured summary, not a raw fallback");
    expect(summary.takeaways.length).toBeGreaterThan(1);
    expect(summary.takeaways.every((t) => t.startSec !== null)).toBe(true);
    // The prose falls back to the first section's, which is a real summary of a real section.
    expect(summary.executiveSummary).toContain("canned summary");
  });

  it("falls back to raw text only when no section parsed at all", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    // The marker rides the transcript, so it reaches every section's map prompt.
    withEpisode(
      "allmapsfail",
      english(
        englishSegments(1200, 5).map((seg) => ({
          ...seg,
          text: `${seg.text} [[invalid]]`,
        })),
        6000,
      ),
    );
    await pendingNow("allmapsfail");
    const { result } = await run("allmapsfail", await begin("allmapsfail"));
    expect(result).toMatchObject({ ended: "published" });
    expect(
      (await registry().getEpisode(CHANNEL_A, "allmapsfail"))?.summary?.format,
    ).toBe("raw_fallback");
  });

  it("finishes TRANSCRIPT_TOO_LARGE for a transcript over the step ceiling, recoverably", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const huge = Array.from({ length: 8_000 }, (_, i) => ({
      text: "x".repeat(100),
      startSec: i,
      durationSec: 1,
    }));
    withEpisode("hugetrnscrp", english(huge, 8_000));
    await pendingNow("hugetrnscrp");
    const { result } = await run("hugetrnscrp", await begin("hugetrnscrp"));
    expect(result).toMatchObject({
      outcome: { status: "failed", code: "TRANSCRIPT_TOO_LARGE" },
    });
    const episode = await registry().getEpisode(CHANNEL_A, "hugetrnscrp");
    expect(episode).toMatchObject({
      status: "pending",
      processing: { failureCode: null, nextAttemptAt: expect.any(Number) },
    });
  });

  it("replaces content atomically: old summary and vectors stay until the new generation is verified, then only the new one remains", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_ENGLISH, CHANNEL_A, {
      status: "available",
      chunkCount: 3,
      processedAt: 1,
    });
    await seedSummary(EPISODE_ENGLISH);
    const oldIds = generationIds(EPISODE_ENGLISH, `gen-${EPISODE_ENGLISH}`, 3);
    await vectorStore(env).upsert(
      SHARED_NAMESPACE,
      oldIds.map((id, i) => ({
        id,
        values: Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0)),
        metadata: {
          episodeId: EPISODE_ENGLISH,
          channelId: CHANNEL_A,
          generationId: `gen-${EPISODE_ENGLISH}`,
          channelTitle: "A",
          title: "t",
          startSec: 0,
          endSec: 1,
          text: "old",
          publishedAt: 1,
        },
      })),
    );
    await userDO(ALICE).markRead([EPISODE_ENGLISH]);
    await registry().retryEpisode(CHANNEL_A, EPISODE_ENGLISH);
    const attemptId = await begin(EPISODE_ENGLISH, "owner_retry");
    const { staged } = await generations(EPISODE_ENGLISH);

    const { step, result } = await run(EPISODE_ENGLISH, attemptId);
    expect(result).toEqual({
      attemptId,
      ended: "published",
      chunkCount: ENGLISH_CHUNKS,
      replaced: true,
    });
    expect(stepNames(step)).toContain("cleanup");
    const episode = await registry().getEpisode(CHANNEL_A, EPISODE_ENGLISH);
    expect(episode).toMatchObject({
      status: "available",
      summaryAvailableAt: 1,
      summary: { format: "structured", topicTags: ["canned", "test"] },
      processing: { chunkCount: ENGLISH_CHUNKS, intent: null },
    });
    expect(fakeVectorIds().sort()).toEqual(
      generationIds(EPISODE_ENGLISH, staged ?? "", ENGLISH_CHUNKS).sort(),
    );
    expect(await userDO(ALICE).readEpisodeIds([EPISODE_ENGLISH])).toEqual([
      EPISODE_ENGLISH,
    ]);
  });

  it("deletes exactly the abandoned generation of a failed attempt before staging its own", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    env.VECTORIZE_FAKE = JSON.stringify({ visibilityDelayReads: 1_000 });
    const first = await begin(EPISODE_ENGLISH);
    const firstGeneration = (await generations(EPISODE_ENGLISH)).staged ?? "";
    expect((await run(EPISODE_ENGLISH, first)).result).toMatchObject({
      outcome: { code: "VECTORIZE_INCOMPLETE" },
    });
    expect(fakeVectorIds().sort()).toEqual(
      generationIds(EPISODE_ENGLISH, firstGeneration, ENGLISH_CHUNKS).sort(),
    );

    env.VECTORIZE_FAKE = "{}";
    const second = await begin(EPISODE_ENGLISH);
    const secondGeneration = (await generations(EPISODE_ENGLISH)).staged ?? "";
    const { step, result } = await run(EPISODE_ENGLISH, second);
    expect(result).toMatchObject({ ended: "published" });
    expect(stepNames(step)).toContain("discard");
    expect(fakeVectorIds().sort()).toEqual(
      generationIds(EPISODE_ENGLISH, secondGeneration, ENGLISH_CHUNKS).sort(),
    );
  });

  it("publishes even when cleanup or the related lookup fails", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_ENGLISH, CHANNEL_A, {
      status: "available",
      chunkCount: 3,
      processedAt: 1,
    });
    await seedSummary(EPISODE_ENGLISH);
    await registry().retryEpisode(CHANNEL_A, EPISODE_ENGLISH);
    env.VECTORIZE_FAKE = JSON.stringify({ throwOn: ["deleteByIds", "query"] });
    const { step, result } = await run(
      EPISODE_ENGLISH,
      await begin(EPISODE_ENGLISH, "owner_retry"),
    );
    expect(result).toMatchObject({ ended: "published", replaced: true });
    expect(stepNames(step)).toContain("cleanup");
    expect(stepNames(step)).toContain("related");
    expect(
      (await registry().getEpisode(CHANNEL_A, EPISODE_ENGLISH))?.status,
    ).toBe("available");
    expect(await storedRelated(EPISODE_ENGLISH)).toBe("[]");
  });

  it("stores related candidates that are available episodes", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_B, CHANNEL_A, {
      status: "available",
      chunkCount: 1,
    });
    await vectorStore(env).upsert(SHARED_NAMESPACE, [
      {
        id: generationIds(EPISODE_B, `gen-${EPISODE_B}`, 1)[0] ?? "",
        values: (await import("../src/lib/ai")).fakeEmbedding(
          englishSegments(1)[0]?.text ?? "",
        ),
        metadata: {
          episodeId: EPISODE_B,
          channelId: CHANNEL_A,
          generationId: `gen-${EPISODE_B}`,
          channelTitle: "A",
          title: "b",
          startSec: 0,
          endSec: 1,
          text: "b",
          publishedAt: 1,
        },
      },
    ]);
    await pendingNow(EPISODE_ENGLISH);
    const { result } = await run(EPISODE_ENGLISH, await begin(EPISODE_ENGLISH));
    expect(result).toMatchObject({ ended: "published" });
    expect(JSON.parse(await storedRelated(EPISODE_ENGLISH))).toEqual([
      EPISODE_B,
    ]);
  });

  it("exits at load without writing when the attempt is no longer current", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    const attemptId = await begin(EPISODE_ENGLISH);
    await registry().finishAttempt(attemptId, {
      status: "waiting",
      code: "CAPTIONS",
    });
    const { step, result } = await run(EPISODE_ENGLISH, attemptId);
    expect(result).toEqual({ attemptId, ended: "stale" });
    expect(stepNames(step)).toEqual(["load"]);
    const episode = await registry().getEpisode(CHANNEL_A, EPISODE_ENGLISH);
    expect(episode?.processing.latestAttempt).toMatchObject({
      attemptId,
      status: "waiting",
    });
    expect(fakeVectorIds()).toEqual([]);
  });

  it("runs as a real Workflow instance through the binding and publishes", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(EPISODE_ENGLISH);
    const attemptId = await begin(EPISODE_ENGLISH);
    const instance = await introspectWorkflowInstance(
      env.INGEST_WORKFLOW,
      attemptId,
    );
    try {
      await instance.modify(async (m) => {
        await m.disableSleeps();
      });
      await env.INGEST_WORKFLOW.create({
        id: attemptId,
        params: {
          attemptId,
          episodeId: EPISODE_ENGLISH,
          channelId: CHANNEL_A,
          startDelaySec: 3,
        },
      });
      await instance.waitForStatus("complete");
      expect(await instance.getOutput()).toMatchObject({
        attemptId,
        ended: "published",
        chunkCount: ENGLISH_CHUNKS,
      });
    } finally {
      await instance.dispose();
    }
    expect(
      (await registry().getEpisode(CHANNEL_A, EPISODE_ENGLISH))?.status,
    ).toBe("available");
  });
});
