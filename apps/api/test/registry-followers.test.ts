import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  recordFollow as storeRecordFollow,
  recordUnfollow as storeRecordUnfollow,
} from "../src/do/registry/followers";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_C,
  CHANNEL_D,
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
} from "./helpers";

/** The one record of follows (docs/specs/follows-single-owner.md §4). */
describe("registry follows", () => {
  it("records follows and unfollows per channel and email, idempotently, and returns the row", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    const first = await stub.recordFollow(ALICE, CHANNEL_A);
    expect(first).toMatchObject({ channelId: CHANNEL_A, unfollowedAt: null });
    // A repeat follow keeps the original followedAt.
    expect(await stub.recordFollow(ALICE, CHANNEL_A)).toEqual(first);
    await stub.recordFollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A, CHANNEL_B])).toEqual({
      [CHANNEL_A]: 2,
      [CHANNEL_B]: 0,
    });
    expect(
      (await stub.listFollowers(CHANNEL_A)).map((f) => f.email).sort(),
    ).toEqual([ALICE, BOB]);

    const gone = await stub.recordUnfollow(BOB, CHANNEL_A);
    expect(gone.unfollowedAt).toEqual(expect.any(Number));
    // Unfollowing a tombstone is idempotent and returns it unchanged.
    expect(await stub.recordUnfollow(BOB, CHANNEL_A)).toEqual(gone);
    expect(await stub.countFollowers([CHANNEL_A])).toEqual({ [CHANNEL_A]: 1 });

    await expectDomainError(stub.recordFollow(ALICE, CHANNEL_B), "NOT_FOUND");
    // A channel the caller never followed cannot be unfollowed.
    await seedApprovedChannel(CHANNEL_B, "B");
    await expectDomainError(stub.recordUnfollow(ALICE, CHANNEL_B), "NOT_FOUND");
    await expectDomainError(
      stub.recordFollow("nope", CHANNEL_A),
      "INVALID_INPUT",
    );
    await expectDomainError(
      stub.recordFollow(ALICE, "@handle"),
      "INVALID_INPUT",
    );
  });

  it("lists a user's own follows newest first, and their active channel ids sorted", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
    await seedApprovedChannel(CHANNEL_C, "C");
    await stub.ensureUser(ALICE);
    await stub.ensureUser(BOB);
    // Explicit timestamps so the order does not depend on the clock.
    await runInDurableObject(stub, (_, state) => {
      storeRecordFollow(state.storage.sql, CHANNEL_A, ALICE, 1_000);
      storeRecordFollow(state.storage.sql, CHANNEL_C, ALICE, 3_000);
      storeRecordFollow(state.storage.sql, CHANNEL_B, ALICE, 2_000);
      storeRecordFollow(state.storage.sql, CHANNEL_A, BOB, 4_000);
    });
    await stub.recordUnfollow(ALICE, CHANNEL_C);

    expect((await stub.listFollows(ALICE)).map((f) => f.channelId)).toEqual([
      CHANNEL_B,
      CHANNEL_A,
    ]);
    expect(await stub.activeChannelIds(ALICE)).toEqual([CHANNEL_A, CHANNEL_B]);
    // Each user's follows are their own.
    expect(await stub.activeChannelIds(BOB)).toEqual([CHANNEL_A]);
    expect(await stub.listFollows("nobody@example.com")).toEqual([]);
  });

  it("eligibility is active follows that are approved, paused or not", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.createChannel({ channelId: CHANNEL_B, title: "B" }); // requested
    await seedApprovedChannel(CHANNEL_C, "C");
    await seedApprovedChannel(CHANNEL_D, "D");
    for (const id of [CHANNEL_A, CHANNEL_B, CHANNEL_C, CHANNEL_D]) {
      await stub.recordFollow(ALICE, id);
    }
    await stub.declineChannel(OWNER, CHANNEL_C);
    await stub.recordUnfollow(ALICE, CHANNEL_D);
    await stub.recordFollow(BOB, CHANNEL_D);
    await stub.pauseChannel(CHANNEL_A);

    // A is approved and paused (eligible), B requested, C declined, D unfollowed.
    expect(
      (await stub.listEligibleChannels(ALICE)).map((c) => c.channelId),
    ).toEqual([CHANNEL_A]);
    expect(
      (await stub.listEligibleChannels(BOB)).map((c) => c.channelId),
    ).toEqual([CHANNEL_D]);
    expect(await stub.listEligibleChannels("nobody@example.com")).toEqual([]);
    // Approving C again makes it eligible for its remaining follower without any follow write.
    await stub.approveChannel(OWNER, CHANNEL_C);
    expect(
      (await stub.listEligibleChannels(ALICE)).map((c) => c.channelId),
    ).toEqual([CHANNEL_A, CHANNEL_C]);
  });

  it("pauses an approved channel when its last follower leaves and resumes on the next follow", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("system");
    await stub.recordFollow(BOB, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBeNull();
  });

  it("never overrides an owner pause and never pauses a requested channel", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.pauseChannel(CHANNEL_A);
    await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("owner");
    await stub.recordFollow(BOB, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("owner");
    await stub.recordFollow(ALICE, CHANNEL_B);
    await stub.recordUnfollow(ALICE, CHANNEL_B);
    expect((await stub.getChannel(CHANNEL_B))?.pausedBy).toBeNull();
  });

  it("recomputes pause on approve: a channel nobody follows reads pausedBy system, and a follow resumes it", async () => {
    const stub = registry();
    await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
    const approved = await stub.approveChannel(OWNER, CHANNEL_B);
    expect(approved.channel.pausedBy).toBe("system");
    await stub.recordFollow(ALICE, CHANNEL_B);
    expect((await stub.getChannel(CHANNEL_B))?.pausedBy).toBeNull();
  });

  it("adopts the later followedAt when the same user refollows after unfollowing, and resumes the pause", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.ensureUser(ALICE);

    // Drives the store directly with explicit timestamps so the ON CONFLICT DO UPDATE's
    // refollow branch (adopt excluded.followed_at) is pinned, not just its idempotent-follow branch.
    await runInDurableObject(stub, (_, state) =>
      storeRecordFollow(state.storage.sql, CHANNEL_A, ALICE, 1_000),
    );
    const tombstone = await runInDurableObject(stub, (_, state) =>
      storeRecordUnfollow(state.storage.sql, CHANNEL_A, ALICE, 2_000),
    );
    expect(tombstone).toEqual({
      channelId: CHANNEL_A,
      followedAt: 1_000,
      unfollowedAt: 2_000,
    });
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("system");

    const refollowed = await runInDurableObject(stub, (_, state) =>
      storeRecordFollow(state.storage.sql, CHANNEL_A, ALICE, 3_000),
    );
    expect(refollowed).toEqual({
      channelId: CHANNEL_A,
      followedAt: 3_000,
      unfollowedAt: null,
    });
    expect(await stub.countFollowers([CHANNEL_A])).toEqual({ [CHANNEL_A]: 1 });
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBeNull();
    expect(await stub.listFollowers(CHANNEL_A)).toEqual([
      { email: ALICE, followedAt: 3_000 },
    ]);
  });
});
