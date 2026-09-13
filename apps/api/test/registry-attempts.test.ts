import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as processing from "../src/do/registry/processing";
import {
  type AttemptOutcome,
  type EpisodeSummaryInput,
  TECHNICAL_CODES,
  WAITING_CODES,
} from "../src/do/registry/types";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
  seedAttempt,
  seedEpisode,
  seedSummary,
  setChannelState,
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
  videoIds,
} from "./helpers";

const HOUR = 60 * 60 * 1000;
const WINDOW = 48 * HOUR;
const SIX_HOURS = 6 * HOUR;

const STRUCTURED: EpisodeSummaryInput = {
  format: "structured",
  executiveSummary: "One. Two. Three.",
  takeaways: [
    { text: "one", startSec: 12 },
    { text: "two", startSec: null },
    { text: "three", startSec: 90 },
  ],
  topicTags: ["alpha", "beta"],
  model: "test-model",
  promptVersion: "2026-09-13",
};

/** Runs store functions inside the Registry with an explicit clock. */
function inRegistry<T>(work: (sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(registry(), (_, ctx) => work(ctx.storage.sql));
}

/** The generation columns the API never exposes. */
function generations(videoId: string) {
  return inRegistry((sql) =>
    sql
      .exec<{
        active: string | null;
        staged: string | null;
        checked: number | null;
      }>(
        `SELECT active_vector_generation AS active, staged_vector_generation AS staged,
           transcript_checked_at AS checked FROM episodes WHERE video_id = ?`,
        videoId,
      )
      .one(),
  );
}

function storedRelated(videoId: string) {
  return inRegistry(
    (sql) =>
      sql
        .exec<{ related: string }>(
          "SELECT related_video_ids_json AS related FROM episode_summaries WHERE video_id = ?",
          videoId,
        )
        .one().related,
  );
}

async function pendingNow(videoId: string, channelId: string) {
  await seedEpisode(videoId, channelId, {
    status: "pending",
    window: { intent: "publish", startedAt: Date.now() },
  });
}

async function started(videoId: string) {
  const start = await registry().beginAttempt(videoId, "channel_ingestion");
  if (start.kind !== "started") throw new Error("expected a started attempt");
  return start;
}

describe("the attempt ledger", () => {
  it("begins, stages, and publishes a first attempt; a second begin reports the running one; stale writes are refused", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(VIDEO_A, CHANNEL_A);
    await seedEpisode(VIDEO_B, CHANNEL_A, { status: "available" });
    await seedSummary(VIDEO_B);
    await seedEpisode(VIDEO_C, CHANNEL_A, { status: "pending" });

    const start = await stub.beginAttempt(VIDEO_A, "channel_ingestion");
    expect(start.kind).toBe("started");
    if (start.kind !== "started") return;
    expect(start.abandonedGeneration).toBeNull();
    expect(start.attempt).toMatchObject({
      videoId: VIDEO_A,
      trigger: "channel_ingestion",
      intent: "publish",
      status: "running",
      outcomeCode: null,
      failureDetail: null,
      requestedByEmail: null,
      stagedChunkCount: null,
      finishedAt: null,
    });
    expect(start.attempt.workflowId).toBe(start.attempt.attemptId);
    const { staged } = await generations(VIDEO_A);
    expect(staged).toEqual(expect.any(String));

    const again = await stub.beginAttempt(VIDEO_A, "scheduled_recovery");
    expect(again).toEqual({ kind: "running", attempt: start.attempt });
    const listed = await stub.listEpisodes(CHANNEL_A, { relatedScope: [] });
    expect(listed.find((e) => e.videoId === VIDEO_A)?.processing).toMatchObject(
      {
        attemptCount: 1,
        latestAttempt: {
          attemptId: start.attempt.attemptId,
          status: "running",
        },
      },
    );

    const marked = await stub.markStaged(start.attempt.attemptId, 12);
    expect(marked.stagedChunkCount).toBe(12);
    expect((await generations(VIDEO_A)).checked).toEqual(expect.any(Number));

    const done = await stub.completeAttempt(
      start.attempt.attemptId,
      12,
      STRUCTURED,
      [
        VIDEO_C, // pending: dropped
        VIDEO_B,
        VIDEO_A, // itself: dropped
        VIDEO_B, // duplicate: dropped
      ],
    );
    expect(done.previousGeneration).toBeNull();
    expect(done.attempt).toMatchObject({
      status: "available",
      outcomeCode: null,
      finishedAt: expect.any(Number),
      stagedChunkCount: 12,
    });
    expect(done.episode).toMatchObject({
      status: "available",
      summaryAvailableAt: expect.any(Number),
      summary: {
        format: "structured",
        executiveSummary: STRUCTURED.executiveSummary,
        takeaways: STRUCTURED.takeaways,
        topicTags: STRUCTURED.topicTags,
      },
      processing: {
        intent: null,
        windowStartedAt: null,
        windowDeadlineAt: null,
        nextAttemptAt: null,
        chunkCount: 12,
        vectorizedAt: expect.any(Number),
        failureCode: null,
        latestAttempt: {
          attemptId: start.attempt.attemptId,
          status: "available",
        },
      },
    });
    expect(await storedRelated(VIDEO_A)).toBe(JSON.stringify([VIDEO_B]));
    const inScope = await stub.listEpisodes(CHANNEL_A, {
      relatedScope: [CHANNEL_A],
    });
    expect(inScope.find((e) => e.videoId === VIDEO_A)?.related).toEqual([
      { videoId: VIDEO_B, title: `Episode ${VIDEO_B}` },
    ]);
    const after = await generations(VIDEO_A);
    expect(after).toMatchObject({ active: staged, staged: null });

    // Stale: the attempt is no longer running.
    await expectDomainError(
      stub.completeAttempt(start.attempt.attemptId, 12, STRUCTURED, []),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.markStaged(start.attempt.attemptId, 1),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.finishAttempt(start.attempt.attemptId, {
        status: "waiting",
        code: "CAPTIONS",
      }),
      "INVALID_STATE",
    );
    // No channel column moved.
    expect(await stub.getChannel(CHANNEL_A)).toEqual(channel);
  });

  it("keeps an unfinished publication in its window, schedules it six hours later, and hands the abandoned generation to the next attempt", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(VIDEO_A, CHANNEL_A);

    const first = await started(VIDEO_A);
    const firstGeneration = (await generations(VIDEO_A)).staged;
    await stub.markStaged(first.attempt.attemptId, 30);
    const before = Date.now();
    const failed = await stub.finishAttempt(first.attempt.attemptId, {
      status: "failed",
      code: "EMBEDDING_FAILED",
      detail: "wrong dimension",
    });
    expect(failed.attempt).toMatchObject({
      status: "failed",
      outcomeCode: "EMBEDDING_FAILED",
      failureDetail: "wrong dimension",
      finishedAt: expect.any(Number),
    });
    const p = failed.episode.processing;
    expect(failed.episode.status).toBe("pending");
    expect(p.failureCode).toBeNull();
    expect(p.failureDetail).toBeNull();
    expect(p.intent).toBe("publish");
    expect(p.attemptCount).toBe(1);
    expect(p.nextAttemptAt).toBeGreaterThanOrEqual(before + SIX_HOURS - 1_000);
    expect(p.nextAttemptAt).toBeLessThanOrEqual(p.windowDeadlineAt ?? 0);
    // The staged generation stays on the episode until the next attempt replaces it.
    expect((await generations(VIDEO_A)).staged).toBe(firstGeneration);

    const second = await started(VIDEO_A);
    expect(second.abandonedGeneration).toEqual({
      generationId: firstGeneration,
      chunkCount: 30,
    });
    expect((await generations(VIDEO_A)).staged).not.toBe(firstGeneration);
    // Waiting on captions never reached embedding: nothing abandoned for the third attempt.
    const waiting = await stub.finishAttempt(second.attempt.attemptId, {
      status: "waiting",
      code: "CAPTIONS",
    });
    expect(waiting.attempt).toMatchObject({
      status: "waiting",
      outcomeCode: "CAPTIONS",
      failureDetail: null,
    });
    expect(waiting.episode.processing.attemptCount).toBe(2);
    expect((await generations(VIDEO_A)).checked).toEqual(expect.any(Number));
    const third = await started(VIDEO_A);
    expect(third.abandonedGeneration).toBeNull();
  });

  it("schedules at deadline − 1 ms and times out at the deadline, for a publication and for a replacement", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    const start = 1_000_000;
    const deadline = start + WINDOW;
    await seedEpisode(VIDEO_A, CHANNEL_A, {
      status: "pending",
      window: { intent: "publish", startedAt: start },
    });

    const first = await inRegistry((sql) =>
      processing.beginAttempt(
        sql,
        VIDEO_A,
        "scheduled_recovery",
        null,
        start + 1_000,
      ),
    );
    if (first.kind !== "started") throw new Error("expected started");
    const edge = await inRegistry((sql) =>
      processing.finishAttempt(
        sql,
        first.attempt.attemptId,
        { status: "waiting", code: "CAPTIONS" },
        deadline - 1,
      ),
    );
    expect(edge.episode.status).toBe("pending");
    expect(edge.episode.processing).toMatchObject({
      nextAttemptAt: deadline,
      windowDeadlineAt: deadline,
      failureCode: null,
    });

    const final = await inRegistry((sql) =>
      processing.beginAttempt(
        sql,
        VIDEO_A,
        "scheduled_recovery",
        null,
        deadline,
      ),
    );
    if (final.kind !== "started") throw new Error("expected started");
    const timedOut = await inRegistry((sql) =>
      processing.finishAttempt(
        sql,
        final.attempt.attemptId,
        { status: "waiting", code: "LIVE_OR_UPCOMING" },
        deadline,
      ),
    );
    // The attempt keeps its own reason; the episode records the timeout with that reason as detail.
    expect(timedOut.attempt).toMatchObject({
      status: "waiting",
      outcomeCode: "LIVE_OR_UPCOMING",
    });
    expect(timedOut.episode).toMatchObject({
      status: "failed",
      processing: {
        failureCode: "INGESTION_TIMEOUT",
        failureDetail: "LIVE_OR_UPCOMING",
        intent: null,
        windowStartedAt: null,
        windowDeadlineAt: null,
        nextAttemptAt: null,
        attemptCount: 2,
        latestAttempt: { status: "waiting", outcomeCode: "LIVE_OR_UPCOMING" },
      },
    });
    expect((await generations(VIDEO_A)).staged).toBeNull();

    // A replacement that exhausts its window closes without touching the readable content.
    await seedEpisode(VIDEO_B, CHANNEL_A, {
      status: "available",
      chunkCount: 3,
      processedAt: 1,
    });
    await seedSummary(VIDEO_B);
    const replacing = await stub.retryEpisode(CHANNEL_A, VIDEO_B);
    const replaceDeadline = replacing.processing.windowDeadlineAt ?? 0;
    const attempt = await inRegistry((sql) =>
      processing.beginAttempt(
        sql,
        VIDEO_B,
        "owner_retry",
        OWNER,
        replaceDeadline - HOUR,
      ),
    );
    if (attempt.kind !== "started") throw new Error("expected started");
    const closed = await inRegistry((sql) =>
      processing.finishAttempt(
        sql,
        attempt.attempt.attemptId,
        { status: "failed", code: "VECTORIZE_INCOMPLETE" },
        replaceDeadline,
      ),
    );
    expect(closed.episode).toMatchObject({
      status: "available",
      summaryAvailableAt: 1,
      summary: {
        format: "structured",
        executiveSummary: `Summary of ${VIDEO_B}`,
      },
      processing: { intent: null, chunkCount: 3, failureCode: null },
    });
    expect(await generations(VIDEO_B)).toMatchObject({
      active: `gen-${VIDEO_B}`,
      staged: null,
    });
  });

  it.each([...WAITING_CODES, ...TECHNICAL_CODES])(
    "%s before the deadline leaves the episode pending with no failure code and a next attempt",
    async (code) => {
      const stub = registry();
      await seedApprovedChannel(CHANNEL_A, "A");
      await pendingNow(VIDEO_A, CHANNEL_A);
      const start = await started(VIDEO_A);
      const status = (WAITING_CODES as readonly string[]).includes(code)
        ? "waiting"
        : "failed";
      const result = await stub.finishAttempt(start.attempt.attemptId, {
        status,
        code,
      } as AttemptOutcome);
      expect(result.attempt).toMatchObject({ status, outcomeCode: code });
      expect(result.episode.status).toBe("pending");
      expect(result.episode.processing).toMatchObject({
        failureCode: null,
        failureDetail: null,
        intent: "publish",
        nextAttemptAt: expect.any(Number),
      });
      const counts = await stub.countEpisodesByChannel([CHANNEL_A]);
      expect(Object.keys(counts[CHANNEL_A] ?? {}).sort()).toEqual([
        "available",
        "failed",
        "pending",
        "skipped",
      ]);
    },
  );

  it("counts launched attempts only, never making the episode terminal", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(VIDEO_A, CHANNEL_A);
    for (let i = 0; i < 5; i++) {
      const start = await started(VIDEO_A);
      await stub.finishAttempt(start.attempt.attemptId, {
        status: "failed",
        code: "PROVIDER_HTTP",
      });
    }
    const blocked = await stub.recordBlockedAttempt(
      VIDEO_A,
      "scheduled_recovery",
      "PROVIDER_LIMIT",
    );
    expect(blocked.episode.status).toBe("pending");
    expect(blocked.episode.processing.attemptCount).toBe(5);
  });

  it("records blocked starts: automatic ones move the episode or settle it at the deadline, owner ones leave it untouched", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(VIDEO_A, CHANNEL_A);
    const before = Date.now();

    const automatic = await stub.recordBlockedAttempt(
      VIDEO_A,
      "scheduled_recovery",
      "PROVIDER_LIMIT",
    );
    expect(automatic.attempt).toMatchObject({
      status: "blocked",
      outcomeCode: "PROVIDER_LIMIT",
      trigger: "scheduled_recovery",
      intent: "publish",
      workflowId: null,
      requestedByEmail: null,
      stagedChunkCount: null,
    });
    expect(automatic.attempt.finishedAt).toBe(automatic.attempt.startedAt);
    expect(automatic.episode.status).toBe("pending");
    expect(automatic.episode.processing).toMatchObject({
      attemptCount: 0,
      failureCode: null,
      latestAttempt: { attemptId: automatic.attempt.attemptId },
    });
    expect(automatic.episode.processing.nextAttemptAt).toBeGreaterThanOrEqual(
      before + SIX_HOURS - 1_000,
    );

    // Blocked at every start for the whole window: the timeout still names the real cause.
    const start = 5_000_000;
    await seedEpisode(VIDEO_B, CHANNEL_A, {
      status: "pending",
      window: { intent: "publish", startedAt: start },
    });
    for (let tick = start; tick < start + WINDOW; tick += SIX_HOURS) {
      const t = tick;
      await inRegistry((sql) =>
        processing.recordBlockedAttempt(
          sql,
          VIDEO_B,
          "scheduled_recovery",
          "PROVIDER_LIMIT",
          null,
          t,
        ),
      );
    }
    const settled = await inRegistry((sql) =>
      processing.recordBlockedAttempt(
        sql,
        VIDEO_B,
        "scheduled_recovery",
        "PROVIDER_LIMIT",
        null,
        start + WINDOW,
      ),
    );
    expect(settled.episode).toMatchObject({
      status: "failed",
      processing: {
        failureCode: "INGESTION_TIMEOUT",
        failureDetail: "PROVIDER_LIMIT",
        attemptCount: 0,
        intent: null,
        latestAttempt: { status: "blocked", outcomeCode: "PROVIDER_LIMIT" },
      },
    });

    // An owner's block: the attempt is recorded, the episode is exactly as before, window or not.
    await seedEpisode(VIDEO_C, CHANNEL_A, {
      status: "available",
      chunkCount: 3,
    });
    await seedSummary(VIDEO_C);
    const untouched = (
      await stub.listEpisodes(CHANNEL_A, { relatedScope: [] })
    ).find((e) => e.videoId === VIDEO_C);
    const owner = await stub.recordBlockedAttempt(
      VIDEO_C,
      "owner_retry",
      "PROVIDER_AUTH",
      ALICE,
    );
    expect(owner.attempt).toMatchObject({
      status: "blocked",
      outcomeCode: "PROVIDER_AUTH",
      trigger: "owner_retry",
      intent: "replace",
      requestedByEmail: ALICE,
    });
    const { latestAttempt: _x, ...ownerProcessing } = owner.episode.processing;
    const { latestAttempt: _y, ...untouchedProcessing } =
      untouched?.processing ?? owner.episode.processing;
    expect({ ...owner.episode, processing: ownerProcessing }).toEqual({
      ...untouched,
      processing: untouchedProcessing,
    });
    await seedEpisode("ownerskip01", CHANNEL_A, {
      status: "skipped",
      skipReason: "OWNER",
    });
    const reopen = await stub.recordBlockedAttempt(
      "ownerskip01",
      "owner_retry",
      "PROVIDER_LIMIT",
      OWNER,
    );
    expect(reopen.attempt.intent).toBe("publish");
    expect(reopen.episode.status).toBe("skipped");

    // Refusals.
    await expectDomainError(
      stub.recordBlockedAttempt(
        VIDEO_C,
        "scheduled_recovery",
        "PROVIDER_LIMIT",
      ),
      "INVALID_STATE", // no window open for an automatic start
    );
    await expectDomainError(
      stub.recordBlockedAttempt(VIDEO_C, "owner_retry", "PROVIDER_LIMIT"),
      "INVALID_INPUT", // owner_retry needs a requester
    );
    await expectDomainError(
      stub.recordBlockedAttempt(
        VIDEO_A,
        "scheduled_recovery",
        "CAPTIONS" as never,
      ),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.recordBlockedAttempt(VIDEO_A, "cron" as never, "PROVIDER_LIMIT"),
      "INVALID_INPUT",
    );
    await started(VIDEO_A);
    await expectDomainError(
      stub.recordBlockedAttempt(
        VIDEO_A,
        "scheduled_recovery",
        "PROVIDER_LIMIT",
      ),
      "INVALID_STATE", // an attempt is running
    );
  });

  it("skips a publication on a deterministic result and leaves a replacement's content alone", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(VIDEO_A, CHANNEL_A);
    const first = await started(VIDEO_A);
    const skipped = await stub.finishAttempt(first.attempt.attemptId, {
      status: "skipped",
      code: "SHORT",
    });
    expect(skipped.attempt).toMatchObject({
      status: "skipped",
      outcomeCode: "SHORT",
    });
    expect(skipped.episode).toMatchObject({
      status: "skipped",
      skipReason: "SHORT",
      processing: {
        skippedAt: expect.any(Number),
        skippedByEmail: null,
        intent: null,
        nextAttemptAt: null,
        transcriptCheckedAt: expect.any(Number),
      },
    });
    expect((await generations(VIDEO_A)).staged).toBeNull();

    await seedEpisode(VIDEO_B, CHANNEL_A, {
      status: "available",
      chunkCount: 3,
      processedAt: 1,
    });
    await seedSummary(VIDEO_B);
    await stub.retryEpisode(CHANNEL_A, VIDEO_B);
    const replacing = await stub.beginAttempt(VIDEO_B, "owner_retry", OWNER);
    if (replacing.kind !== "started") throw new Error("expected started");
    expect(replacing.attempt).toMatchObject({
      intent: "replace",
      requestedByEmail: OWNER,
    });
    const unplayable = await stub.finishAttempt(replacing.attempt.attemptId, {
      status: "skipped",
      code: "UNPLAYABLE",
    });
    expect(unplayable.attempt).toMatchObject({
      status: "skipped",
      outcomeCode: "UNPLAYABLE",
    });
    expect(unplayable.episode).toMatchObject({
      status: "available",
      skipReason: null,
      summaryAvailableAt: 1,
      summary: { format: "structured" },
      processing: { intent: null, chunkCount: 3, skippedAt: null },
    });
    expect(await generations(VIDEO_B)).toMatchObject({
      active: `gen-${VIDEO_B}`,
      staged: null,
    });
  });

  it("replaces content atomically, preserving first availability and handing back the previous generation", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(VIDEO_A, CHANNEL_A, {
      status: "available",
      chunkCount: 3,
      processedAt: 1,
    });
    await seedSummary(VIDEO_A);
    await stub.retryEpisode(CHANNEL_A, VIDEO_A);
    const start = await stub.beginAttempt(VIDEO_A, "owner_retry", OWNER);
    if (start.kind !== "started") throw new Error("expected started");
    const newGeneration = (await generations(VIDEO_A)).staged;
    await stub.markStaged(start.attempt.attemptId, 7);

    const done = await stub.completeAttempt(
      start.attempt.attemptId,
      7,
      {
        format: "raw_fallback",
        rawText: "the new text",
        model: "m",
        promptVersion: "p",
      },
      [],
    );
    expect(done.previousGeneration).toEqual({
      generationId: `gen-${VIDEO_A}`,
      chunkCount: 3,
    });
    expect(done.episode).toMatchObject({
      status: "available",
      summaryAvailableAt: 1,
      summary: { format: "raw_fallback", rawText: "the new text" },
      processing: { chunkCount: 7, intent: null, attemptCount: 1 },
    });
    expect(await generations(VIDEO_A)).toMatchObject({
      active: newGeneration,
      staged: null,
    });
    expect(await storedRelated(VIDEO_A)).toBe("[]");
  });

  it("stores at most five available related episodes, in the attempt's order", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await pendingNow(VIDEO_A, CHANNEL_A);
    const others = videoIds(8);
    for (const id of others)
      await seedEpisode(id, CHANNEL_A, { status: "available" });
    const start = await started(VIDEO_A);
    await stub.completeAttempt(
      start.attempt.attemptId,
      3,
      STRUCTURED,
      [...others].reverse(),
    );
    expect(JSON.parse(await storedRelated(VIDEO_A))).toEqual(
      [...others].reverse().slice(0, 5),
    );
  });

  it("works under requested, paused, and declined channels: Retry then a start, channel untouched", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedApprovedChannel(CHANNEL_B, "B");
    await seedApprovedChannel(CHANNEL_C, "C"); // system-paused: nobody follows
    await setChannelState(CHANNEL_A, { status: "requested" });
    await stub.declineChannel(OWNER, CHANNEL_B);
    for (const channelId of [CHANNEL_A, CHANNEL_B, CHANNEL_C]) {
      const videoId = `v${channelId.slice(2, 12)}`;
      await seedEpisode(videoId, channelId, { status: "failed" });
      const channel = await stub.getChannel(channelId);
      const retried = await stub.retryEpisode(channelId, videoId);
      expect(retried.status).toBe("pending");
      const start = await stub.beginAttempt(videoId, "owner_retry", OWNER);
      expect(start.kind).toBe("started");
      const skipped = await stub.finishAttempt(
        start.kind === "started" ? start.attempt.attemptId : "",
        { status: "skipped", code: "NON_ENGLISH" },
      );
      expect(skipped.episode).toMatchObject({
        status: "skipped",
        skipReason: "NON_ENGLISH",
      });
      expect(skipped.episode.processing.discoveredByRunId).toBe(
        retried.processing.discoveredByRunId,
      );
      expect(await stub.getChannel(channelId)).toEqual(channel);
    }
  });

  it("refuses bad input and unknown ids with the documented codes", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await expectDomainError(
      stub.beginAttempt("unknown0001", "channel_ingestion"),
      "NOT_FOUND",
    );
    await seedEpisode(VIDEO_B, CHANNEL_A, { status: "available" }); // no window
    await expectDomainError(
      stub.beginAttempt(VIDEO_B, "channel_ingestion"),
      "INVALID_STATE",
    );
    await pendingNow(VIDEO_A, CHANNEL_A);
    await expectDomainError(
      stub.beginAttempt(VIDEO_A, "owner_retry"),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.beginAttempt(VIDEO_A, "nightly" as never),
      "INVALID_INPUT",
    );
    const start = await started(VIDEO_A);
    const id = start.attempt.attemptId;
    await expectDomainError(stub.markStaged(id, 0), "INVALID_INPUT");
    await expectDomainError(stub.markStaged("", 3), "INVALID_INPUT");
    await expectDomainError(stub.markStaged("no-such-attempt", 3), "NOT_FOUND");
    await expectDomainError(
      stub.finishAttempt(id, { status: "waiting", code: "SHORT" } as never),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.finishAttempt(id, { status: "failed", code: "CAPTIONS" } as never),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.completeAttempt(id, 0, STRUCTURED, []),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.completeAttempt(id, 3, { ...STRUCTURED, executiveSummary: " " }, []),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.completeAttempt(
        id,
        3,
        { ...STRUCTURED, takeaways: [{ text: "t", startSec: -1 }] },
        [],
      ),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.completeAttempt(
        id,
        3,
        { format: "raw_fallback", model: "m", promptVersion: "p" } as never,
        [],
      ),
      "INVALID_INPUT",
    );
    // Still running and current after every refusal.
    const again = await stub.beginAttempt(VIDEO_A, "channel_ingestion");
    expect(again).toMatchObject({
      kind: "running",
      attempt: { attemptId: id },
    });
  });
});

