import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { follow } from "../src/do/user/follows";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  expectDomainError,
  userDO,
} from "./helpers";

describe("user follows", () => {
  it("follows once and treats a repeat follow as a no-op", async () => {
    const stub = userDO(ALICE);
    const first = await stub.follow(CHANNEL_A);
    const again = await stub.follow(CHANNEL_A);

    expect(first).toMatchObject({
      channelId: CHANNEL_A,
      unfollowedAt: null,
      origin: "manual",
      originRequestId: null,
    });
    expect(again).toEqual(first);
    expect(await stub.activeChannelIds()).toEqual([CHANNEL_A]);
  });

  it("unfollow retains a tombstone and is idempotent; unknown channels are NOT_FOUND", async () => {
    const stub = userDO(ALICE);
    await stub.follow(CHANNEL_A);

    const unfollowed = await stub.unfollow(CHANNEL_A);
    expect(unfollowed.unfollowedAt).not.toBeNull();
    expect(await stub.unfollow(CHANNEL_A)).toEqual(unfollowed);

    expect(await stub.listFollows()).toEqual([]);
    expect(await stub.activeChannelIds()).toEqual([]);
    expect(
      (await stub.listFollows({ includeUnfollowed: true })).map(
        (f) => f.channelId,
      ),
    ).toEqual([CHANNEL_A]);

    await expectDomainError(stub.unfollow(CHANNEL_B), "NOT_FOUND");
  });

  it("an explicit refollow clears the tombstone and becomes manual", async () => {
    const stub = userDO(ALICE);
    const auto = await stub.autoFollow(CHANNEL_A, "req-1");
    expect(auto.inserted).toBe(true);
    await stub.unfollow(CHANNEL_A);

    const refollowed = await stub.follow(CHANNEL_A);
    expect(refollowed).toMatchObject({
      unfollowedAt: null,
      origin: "manual",
      originRequestId: null,
    });
    expect(refollowed.followedAt).toBeGreaterThanOrEqual(
      auto.follow.followedAt,
    );
  });

  it("autoFollow inserts only when no row exists", async () => {
    const stub = userDO(ALICE);

    const first = await stub.autoFollow(CHANNEL_A, "req-1");
    expect(first.inserted).toBe(true);
    expect(first.follow).toMatchObject({
      origin: "request",
      originRequestId: "req-1",
      unfollowedAt: null,
    });

    // Redelivery after a crash between User DO insert and Registry acknowledgement.
    const redelivered = await stub.autoFollow(CHANNEL_A, "req-1");
    expect(redelivered.inserted).toBe(false);
    expect(redelivered.follow).toEqual(first.follow);

    // An existing manual follow is never rewritten as request-originated.
    await stub.follow(CHANNEL_B);
    const overManual = await stub.autoFollow(CHANNEL_B, "req-2");
    expect(overManual.inserted).toBe(false);
    expect(overManual.follow).toMatchObject({
      origin: "manual",
      originRequestId: null,
    });
  });

  it("autoFollow never reverses an explicit unfollow", async () => {
    const stub = userDO(ALICE);
    await stub.autoFollow(CHANNEL_A, "req-1");
    const tombstone = await stub.unfollow(CHANNEL_A);

    const retried = await stub.autoFollow(CHANNEL_A, "req-1");

    expect(retried.inserted).toBe(false);
    expect(retried.follow).toEqual(tombstone);
    expect(await stub.activeChannelIds()).toEqual([]);
  });

  it("lists active follows newest first", async () => {
    const stub = userDO(ALICE);
    // Drive timestamps explicitly so ordering does not depend on the clock.
    await runInDurableObject(stub, (_, state) => {
      follow(state.storage.sql, CHANNEL_A, 1_000);
      follow(state.storage.sql, CHANNEL_B, 2_000);
    });

    expect((await stub.listFollows()).map((f) => f.channelId)).toEqual([
      CHANNEL_B,
      CHANNEL_A,
    ]);
    expect(await stub.activeChannelIds()).toEqual([CHANNEL_A, CHANNEL_B]);
  });

  it("validates input", async () => {
    const stub = userDO(ALICE);
    await expectDomainError(stub.follow("@handle"), "INVALID_INPUT");
    await expectDomainError(stub.autoFollow(CHANNEL_A, "  "), "INVALID_INPUT");
  });

  it("keeps each user's follows in their own object", async () => {
    await userDO(ALICE).follow(CHANNEL_A);
    await userDO(BOB).follow(CHANNEL_B);

    expect(await userDO(ALICE).activeChannelIds()).toEqual([CHANNEL_A]);
    expect(await userDO(BOB).activeChannelIds()).toEqual([CHANNEL_B]);
    await expectDomainError(userDO(BOB).unfollow(CHANNEL_A), "NOT_FOUND");
  });
});
