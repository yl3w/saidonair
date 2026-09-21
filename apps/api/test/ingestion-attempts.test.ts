import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { EpisodeRetryResponseSchema } from "@media-digest/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  preflight,
  startDelaySec,
  startEpisodeAttempts,
} from "../src/lib/ingestion";
import { createdInstances } from "../src/lib/workflows";
import { FAKE_TRANSCRIPTS } from "./fixtures/transcripts";
import {
  CHANNEL_A,
  declineAs,
  EPISODE_A,
  EPISODE_B,
  EPISODE_C,
  expectShape,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  seedSummary,
  signedIn,
} from "./helpers";

type Json = Record<string, unknown>;

async function call(
  email: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers: {
      ...(await signedIn(email)),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Json };
}

async function pendingNow(episodeId: string) {
  await seedEpisode(episodeId, CHANNEL_A, {
    status: "pending",
    window: { intent: "publish", startedAt: Date.now() },
  });
  const record = await registry().getEpisode(CHANNEL_A, episodeId);
  if (!record) throw new Error("seed failed");
  return record;
}

function withProviderStatus(status: {
  remainingCredits: number | null;
  status: "ok" | "auth_failed" | "unreachable";
}) {
  env.TRANSCRIPTS_FAKE = JSON.stringify({ ...FAKE_TRANSCRIPTS, status });
}

afterEach(() => {
  env.TRANSCRIPTS_FAKE = JSON.stringify(FAKE_TRANSCRIPTS);
  env.WORKFLOW_FAKE = JSON.stringify({ default: "active" });
});

describe("the attempt starter", () => {
  it("spaces a batch three seconds apart, reports a running one, and records a lost launch", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const episodes = [
      await pendingNow(EPISODE_A),
      await pendingNow(EPISODE_B),
      await pendingNow(EPISODE_C),
    ];

    const results = await startEpisodeAttempts(
      env,
      episodes,
      "channel_ingestion",
    );
    expect(results.map((r) => r.kind)).toEqual([
      "started",
      "started",
      "started",
    ]);
    expect(
      createdInstances().map((p) => [p.episodeId, p.startDelaySec]),
    ).toEqual([
      [EPISODE_A, 0],
      [EPISODE_B, 3],
      [EPISODE_C, 6],
    ]);
    expect(createdInstances().map((p) => p.attemptId)).toEqual(
      results.map((r) => r.attempt.attemptId),
    );
    for (const episodeId of [EPISODE_A, EPISODE_B, EPISODE_C]) {
      expect(
        (await registry().getEpisode(CHANNEL_A, episodeId))?.processing,
      ).toMatchObject({
        attemptCount: 1,
        latestAttempt: { status: "running", trigger: "channel_ingestion" },
      });
    }

    const again = await startEpisodeAttempts(
      env,
      [episodes[0] as never],
      "scheduled_recovery",
    );
    expect(again).toEqual([
      { episodeId: EPISODE_A, kind: "running", attempt: results[0]?.attempt },
    ]);
    expect(createdInstances()).toHaveLength(3);

    env.WORKFLOW_FAKE = JSON.stringify({
      default: "active",
      createThrows: ["ddddddddddd"],
    });
    const lost = await startEpisodeAttempts(
      env,
      [await pendingNow("ddddddddddd")],
      "channel_ingestion",
    );
    expect(lost[0]).toMatchObject({
      kind: "lost",
      attempt: { status: "failed", outcomeCode: "WORKFLOW_LOST" },
    });
    expect(
      (await registry().getEpisode(CHANNEL_A, "ddddddddddd"))?.processing,
    ).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: expect.any(Number),
      failureCode: null,
    });
    expect(createdInstances()).toHaveLength(3);
  });

  it("records a blocked attempt per episode when the provider refuses work, and launches nothing", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const a = await pendingNow(EPISODE_A);
    withProviderStatus({ remainingCredits: 0, status: "ok" });
    const limited = await startEpisodeAttempts(env, [a], "scheduled_recovery");
    expect(limited[0]).toMatchObject({
      kind: "blocked",
      attempt: {
        status: "blocked",
        outcomeCode: "PROVIDER_LIMIT",
        workflowId: null,
      },
    });
    withProviderStatus({ remainingCredits: null, status: "auth_failed" });
    const rejected = await startEpisodeAttempts(env, [a], "scheduled_recovery");
    expect(rejected[0]).toMatchObject({
      kind: "blocked",
      attempt: { outcomeCode: "PROVIDER_AUTH" },
    });
    expect(createdInstances()).toEqual([]);
    expect(
      (await registry().getEpisode(CHANNEL_A, EPISODE_A))?.processing
        .attemptCount,
    ).toBe(0);
    // Unreachable never blocks.
    withProviderStatus({ remainingCredits: null, status: "unreachable" });
    expect(
      (await startEpisodeAttempts(env, [a], "scheduled_recovery"))[0]?.kind,
    ).toBe("started");
  });

  it("pre-flight and stagger are pure", () => {
    expect(preflight({ remainingCredits: 5, status: "ok" })).toBeNull();
    expect(preflight({ remainingCredits: 0, status: "ok" })).toBe(
      "PROVIDER_LIMIT",
    );
    expect(preflight({ remainingCredits: null, status: "auth_failed" })).toBe(
      "PROVIDER_AUTH",
    );
    expect(
      preflight({ remainingCredits: null, status: "unreachable" }),
    ).toBeNull();
    expect([0, 1, 2, 5].map(startDelaySec)).toEqual([0, 3, 6, 15]);
  });
});

