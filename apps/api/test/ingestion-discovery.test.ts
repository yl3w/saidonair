import {
  createExecutionContext,
  createScheduledController,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ChannelResponseSchema,
  EpisodesResponseSchema,
  IngestionRunResponseSchema,
  IngestionRunsResponseSchema,
} from "@media-digest/shared";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  DISCOVERY_CRON,
  runDiscoveryTick,
  startDiscovery,
} from "../src/lib/ingestion";
import { createdInstances } from "../src/lib/workflows";
import { CHANNEL_F, CHANNEL_G, FEED_F_ENTRIES } from "./fixtures/feeds";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  CHANNEL_E,
  declineAs,
  expectShape,
  OWNER,
  registry,
  seedApprovedChannel,
  signedIn,
} from "./helpers";

type Json = Record<string, unknown>;

async function call(
  email: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
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

const NEWEST_FIVE = FEED_F_ENTRIES.slice(0, 5).map((e) => e.videoId);

// Every count in this file is also an assertion about *which* feed was read: F's entries are
// registered under its long-form key alone and its `channel_id=` feed is title-only, so a discovery
// run that fell back to the channel feed would discover nothing (spec §7.4, no fallback).

describe("discovery on approval", () => {
  it("performs the initial run at first approval, answers with it, and does nothing on re-approval", async () => {
    const stub = registry();
    const created = await call(ALICE, "POST", "/channels", {
      channelId: CHANNEL_F,
      initialImportCount: 5,
    });
    expect(created.status).toBe(201);

    const before = Date.now();
    const approved = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_F}/approve`,
      {},
    );
    expectShape(ChannelResponseSchema, approved.json);
    expect(approved.status).toBe(200);
    const channel = approved.json.channel as Json;
    expect(channel).toMatchObject({
      status: "approved",
      paused: false, // Alice follows it
      episodes: { pending: 5, available: 0, failed: 0, skipped: 0 },
      management: {
        neverStarted: false,
        latestRun: {
          kind: "initial",
          feedStatus: "read",
          discoveredCount: 5,
          episodeLimit: 5,
        },
      },
    });
    const management = channel.management as Json;
    const run = management.latestRun as Json;
    expect(management.lastCheckedAt).toBeGreaterThanOrEqual(before);

    const episodes = await call(
      ALICE,
      "GET",
      `/channels/${CHANNEL_F}/episodes`,
    );
    expectShape(EpisodesResponseSchema, episodes.json);
    const rows = episodes.json.episodes as Json[];
    expect(rows.map((e) => e.episodeId)).toEqual(NEWEST_FIVE);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "pending",
        waitReason: null,
        summary: null,
      });
      expect(row.processing).toMatchObject({
        discoveredByRunId: run.runId,
        intent: "publish",
        attemptCount: 1,
        latestAttempt: { status: "running", trigger: "channel_ingestion" },
      });
    }
    // Every new episode started its first attempt at once, three seconds apart (PRD §4.2 rules 5 and 8).
    expect(
      createdInstances().map((p) => [p.episodeId, p.startDelaySec]),
    ).toEqual(NEWEST_FIVE.map((episodeId, k) => [episodeId, k * 3]));
    const runs = await call(ALICE, "GET", `/channels/${CHANNEL_F}/runs`);
    expectShape(IngestionRunsResponseSchema, runs.json);
    expect(runs.json.runs).toHaveLength(1);

    // Re-approval after a decline starts nothing: the channel waits for the next scheduled discovery.
    await declineAs(OWNER, CHANNEL_F);
    const again = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_F}/approve`,
      {},
    );
    expect(again.status).toBe(200);
    expect((again.json.channel as Json).management).toMatchObject({
      latestRun: { runId: run.runId },
    });
    expect(await stub.listRuns(CHANNEL_F)).toHaveLength(1);
    expect(
      await stub.listEpisodes(CHANNEL_F, { relatedScope: [] }),
    ).toHaveLength(5);
  });

  it("discovers even when approval pauses the channel for having no followers", async () => {
    await registry().createChannel({ channelId: CHANNEL_F, title: "F" });
    const approved = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_F}/approve`,
      {},
    );
    expect(approved.json.channel).toMatchObject({
      paused: true,
      management: {
        pausedBy: "system",
        latestRun: { kind: "initial", discoveredCount: 5 },
      },
    });
  });
});

describe("POST /channels/:id/runs", () => {
  it("checks the feed now for an approved channel, paused or not, and refuses the other statuses", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_F, "F"); // the facade: no discovery has run yet

    const first = await call(OWNER, "POST", `/channels/${CHANNEL_F}/runs`);
    expectShape(IngestionRunResponseSchema, first.json);
    expect(first.status).toBe(200);
    expect(first.json.run).toMatchObject({
      channelId: CHANNEL_F,
      kind: "initial",
      feedStatus: "read",
      discoveredCount: 5,
      episodeLimit: 5,
    });
    // Paused by the system (nobody follows), and then by the owner: Start still works.
    expect(
      (await call(ALICE, "GET", `/channels/${CHANNEL_F}`)).json.channel,
    ).toMatchObject({ paused: true });
    const second = await call(OWNER, "POST", `/channels/${CHANNEL_F}/runs`);
    expect(second.status).toBe(200);
    expect(second.json.run).toMatchObject({
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 0,
      episodeLimit: null,
    });
    await stub.resumeChannel(CHANNEL_F);
    await call(OWNER, "POST", `/channels/${CHANNEL_F}/pause`, {});
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_F}/runs`)).status,
    ).toBe(200);
    expect(await stub.listRuns(CHANNEL_F)).toHaveLength(3);

    // A channel whose long-form feed 404s: the unavailable run is recorded, then 502. No fallback
    // to `channel_id=`, which would have answered here (spec §7.4).
    await seedApprovedChannel(CHANNEL_G, "G");
    const unavailable = await call(
      OWNER,
      "POST",
      `/channels/${CHANNEL_G}/runs`,
    );
    expect(unavailable.status).toBe(502);
    expect(unavailable.json.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(await stub.listRuns(CHANNEL_G)).toMatchObject([
      { channelId: CHANNEL_G, feedStatus: "unavailable", discoveredCount: 0 },
    ]);
    expect((await stub.getChannel(CHANNEL_G))?.lastCheckedAt).toBeNull();
    expect(await stub.listEpisodes(CHANNEL_G, { relatedScope: [] })).toEqual(
      [],
    );

    await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
    const requested = await call(OWNER, "POST", `/channels/${CHANNEL_B}/runs`);
    expect(requested.status).toBe(409);
    expect(requested.json.code).toBe("INVALID_STATE");
    await seedApprovedChannel(CHANNEL_C, "C");
    await declineAs(OWNER, CHANNEL_C);
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_C}/runs`)).status,
    ).toBe(409);
    expect(
      (await call(OWNER, "POST", `/channels/${CHANNEL_D}/runs`)).status,
    ).toBe(404);
    expect((await call(OWNER, "POST", "/channels/not-an-id/runs")).status).toBe(
      400,
    );
    expect(await stub.listRuns(CHANNEL_C)).toEqual([]);
  });

  it("records an unavailable run and answers 502 when YouTube does not answer", async () => {
    await seedApprovedChannel(CHANNEL_E, "E"); // the fake answers 404 for E
    const start = await call(OWNER, "POST", `/channels/${CHANNEL_E}/runs`);
    expect(start.status).toBe(502);
    expect(start.json.code).toBe("UPSTREAM_UNAVAILABLE");
    const runs = await call(OWNER, "GET", `/channels/${CHANNEL_E}/runs`);
    expect(runs.json.runs).toEqual([
      expect.objectContaining({
        kind: "initial",
        feedStatus: "unavailable",
        discoveredCount: 0,
      }),
    ]);
    expect(
      (await call(OWNER, "GET", `/channels/${CHANNEL_E}`)).json.channel,
    ).toMatchObject({
      management: {
        lastCheckedAt: null,
        neverStarted: false,
        latestRun: { feedStatus: "unavailable" },
      },
    });
  });
});

describe("startDiscovery", () => {
  it("creates only untracked entries published after the first approval on a later run", async () => {
    const stub = registry();
    const channel = await seedApprovedChannel(CHANNEL_F, "F");
    const approvedAt = channel.approvedAt ?? 0;
    const initial = await startDiscovery(env, CHANNEL_F);
    expect(initial.run).toMatchObject({ kind: "initial", discoveredCount: 5 });

    const later = await startDiscovery(env, CHANNEL_F, {
      feed: {
        channelId: CHANNEL_F,
        title: "F",
        entries: [
          {
            videoId: "newupload01",
            title: "New",
            publishedAt: approvedAt + 1_000,
          },
          ...FEED_F_ENTRIES, // five tracked, ten untracked but older than the approval
        ],
      },
    });
    expect(later.run).toMatchObject({
      kind: "scheduled",
      feedStatus: "read",
      discoveredCount: 1,
      episodeLimit: null,
    });
    expect(later.created.map((e) => e.episodeId)).toEqual(["newupload01"]);
    expect(
      await stub.listEpisodes(CHANNEL_F, { relatedScope: [] }),
    ).toHaveLength(6);

    const unavailable = await startDiscovery(env, CHANNEL_F, { feed: null });
    expect(unavailable.run).toMatchObject({
      kind: "scheduled",
      feedStatus: "unavailable",
      discoveredCount: 0,
    });
    expect(unavailable.created).toEqual([]);
    expect((await stub.listRuns(CHANNEL_F)).map((r) => r.feedStatus)).toEqual([
      "unavailable",
      "read",
      "read",
    ]);
  });
});

describe("the discovery cron", () => {
  it("checks approved, unpaused channels only, and one unreadable feed does not stop the others", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.resumeChannel(CHANNEL_A); // title-only feed: read, nothing discovered
    await seedApprovedChannel(CHANNEL_F, "F");
    await stub.resumeChannel(CHANNEL_F);
    await seedApprovedChannel(CHANNEL_B, "B"); // stays system-paused
    await stub.createChannel({ channelId: CHANNEL_C, title: "C" }); // requested
    await seedApprovedChannel(CHANNEL_D, "D");
    await declineAs(OWNER, CHANNEL_D);
    await seedApprovedChannel(CHANNEL_E, "E"); // feed answers 404
    await stub.resumeChannel(CHANNEL_E);

    await scheduled(DISCOVERY_CRON);

    expect(await stub.listRuns(CHANNEL_A)).toEqual([
      expect.objectContaining({
        kind: "initial",
        feedStatus: "read",
        discoveredCount: 0,
      }),
    ]);
    expect(await stub.listRuns(CHANNEL_F)).toEqual([
      expect.objectContaining({
        kind: "initial",
        feedStatus: "read",
        discoveredCount: 5,
      }),
    ]);
    expect(await stub.listRuns(CHANNEL_E)).toEqual([
      expect.objectContaining({ kind: "initial", feedStatus: "unavailable" }),
    ]);
    for (const untouched of [CHANNEL_B, CHANNEL_C, CHANNEL_D]) {
      expect(await stub.listRuns(untouched)).toEqual([]);
    }

    // Five launches for F's five new episodes, none for A's empty feed.
    expect(createdInstances().map((p) => p.channelId)).toEqual(
      Array(5).fill(CHANNEL_F),
    );
    // The tick's own account of itself, on a second pass: F now reads "nothing new".
    expect(await runDiscoveryTick(env)).toEqual({
      channels: 3,
      read: 2,
      unavailable: 1,
      failed: 0,
    });
    expect(await stub.listRuns(CHANNEL_F)).toHaveLength(2);
    expect((await stub.listRuns(CHANNEL_F))[0]).toMatchObject({
      kind: "scheduled",
      discoveredCount: 0,
    });
  });

  it("ignores a cron expression it does not know", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.resumeChannel(CHANNEL_A);
    await scheduled("* * * * *");
    expect(await stub.listRuns(CHANNEL_A)).toEqual([]);
  });
});