describe("the recovery selection reads", () => {
  it("lists due episodes with an open window and nothing running, in due order, inclusive of now", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    const now = 1_000_000;
    const window = (intent: "publish" | "replace", nextAttemptAt: number) => ({
      intent,
      startedAt: 1,
      nextAttemptAt,
    });
    // Two due at exactly `now` (tie broken by video id), one due earlier under `replace`.
    await seedEpisode(VIDEO_B, CHANNEL_A, {
      status: "pending",
      window: window("publish", now),
    });
    await seedEpisode(VIDEO_A, CHANNEL_A, {
      status: "pending",
      window: window("publish", now),
    });
    await seedEpisode(VIDEO_C, CHANNEL_A, {
      status: "available",
      window: window("replace", now - 10),
    });
    // Not due yet; running; window closed.
    await seedEpisode("ddddddddddd", CHANNEL_A, {
      status: "pending",
      window: window("publish", now + 1),
    });
    await seedEpisode("eeeeeeeeeee", CHANNEL_A, {
      status: "pending",
      window: window("publish", now - 100),
    });
    await seedAttempt("eeeeeeeeeee", { status: "running", startedAt: 5 });
    await seedEpisode("fffffffffff", CHANNEL_A, {
      status: "failed",
      failureDetail: "CAPTIONS",
    });

    expect((await stub.listDueEpisodes(now)).map((e) => e.videoId)).toEqual([
      VIDEO_C,
      VIDEO_A,
      VIDEO_B,
    ]);
    expect(
      (await stub.listDueEpisodes(now - 10)).map((e) => e.videoId),
    ).toEqual([VIDEO_C]);
    expect(await stub.listDueEpisodes(0)).toEqual([]);
    await expectDomainError(stub.listDueEpisodes(-1), "INVALID_INPUT");
  });

  it("lists running attempts started strictly before the cutoff, oldest first, never a finished one", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    for (const videoId of [VIDEO_A, VIDEO_B, VIDEO_C]) {
      await seedEpisode(videoId, CHANNEL_A, {
        status: "pending",
        window: { intent: "publish", startedAt: 1 },
      });
    }
    const old = await seedAttempt(VIDEO_A, {
      status: "running",
      startedAt: 100,
    });
    const older = await seedAttempt(VIDEO_B, {
      status: "running",
      startedAt: 50,
    });
    await seedAttempt(VIDEO_C, { status: "running", startedAt: 200 });
    await seedAttempt(VIDEO_A, { status: "waiting", startedAt: 10 });

    expect(
      (await stub.listRunningAttempts(200)).map((a) => a.attemptId),
    ).toEqual([older, old]);
    expect((await stub.listRunningAttempts(201)).map((a) => a.videoId)).toEqual(
      [VIDEO_B, VIDEO_A, VIDEO_C],
    );
    expect(await stub.listRunningAttempts(50)).toEqual([]);
    await expectDomainError(
      stub.listRunningAttempts(Number.NaN),
      "INVALID_INPUT",
    );
  });
});