describe("POST /channels/:id/episodes/:episodeId/retry", () => {
  it("reopens the window and starts one attempt at once, in any channel status", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, { status: "failed" });
    await seedEpisode(EPISODE_B, CHANNEL_A, { status: "available" });
    await seedSummary(EPISODE_B);
    await declineAs(OWNER, CHANNEL_A);
    const runsBefore = await stub.listRuns(CHANNEL_A);

    const retry = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/retry`,
    );
    expectShape(EpisodeRetryResponseSchema, retry.json);
    expect(retry.status).toBe(200);
    expect(retry.json.episode).toMatchObject({
      status: "pending",
      processing: {
        intent: "publish",
        attemptCount: 1,
        latestAttempt: { status: "running" },
      },
    });
    expect(retry.json.attempt).toMatchObject({
      status: "running",
      trigger: "owner_retry",
      requestedByEmail: OWNER,
      intent: "publish",
    });
    expect(createdInstances()).toEqual([
      {
        attemptId: (retry.json.attempt as Json).attemptId,
        episodeId: EPISODE_A,
        channelId: CHANNEL_A,
        startDelaySec: 0,
      },
    ]);
    // The sibling and the channel are untouched.
    expect(
      (await stub.getEpisode(CHANNEL_A, EPISODE_B))?.processing.latestAttempt,
    ).toBeNull();
    expect(await stub.getChannel(CHANNEL_A)).toEqual(
      await stub.getChannel(CHANNEL_A),
    );
    expect((await stub.getChannel(CHANNEL_A))?.lastCheckedAt).toBe(
      channel.lastCheckedAt,
    );
    expect(await stub.listRuns(CHANNEL_A)).toEqual(runsBefore);

    // Retry of an available episode opens a replacement.
    const replace = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_B}/retry`,
    );
    expect(replace.status).toBe(200);
    expect(replace.json.episode).toMatchObject({
      status: "available",
      summary: { format: "structured" },
    });
    expect(replace.json.attempt).toMatchObject({
      intent: "replace",
      status: "running",
    });
  });

  it("refuses a running attempt under an hour old, asks the engine about an older one, and reconciles a lost instance inline", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, {
      status: "pending",
      window: { intent: "publish", startedAt: Date.now() },
    });
    const start = await stub.beginAttempt(EPISODE_A, "channel_ingestion");
    if (start.kind !== "started") throw new Error("expected started");
    const runningId = start.attempt.attemptId;

    const young = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/retry`,
    );
    expect(young.status).toBe(409);
    expect(young.json.code).toBe("INVALID_STATE");

    // Age the attempt past an hour.
    await runInDurableObject(stub, (_, ctx) => {
      ctx.storage.sql.exec(
        "UPDATE episode_ingestion_attempts SET started_at = ?, created_at = ? WHERE attempt_id = ?",
        Date.now() - 2 * 60 * 60 * 1000,
        Date.now() - 2 * 60 * 60 * 1000,
        runningId,
      );
    });
    env.WORKFLOW_FAKE = JSON.stringify({
      default: "active",
      instances: { [runningId]: "active" },
    });
    expect(
      (
        await call(
          OWNER,
          "POST",
          `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/retry`,
        )
      ).status,
    ).toBe(409);

    env.WORKFLOW_FAKE = JSON.stringify({
      default: "active",
      instances: { [runningId]: "gone" },
    });
    const reconciled = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/retry`,
    );
    expect(reconciled.status).toBe(200);
    expect((reconciled.json.attempt as Json).attemptId).not.toBe(runningId);
    expect(reconciled.json.attempt).toMatchObject({
      status: "running",
      trigger: "owner_retry",
    });
    expect((await stub.describeAttempt(runningId)).attempt).toMatchObject({
      status: "failed",
      outcomeCode: "WORKFLOW_LOST",
    });
    expect(createdInstances().map((p) => p.attemptId)).toEqual([
      (reconciled.json.attempt as Json).attemptId,
    ]);
  });

  it("records a blocked attempt and leaves the episode untouched when the provider refuses work", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, {
      status: "failed",
      failureDetail: "CAPTIONS",
    });
    const before = await stub.getEpisode(CHANNEL_A, EPISODE_A);
    withProviderStatus({ remainingCredits: 0, status: "ok" });

    const blocked = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/retry`,
    );
    expectShape(EpisodeRetryResponseSchema, blocked.json);
    expect(blocked.status).toBe(200);
    expect(blocked.json.attempt).toMatchObject({
      status: "blocked",
      outcomeCode: "PROVIDER_LIMIT",
      trigger: "owner_retry",
      requestedByEmail: OWNER,
      workflowId: null,
    });
    const after = blocked.json.episode as Json;
    expect(after).toMatchObject({ status: "failed" });
    expect(after.processing).toMatchObject({
      intent: null,
      windowStartedAt: null,
      attemptCount: before?.processing.attemptCount,
      failureCode: "INGESTION_TIMEOUT",
      failureDetail: "CAPTIONS",
    });
    expect(createdInstances()).toEqual([]);
  });
});
