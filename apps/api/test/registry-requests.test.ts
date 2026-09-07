import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  expectDomainError,
  OWNER,
  registry,
} from "./helpers";

const URL_A = `https://www.youtube.com/channel/${CHANNEL_A}`;

describe("registry channel requests", () => {
  it("creates one pending request per user and channel", async () => {
    const stub = registry();
    const first = await stub.submitRequest("  Alice@Example.COM ", {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    const repeat = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: "https://youtube.com/@a-different-url",
    });
    const other = await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });

    expect(first).toMatchObject({
      userEmail: ALICE,
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
      status: "pending",
      approvedChannelId: null,
    });
    expect(repeat.requestId).toBe(first.requestId);
    expect(other.requestId).not.toBe(first.requestId);
  });

  it("stores the feed title captured at submission and keeps the first one", async () => {
    const stub = registry();
    const titled = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
      channelTitle: "  Channel A  ",
    });
    expect(titled.channelTitle).toBe("Channel A");

    const blank = await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_B,
      submittedUrl: "u",
      channelTitle: "   ",
    });
    expect(blank.channelTitle).toBeNull();

    const omitted = await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    expect(omitted.channelTitle).toBeNull();

    // A repeat submission returns the existing row; it never rewrites the stored title.
    const repeat = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
      channelTitle: "Renamed",
    });
    expect(repeat.requestId).toBe(titled.requestId);
    expect(repeat.channelTitle).toBe("Channel A");
  });

  it("shows requesters only their own requests; the owner sees all", async () => {
    const stub = registry();
    await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_B,
      submittedUrl: "u",
    });

    const alice = await stub.listOwnRequests(ALICE);
    expect(alice.map((r) => r.youtubeChannelId)).toEqual([CHANNEL_A]);
    expect(await stub.listOwnRequests("nobody@example.com")).toEqual([]);

    expect(await stub.listAllRequests(OWNER)).toHaveLength(2);
    await expectDomainError(stub.listAllRequests(ALICE), "NOT_OWNER");
  });

  it("approval creates the shared channel once and reuses it for later requesters", async () => {
    const stub = registry();
    const a = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    const b = await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });

    const firstApproval = await stub.approveRequest(OWNER, a.requestId, {
      title: "Channel A",
      explanation: "  welcome  ",
    });
    expect(firstApproval.channelCreated).toBe(true);
    expect(firstApproval.channel).toMatchObject({
      channelId: CHANNEL_A,
      status: "pending",
    });
    expect(firstApproval.request).toMatchObject({
      status: "approved",
      reviewedByEmail: OWNER,
      approvedChannelId: CHANNEL_A,
      ownerExplanation: "welcome",
      autoFollowCompletedAt: null,
    });
    expect(firstApproval.request.reviewedAt).not.toBeNull();

    const secondApproval = await stub.approveRequest(OWNER, b.requestId, {
      title: "Ignored: channel already exists",
    });
    expect(secondApproval.channelCreated).toBe(false);
    expect(secondApproval.channel.title).toBe("Channel A");
    expect(secondApproval.request.approvedChannelId).toBe(CHANNEL_A);
    expect(await stub.listChannels(OWNER)).toHaveLength(1);
  });

  it("approval defaults the title from the request and refuses a deleted channel", async () => {
    const stub = registry();

    const stored = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
      channelTitle: "Stored Title",
    });
    const approved = await stub.approveRequest(OWNER, stored.requestId);
    expect(approved.channelCreated).toBe(true);
    expect(approved.channel.title).toBe("Stored Title");

    const untitled = await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_B,
      submittedUrl: "u",
    });
    await expectDomainError(
      stub.approveRequest(OWNER, untitled.requestId),
      "INVALID_INPUT",
    );
    const explicit = await stub.approveRequest(OWNER, untitled.requestId, {
      title: "Given Title",
    });
    expect(explicit.channel.title).toBe("Given Title");

    // A deleted channel is never resurrected by approval; the owner restores it first.
    await stub.deleteChannel(OWNER, CHANNEL_A);
    const late = await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    await expectDomainError(
      stub.approveRequest(OWNER, late.requestId),
      "INVALID_STATE",
    );
    expect((await stub.listOwnRequests(BOB)).map((r) => r.status)).toEqual([
      "pending",
      "approved",
    ]);
    await stub.restoreChannel(OWNER, CHANNEL_A);
    expect(
      (await stub.approveRequest(OWNER, late.requestId)).channelCreated,
    ).toBe(false);
  });

  it("lists every requester's request for a channel, owner only", async () => {
    const stub = registry();
    await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });
    await stub.submitRequest(BOB, {
      youtubeChannelId: CHANNEL_B,
      submittedUrl: "u",
    });

    const forA = await stub.listRequestsForChannel(OWNER, CHANNEL_A);
    expect(forA.map((r) => r.userEmail).sort()).toEqual([ALICE, BOB]);
    expect(await stub.listRequestsForChannel(OWNER, CHANNEL_B)).toHaveLength(1);
    await expectDomainError(
      stub.listRequestsForChannel(ALICE, CHANNEL_A),
      "NOT_OWNER",
    );
  });

  it("rejects with reviewer and optional explanation", async () => {
    const stub = registry();
    const a = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });

    const rejected = await stub.rejectRequest(OWNER, a.requestId, {
      explanation: "no",
    });
    expect(rejected).toMatchObject({
      status: "rejected",
      reviewedByEmail: OWNER,
      ownerExplanation: "no",
      approvedChannelId: null,
    });
    expect(await stub.listChannels(OWNER)).toEqual([]);
  });

  it("only pending requests can be reviewed, and only by the owner", async () => {
    const stub = registry();
    const a = await stub.submitRequest(ALICE, {
      youtubeChannelId: CHANNEL_A,
      submittedUrl: URL_A,
    });

    await expectDomainError(
      stub.approveRequest(ALICE, a.requestId, { title: "x" }),
      "NOT_OWNER",
    );
    await expectDomainError(
      stub.rejectRequest(ALICE, a.requestId),
      "NOT_OWNER",
    );

    await stub.approveRequest(OWNER, a.requestId, { title: "Channel A" });
    await expectDomainError(
      stub.approveRequest(OWNER, a.requestId, { title: "x" }),
      "INVALID_STATE",
    );
    await expectDomainError(
      stub.rejectRequest(OWNER, a.requestId),
      "INVALID_STATE",
    );
    await expectDomainError(stub.rejectRequest(OWNER, "missing"), "NOT_FOUND");
  });

  it("validates request input", async () => {
    const stub = registry();
    await expectDomainError(
      stub.submitRequest(ALICE, {
        youtubeChannelId: "@handle",
        submittedUrl: URL_A,
      }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.submitRequest(ALICE, {
        youtubeChannelId: CHANNEL_A,
        submittedUrl: "  ",
      }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.submitRequest("nope", {
        youtubeChannelId: CHANNEL_A,
        submittedUrl: URL_A,
      }),
      "INVALID_INPUT",
    );
  });
});
