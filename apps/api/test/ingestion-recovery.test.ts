import {
  createExecutionContext,
  createScheduledController,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  DISCOVERY_CRON,
  RECOVERY_CRON,
  reconcileRunningAttempts,
  runRecoveryTick,
} from "../src/lib/ingestion";
import { createdInstances } from "../src/lib/workflows";
import { FAKE_FEEDS } from "./fixtures/feeds";
import { FAKE_TRANSCRIPTS } from "./fixtures/transcripts";
import {
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  expectDomainError,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  setChannelState,
} from "./helpers";

const HOUR = 60 * 60 * 1000;
const SIX_HOURS = 6 * HOUR;
const WINDOW = 48 * HOUR;
const EPISODE_D = "ddddddddddd";
const EPISODE_E = "eeeeeeeeeee";
const EPISODE_F = "fffffffffff";
const EPISODE_G = "ggggggggggg";

/** Fires one cron through the Worker's exported `scheduled` handler, the way the runtime does. */
async function scheduled(cron: string): Promise<void> {
  const handler = worker.scheduled;
  if (!handler) throw new Error("the Worker exports no scheduled handler");
  const ctx = createExecutionContext();
  await handler(
    createScheduledController({ cron, scheduledTime: new Date() }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

/** A pending episode inside an open `publish` window, due one millisecond ago unless told otherwise. */
async function due(
  episodeId: string,
  channelId: string,
  options: { startedAt?: number; nextAttemptAt?: number } = {},
): Promise<void> {
  await seedEpisode(episodeId, channelId, {
    status: "pending",
    window: {
      intent: "publish",
      startedAt: options.startedAt ?? Date.now() - HOUR,
      nextAttemptAt: options.nextAttemptAt ?? Date.now() - 1,
    },
  });
}

/** A real running attempt through the ledger, so it is the episode's current one, aged by `ageMs`. */
async function running(episodeId: string, ageMs: number): Promise<string> {
  const start = await registry().beginAttempt(episodeId, "channel_ingestion");
  if (start.kind !== "started") throw new Error("expected a fresh attempt");
  const startedAt = Date.now() - ageMs;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      "UPDATE episode_ingestion_attempts SET started_at = ?, created_at = ? WHERE attempt_id = ?",
      startedAt,
      startedAt,
      start.attempt.attemptId,
    );
  });
  return start.attempt.attemptId;
}

async function episode(channelId: string, episodeId: string) {
  const record = await registry().getEpisode(channelId, episodeId);
  if (!record) throw new Error(`no episode ${episodeId}`);
  return record;
}

afterEach(() => {
  env.TRANSCRIPTS_FAKE = JSON.stringify(FAKE_TRANSCRIPTS);
  env.WORKFLOW_FAKE = JSON.stringify({ default: "active" });
  env.YOUTUBE_FEEDS_FAKE = JSON.stringify(FAKE_FEEDS);
});

