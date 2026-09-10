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

describe("registry followers", () => {
  it("records follows and unfollows per channel and email, idempotently", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, {
      channelId: CHANNEL_A,
      title: "A",
      status: "approved",
    });
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordFollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A, CHANNEL_B])).toEqual({
      [CHANNEL_A]: 2,
      [CHANNEL_B]: 0,
    });
    expect(
      (await stub.listFollowers(OWNER, CHANNEL_A)).map((f) => f.email).sort(),
    ).toEqual([ALICE, BOB]);
    await stub.recordUnfollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A])).toEqual({ [CHANNEL_A]: 1 });
    await expectDomainError(stub.listFollowers(ALICE, CHANNEL_A), "NOT_OWNER");
    await expectDomainError(stub.recordFollow(ALICE, CHANNEL_B), "NOT_FOUND");
  });

  it("pauses an approved channel when its last follower leaves and resumes on the next follow", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, {
      channelId: CHANNEL_A,
      title: "A",
      status: "approved",
    });
    await stub.recordFollow(ALICE, CHANNEL_A);
    const paused = await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect(paused.pausedBy).toBe("system");
    const resumed = await stub.recordFollow(BOB, CHANNEL_A);
    expect(resumed.pausedBy).toBeNull();
  });

  it("never overrides an owner pause and never pauses a requested channel", async () => {
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
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.pauseChannel(OWNER, CHANNEL_A);
    await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("owner");
    await stub.recordFollow(BOB, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("owner");
    await stub.recordFollow(ALICE, CHANNEL_B);
    const requested = await stub.recordUnfollow(ALICE, CHANNEL_B);
    expect(requested.pausedBy).toBeNull();
  });

  it("recomputes pause on approve: a channel nobody follows reads pausedBy system, and a follow resumes it", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, {
      channelId: CHANNEL_B,
      title: "B",
      status: "requested",
    });
    const approved = await stub.approveChannel(OWNER, CHANNEL_B);
    expect(approved.channel.pausedBy).toBe("system");
    const followed = await stub.recordFollow(ALICE, CHANNEL_B);
    expect(followed.pausedBy).toBeNull();
  });
});
