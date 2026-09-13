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
  expectDomainError,
  OWNER,
  registry,
  seedApprovedChannel,
} from "./helpers";

describe("registry followers", () => {
  it("records follows and unfollows per channel and email, idempotently", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordFollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A, CHANNEL_B])).toEqual({
      [CHANNEL_A]: 2,
      [CHANNEL_B]: 0,
    });
    expect(
      (await stub.listFollowers(CHANNEL_A)).map((f) => f.email).sort(),
    ).toEqual([ALICE, BOB]);
    await stub.recordUnfollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A])).toEqual({ [CHANNEL_A]: 1 });
    await expectDomainError(stub.recordFollow(ALICE, CHANNEL_B), "NOT_FOUND");
  });

  it("pauses an approved channel when its last follower leaves and resumes on the next follow", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await stub.recordFollow(ALICE, CHANNEL_A);
    const paused = await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect(paused.pausedBy).toBe("system");
    const resumed = await stub.recordFollow(BOB, CHANNEL_A);
    expect(resumed.pausedBy).toBeNull();
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
    const requested = await stub.recordUnfollow(ALICE, CHANNEL_B);
    expect(requested.pausedBy).toBeNull();
  });

  it("recomputes pause on approve: a channel nobody follows reads pausedBy system, and a follow resumes it", async () => {
    const stub = registry();
    await stub.createChannel({ channelId: CHANNEL_B, title: "B" });
    const approved = await stub.approveChannel(OWNER, CHANNEL_B);
    expect(approved.channel.pausedBy).toBe("system");
    const followed = await stub.recordFollow(ALICE, CHANNEL_B);
    expect(followed.pausedBy).toBeNull();
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
    await runInDurableObject(stub, (_, state) =>
      storeRecordUnfollow(state.storage.sql, CHANNEL_A, ALICE, 2_000),
    );
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("system");

    await runInDurableObject(stub, (_, state) =>
      storeRecordFollow(state.storage.sql, CHANNEL_A, ALICE, 3_000),
    );

    expect(await stub.countFollowers([CHANNEL_A])).toEqual({ [CHANNEL_A]: 1 });
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBeNull();
    expect(await stub.listFollowers(CHANNEL_A)).toEqual([
      { email: ALICE, followedAt: 3_000 },
    ]);
  });
});
