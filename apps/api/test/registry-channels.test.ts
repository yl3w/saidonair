import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  expectDomainError,
  OWNER,
  registry,
} from "./helpers";

describe("registry channels", () => {
  it("users create requested channels, the owner creates approved ones, never twice", async () => {
    const stub = registry();
    const requested = await stub.createChannel(ALICE, {
      channelId: CHANNEL_A,
      title: "A",
      status: "requested",
    });
    expect(requested).toMatchObject({
      status: "requested",
      approvedAt: null,
      reviewedAt: null,
      pausedBy: null,
      lifecycleVersion: 1,
    });
    await expectDomainError(
      stub.createChannel(ALICE, {
        channelId: CHANNEL_B,
        title: "B",
        status: "approved",
      }),
      "NOT_OWNER",
    );
    const approved = await stub.createChannel(OWNER, {
      channelId: CHANNEL_B,
      title: "B",
      status: "approved",
    });
    expect(approved).toMatchObject({
      status: "approved",
      reviewedByEmail: OWNER,
    });
    expect(approved.approvedAt).not.toBeNull();
    await expectDomainError(
      stub.createChannel(ALICE, {
        channelId: CHANNEL_A,
        title: "A",
        status: "requested",
      }),
      "INVALID_STATE",
    );
  });

  it("approve sets approved_at once and reports whether the import should start", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, {
      channelId: CHANNEL_A,
      title: "A",
      status: "requested",
    });
    const first = await stub.approveChannel(OWNER, CHANNEL_A, {
      title: "Better",
      explanation: "ok",
    });
    expect(first.importStarts).toBe(true);
    expect(first.channel).toMatchObject({
      status: "approved",
      title: "Better",
      reviewNote: "ok",
      reviewedByEmail: OWNER,
    });
    await expectDomainError(
      stub.approveChannel(OWNER, CHANNEL_A),
      "INVALID_STATE",
    );
    await expectDomainError(stub.approveChannel(ALICE, CHANNEL_A), "NOT_OWNER");

    const declined = await stub.declineChannel(OWNER, CHANNEL_A, {
      explanation: "withdrawn",
    });
    expect(declined).toMatchObject({
      status: "declined",
      lifecycleVersion: 2,
      reviewNote: "withdrawn",
      pausedBy: null,
    });
    const again = await stub.approveChannel(OWNER, CHANNEL_A);
    expect(again.importStarts).toBe(false);
    expect(again.channel.approvedAt).toBe(first.channel.approvedAt);
  });

  it("decline from requested keeps the fence; request again reopens and keeps the note", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, {
      channelId: CHANNEL_A,
      title: "A",
      status: "requested",
    });
    const declined = await stub.declineChannel(OWNER, CHANNEL_A, {
      explanation: "no",
    });
    expect(declined).toMatchObject({
      status: "declined",
      lifecycleVersion: 1,
      reviewNote: "no",
    });
    await expectDomainError(
      stub.declineChannel(OWNER, CHANNEL_A),
      "INVALID_STATE",
    );
    const reopened = await stub.requestChannel(BOB, CHANNEL_A);
    expect(reopened).toMatchObject({
      status: "requested",
      reviewNote: "no",
      reviewedByEmail: OWNER,
    });
    await expectDomainError(
      stub.requestChannel(BOB, CHANNEL_A),
      "INVALID_STATE",
    );
  });

  it("pause and resume apply to approved channels only, idempotently", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, {
      channelId: CHANNEL_A,
      title: "A",
      status: "approved",
    });
    await stub.createChannel(ALICE, {
      channelId: CHANNEL_B,
      title: "B",
      status: "requested",
    });
    const paused = await stub.pauseChannel(OWNER, CHANNEL_A);
    expect(paused.pausedBy).toBe("owner");
    expect(paused.pausedAt).not.toBeNull();
    expect(await stub.pauseChannel(OWNER, CHANNEL_A)).toEqual(paused);
    expect((await stub.resumeChannel(OWNER, CHANNEL_A)).pausedBy).toBeNull();
    await expectDomainError(
      stub.pauseChannel(OWNER, CHANNEL_B),
      "INVALID_STATE",
    );
    await expectDomainError(stub.pauseChannel(ALICE, CHANNEL_A), "NOT_OWNER");
  });

  it("lists requested and approved publicly; declined only by id or to the owner", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, {
      channelId: CHANNEL_A,
      title: "A",
      status: "requested",
    });
    await stub.createChannel(OWNER, {
      channelId: CHANNEL_B,
      title: "B",
      status: "approved",
    });
    await stub.createChannel(ALICE, {
      channelId: CHANNEL_C,
      title: "C",
      status: "requested",
    });
    await stub.declineChannel(OWNER, CHANNEL_C);
    expect((await stub.listCatalogChannels()).map((c) => c.channelId)).toEqual([
      CHANNEL_A,
      CHANNEL_B,
    ]);
    expect(
      (await stub.listChannels(OWNER)).map((c) => c.channelId).sort(),
    ).toEqual([CHANNEL_A, CHANNEL_B, CHANNEL_C]);
    expect((await stub.getChannel(CHANNEL_C))?.status).toBe("declined");
    await expectDomainError(stub.listChannels(ALICE), "NOT_OWNER");
  });

  it("validates configuration input", async () => {
    const stub = registry();
    await expectDomainError(
      stub.createChannel(OWNER, {
        channelId: "not-a-channel",
        title: "x",
        status: "approved",
      }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.createChannel(OWNER, {
        channelId: CHANNEL_A,
        title: "   ",
        status: "approved",
      }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.createChannel(OWNER, {
        channelId: CHANNEL_A,
        title: "A",
        status: "approved",
        initialImportCount: 0,
      }),
      "INVALID_INPUT",
    );
    await expectDomainError(stub.approveChannel(OWNER, CHANNEL_B), "NOT_FOUND");
    // An email nobody has registered is not an owner either.
    await expectDomainError(
      stub.createChannel("ghost@example.com", {
        channelId: CHANNEL_A,
        title: "A",
        status: "approved",
      }),
      "NOT_OWNER",
    );
  });
});
