import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ALICE,
  CHANNEL_A,
  EPISODE_A,
  OWNER,
  registry,
  seedApprovedChannel,
  seedEpisode,
  signedIn,
} from "./helpers";

/**
 * The seven catalog operations, refused for anybody but the owner (docs/PRD.md §2, rewritten
 * 2026-09-20). Authentication alone did not close this: a stranger with a valid Google account has
 * a valid session, and until A8 could approve channels with it.
 *
 * Each case asserts the refusal **and that nothing moved**. A 403 that has already written is the
 * bug worth catching, and it is the one a status-code-only test would miss.
 */
async function as(email: string, method: string, path: string, body?: unknown) {
  const response = await SELF.fetch(`http://api${path}`, {
    method,
    headers: {
      ...(await signedIn(email)),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe("catalog operations are the owner's", () => {
  it("refuses all seven for a signed-in stranger, and writes nothing", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    await seedEpisode(EPISODE_A, CHANNEL_A, { status: "failed" });
    const before = await state();

    const operations: [string, string, unknown?][] = [
      ["POST", `/channels/${CHANNEL_A}/approve`, {}],
      ["POST", `/channels/${CHANNEL_A}/decline`, {}],
      ["POST", `/channels/${CHANNEL_A}/pause`],
      ["POST", `/channels/${CHANNEL_A}/resume`],
      ["POST", `/channels/${CHANNEL_A}/runs`],
      ["POST", `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/retry`],
      ["POST", `/channels/${CHANNEL_A}/episodes/${EPISODE_A}/skip`],
    ];
    for (const [method, path, body] of operations) {
      const response = await as(ALICE, method, path, body);
      expect(response.status, path).toBe(403);
      expect(response.json, path).toMatchObject({ code: "FORBIDDEN" });
    }

    // The channel's status and pause, the episode's status, and the ledger: all as they were.
    expect(await state()).toEqual(before);
  });

  it("allows the owner the same seven", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    const paused = await as(OWNER, "POST", `/channels/${CHANNEL_A}/pause`);
    expect(paused.status).toBe(200);
    const resumed = await as(OWNER, "POST", `/channels/${CHANNEL_A}/resume`);
    expect(resumed.status).toBe(200);
  });

  it("leaves reading open to everyone, which is the design and not an oversight", async () => {
    await seedApprovedChannel(CHANNEL_A, "A");
    for (const path of [
      "/catalog",
      "/channels",
      `/channels/${CHANNEL_A}`,
      `/channels/${CHANNEL_A}/followers`,
      `/channels/${CHANNEL_A}/runs`,
    ]) {
      const response = await as(ALICE, "GET", path);
      expect(response.status, path).toBe(200);
    }
  });
});

/** Everything the seven operations could have changed, in one shape. */
async function state() {
  const stub = registry();
  const channel = await stub.getChannel(CHANNEL_A);
  const episodes = await stub.listEpisodes(CHANNEL_A, { relatedScope: [] });
  const runs = await stub.listRuns(CHANNEL_A);
  return {
    status: channel?.status,
    pausedBy: channel?.pausedBy,
    reviewedByUserId: channel?.reviewedByUserId,
    episodes: episodes.map((e) => ({
      id: e.episodeId,
      status: e.status,
      attempts: e.processing.attemptCount,
      skipReason: e.skipReason,
    })),
    runs: runs.length,
  };
}