describe("the recovery cron", () => {
  it("runs recovery and no discovery, while the discovery cron starts no due episode", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.resumeChannel(CHANNEL_A);
    await due(EPISODE_A, CHANNEL_A);
    const runsBefore = (await stub.listRuns(CHANNEL_A)).length;

    await scheduled(DISCOVERY_CRON);
    expect(await stub.listRuns(CHANNEL_A)).toHaveLength(runsBefore + 1);
    expect(
      (await episode(CHANNEL_A, EPISODE_A)).processing.latestAttempt,
    ).toBeNull();
    expect(createdInstances()).toEqual([]);

    await scheduled(RECOVERY_CRON);
    expect(await stub.listRuns(CHANNEL_A)).toHaveLength(runsBefore + 1);
    expect(
      (await episode(CHANNEL_A, EPISODE_A)).processing.latestAttempt,
    ).toMatchObject({ status: "running", trigger: "scheduled_recovery" });
    expect(
      createdInstances().map((p) => [p.episodeId, p.startDelaySec]),
    ).toEqual([[EPISODE_A, 0]]);

    // The strings wrangler.jsonc declares (test/wrangler-config.test.ts checks the file).
    expect(DISCOVERY_CRON).toBe("0 */6 * * *");
    expect(RECOVERY_CRON).toBe("30 */6 * * *");
  });

  it("starts every due episode under every channel status and pause state, skips the rest, and staggers across channels", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.resumeChannel(CHANNEL_A);
    await seedApprovedChannel(CHANNEL_B, "B"); // paused: approved with no followers
    await seedApprovedChannel(CHANNEL_C, "C");
    await setChannelState(CHANNEL_C, { status: "requested" });
    await seedApprovedChannel(CHANNEL_D, "D");
    await setChannelState(CHANNEL_D, { status: "declined" });
    expect(
      (await stub.listDiscoveryChannels()).map((c) => c.channelId),
    ).toEqual([CHANNEL_A]);

    const now = Date.now();
    await due(EPISODE_A, CHANNEL_A, { nextAttemptAt: now - 4000 });
    await due(EPISODE_B, CHANNEL_B, { nextAttemptAt: now - 3000 });
    await due(EPISODE_C, CHANNEL_C, { nextAttemptAt: now - 2000 });
    await due(EPISODE_D, CHANNEL_D, { nextAttemptAt: now - 1000 });
    await due(EPISODE_E, CHANNEL_A, { nextAttemptAt: now + HOUR });
    await due(EPISODE_F, CHANNEL_A);
    const inFlight = await running(EPISODE_F, 0);
    await seedEpisode(EPISODE_G, CHANNEL_A, {
      status: "failed",
      failureDetail: "CAPTIONS",
    });

    expect(await runRecoveryTick(env)).toEqual({
      reconciled: 0,
      due: 4,
      started: 4,
      blocked: 0,
    });
    expect(
      createdInstances().map((p) => [
        p.channelId,
        p.episodeId,
        p.startDelaySec,
      ]),
    ).toEqual([
      [CHANNEL_A, EPISODE_A, 0],
      [CHANNEL_B, EPISODE_B, 3],
      [CHANNEL_C, EPISODE_C, 6],
      [CHANNEL_D, EPISODE_D, 9],
    ]);
    for (const [channelId, episodeId] of [
      [CHANNEL_A, EPISODE_A],
      [CHANNEL_B, EPISODE_B],
      [CHANNEL_C, EPISODE_C],
      [CHANNEL_D, EPISODE_D],
    ] as const) {
      expect((await episode(channelId, episodeId)).processing).toMatchObject({
        attemptCount: 1,
        latestAttempt: { status: "running", trigger: "scheduled_recovery" },
      });
    }
    expect(
      (await episode(CHANNEL_A, EPISODE_E)).processing.latestAttempt,
    ).toBeNull();
    expect(
      (await episode(CHANNEL_A, EPISODE_F)).processing.latestAttempt,
    ).toMatchObject({ attemptId: inFlight, status: "running" });
    expect(await episode(CHANNEL_A, EPISODE_G)).toMatchObject({
      status: "failed",
      processing: { latestAttempt: null },
    });
  });

  it("reconciles running attempts older than an hour: gone and missing finish WORKFLOW_LOST inside the window, active stays, young ones are not asked", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    for (const episodeId of [EPISODE_A, EPISODE_B, EPISODE_C, EPISODE_D]) {
      await due(episodeId, CHANNEL_A, { startedAt: Date.now() - 2 * HOUR });
    }
    const gone = await running(EPISODE_A, 2 * HOUR);
    const missing = await running(EPISODE_B, 2 * HOUR);
    const active = await running(EPISODE_C, 2 * HOUR);
    const young = await running(EPISODE_D, 30 * 60 * 1000);
    // Anything not named is gone, so the young attempt proves it was never asked.
    env.WORKFLOW_FAKE = JSON.stringify({
      default: "gone",
      instances: { [missing]: "missing", [active]: "active" },
    });

    const now = Date.now();
    expect(await reconcileRunningAttempts(env, now)).toEqual({
      checked: 3,
      lost: 2,
    });
    for (const attemptId of [gone, missing]) {
      expect((await stub.describeAttempt(attemptId)).attempt).toMatchObject({
        status: "failed",
        outcomeCode: "WORKFLOW_LOST",
      });
    }
    for (const attemptId of [active, young]) {
      expect((await stub.describeAttempt(attemptId)).attempt.status).toBe(
        "running",
      );
    }
    for (const episodeId of [EPISODE_A, EPISODE_B]) {
      const { processing } = await episode(CHANNEL_A, episodeId);
      expect(processing.intent).toBe("publish");
      // The Registry stamps its own clock, a few milliseconds after `now`.
      expect(processing.nextAttemptAt).toBeGreaterThan(now);
      expect(processing.nextAttemptAt).toBeLessThanOrEqual(
        Date.now() + SIX_HOURS,
      );
      expect(processing.nextAttemptAt).toBeLessThanOrEqual(
        processing.windowDeadlineAt ?? 0,
      );
    }
    // The reconciled instance can no longer write (the attempt gate).
    await expectDomainError(stub.markStaged(gone, 3, null), "INVALID_STATE");

    // Due in six hours, not at once: the tick that follows starts nothing for them.
    expect(await runRecoveryTick(env, now)).toEqual({
      reconciled: 0,
      due: 0,
      started: 0,
      blocked: 0,
    });
    expect(createdInstances()).toEqual([]);
  });

  it("starts one final attempt at or after the deadline, and an unsuccessful result settles the window", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    const startedAt = Date.now() - WINDOW - HOUR; // the deadline passed an hour ago
    await due(EPISODE_A, CHANNEL_A, {
      startedAt,
      nextAttemptAt: startedAt + WINDOW,
    });
    await seedEpisode(EPISODE_B, CHANNEL_A, {
      status: "available",
      window: {
        intent: "replace",
        startedAt,
        nextAttemptAt: startedAt + WINDOW,
      },
    });
    await seedSummary(EPISODE_B, { executiveSummary: "Kept." });

    expect(await runRecoveryTick(env)).toEqual({
      reconciled: 0,
      due: 2,
      started: 2,
      blocked: 0,
    });
    const [publish, replace] = createdInstances();
    if (!publish || !replace) throw new Error("expected two instances");
    expect([publish.episodeId, replace.episodeId]).toEqual([
      EPISODE_A,
      EPISODE_B,
    ]);

    await stub.finishAttempt(publish.attemptId, {
      status: "waiting",
      code: "CAPTIONS",
    });
    expect(await episode(CHANNEL_A, EPISODE_A)).toMatchObject({
      status: "failed",
      processing: {
        intent: null,
        nextAttemptAt: null,
        failureCode: "INGESTION_TIMEOUT",
        failureDetail: "CAPTIONS",
      },
    });

    await stub.finishAttempt(replace.attemptId, {
      status: "failed",
      code: "PROVIDER_HTTP",
    });
    expect(await episode(CHANNEL_A, EPISODE_B)).toMatchObject({
      status: "available",
      summary: { executiveSummary: "Kept." },
      processing: { intent: null, nextAttemptAt: null, failureCode: null },
    });
  });

  it("records a blocked attempt per due episode when the provider refuses work, moving it before the deadline and closing the window at it", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const now = Date.now();
    await due(EPISODE_A, CHANNEL_A);
    const startedAt = now - WINDOW - HOUR;
    await due(EPISODE_B, CHANNEL_A, {
      startedAt,
      nextAttemptAt: startedAt + WINDOW,
    });
    env.TRANSCRIPTS_FAKE = JSON.stringify({
      ...FAKE_TRANSCRIPTS,
      status: { status: "ok", remainingCredits: 0 },
    });

    expect(await runRecoveryTick(env, now)).toEqual({
      reconciled: 0,
      due: 2,
      started: 0,
      blocked: 2,
    });
    expect(createdInstances()).toEqual([]);
    const moved = await episode(CHANNEL_A, EPISODE_A);
    expect(moved).toMatchObject({
      status: "pending",
      processing: {
        intent: "publish",
        attemptCount: 0,
        latestAttempt: {
          status: "blocked",
          outcomeCode: "PROVIDER_LIMIT",
          trigger: "scheduled_recovery",
          workflowId: null,
        },
      },
    });
    expect(moved.processing.nextAttemptAt).toBeGreaterThan(now);
    expect(await episode(CHANNEL_A, EPISODE_B)).toMatchObject({
      status: "failed",
      processing: {
        intent: null,
        attemptCount: 0,
        failureCode: "INGESTION_TIMEOUT",
        failureDetail: "PROVIDER_LIMIT",
        latestAttempt: { status: "blocked", outcomeCode: "PROVIDER_LIMIT" },
      },
    });
  });

  it("reads no feed: every channel's feed being unreadable changes nothing", async () => {
    env.YOUTUBE_FEEDS_FAKE = JSON.stringify(
      Object.fromEntries(Object.keys(FAKE_FEEDS).map((id) => [id, null])),
    );
    await seedApprovedChannel(CHANNEL_A, "A");
    await due(EPISODE_A, CHANNEL_A);

    expect(await runRecoveryTick(env)).toEqual({
      reconciled: 0,
      due: 1,
      started: 1,
      blocked: 0,
    });
    expect(createdInstances().map((p) => p.episodeId)).toEqual([EPISODE_A]);
  });
});
