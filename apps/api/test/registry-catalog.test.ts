import { describe, expect, it } from "vitest";
import {
  ALICE,
  CHANNEL_A,
  CHANNEL_B,
  expectDomainError,
  OWNER,
  registry,
  setChannelState,
} from "./helpers";

const INPUT_A = { channelId: CHANNEL_A, title: "Channel A" };

describe("registry catalog (owner-only mutations)", () => {
  it("rejects every catalog mutation and the owner listing from a non-owner", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);

    await expectDomainError(stub.createChannel(ALICE, INPUT_A), "NOT_OWNER");
    await expectDomainError(stub.retryChannel(ALICE, CHANNEL_A), "NOT_OWNER");
    await expectDomainError(stub.deleteChannel(ALICE, CHANNEL_A), "NOT_OWNER");
    await expectDomainError(stub.restoreChannel(ALICE, CHANNEL_A), "NOT_OWNER");
    await expectDomainError(stub.listChannels(ALICE), "NOT_OWNER");
    // An email nobody has registered is not an owner either.
    await expectDomainError(
      stub.createChannel("ghost@example.com", INPUT_A),
      "NOT_OWNER",
    );
  });

  it("create makes a pending channel with defaults", async () => {
    const channel = await registry().createChannel(OWNER, INPUT_A);

    expect(channel).toMatchObject({
      channelId: CHANNEL_A,
      title: "Channel A",
      canonicalUrl: `https://www.youtube.com/channel/${CHANNEL_A}`,
      status: "pending",
      initialImportCount: 5,
      failureCode: null,
      deletedAt: null,
      lifecycleVersion: 1,
    });
  });

  it("create refuses a duplicate id and leaves the existing channel untouched", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, { ...INPUT_A, initialImportCount: 3 });
    await setChannelState(CHANNEL_A, {
      status: "available",
      availableAt: 1_000,
    });

    await expectDomainError(
      stub.createChannel(OWNER, {
        channelId: CHANNEL_A,
        title: "Renamed",
        initialImportCount: 10,
      }),
      "INVALID_STATE",
    );

    expect(await stub.getChannel(CHANNEL_A)).toMatchObject({
      title: "Channel A",
      initialImportCount: 3,
      status: "available",
      availableAt: 1_000,
      lifecycleVersion: 1,
    });
  });

  it("validates configuration input", async () => {
    const stub = registry();
    await expectDomainError(
      stub.createChannel(OWNER, { channelId: "not-a-channel", title: "x" }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "   " }),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.createChannel(OWNER, { ...INPUT_A, initialImportCount: 0 }),
      "INVALID_INPUT",
    );
    await expectDomainError(stub.deleteChannel(OWNER, CHANNEL_B), "NOT_FOUND");
  });

  it("retry only applies to failed channels and fences stale runs", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, INPUT_A);
    await expectDomainError(
      stub.retryChannel(OWNER, CHANNEL_A),
      "INVALID_STATE",
    );

    await setChannelState(CHANNEL_A, {
      status: "failed",
      failureCode: "NO_TRANSCRIPTS",
    });
    expect(await stub.getChannel(CHANNEL_A)).toMatchObject({
      status: "failed",
      failureCode: "NO_TRANSCRIPTS",
    });

    const retried = await stub.retryChannel(OWNER, CHANNEL_A);
    expect(retried).toMatchObject({
      status: "pending",
      failureCode: null,
      failureDetail: null,
      lifecycleVersion: 2,
    });
  });

  it("soft-deletes idempotently and restores without changing processing state", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, INPUT_A);
    await setChannelState(CHANNEL_A, {
      status: "available",
      availableAt: 1_000,
    });

    const deleted = await stub.deleteChannel(OWNER, CHANNEL_A);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted).toMatchObject({ status: "available", lifecycleVersion: 2 });
    expect(await stub.listAvailableChannels()).toEqual([]);

    const again = await stub.deleteChannel(OWNER, CHANNEL_A);
    expect(again).toMatchObject({
      deletedAt: deleted.deletedAt,
      lifecycleVersion: 2,
    });

    await expectDomainError(
      stub.retryChannel(OWNER, CHANNEL_A),
      "INVALID_STATE",
    );

    const restored = await stub.restoreChannel(OWNER, CHANNEL_A);
    expect(restored).toMatchObject({
      deletedAt: null,
      status: "available",
      availableAt: 1_000,
      lifecycleVersion: 2,
    });
    expect(await stub.listAvailableChannels()).toHaveLength(1);
  });

  it("lists only available, non-deleted channels publicly; owner sees everything", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, INPUT_A);
    await stub.createChannel(OWNER, {
      channelId: CHANNEL_B,
      title: "Channel B",
    });
    await setChannelState(CHANNEL_A, { status: "available", availableAt: 1 });

    const publicIds = (await stub.listAvailableChannels()).map(
      (c) => c.channelId,
    );
    expect(publicIds).toEqual([CHANNEL_A]);

    const ownerIds = (await stub.listChannels(OWNER))
      .map((c) => c.channelId)
      .sort();
    expect(ownerIds).toEqual([CHANNEL_A, CHANNEL_B]);
    expect(await stub.getChannel(CHANNEL_B)).toMatchObject({
      status: "pending",
    });
  });
});
