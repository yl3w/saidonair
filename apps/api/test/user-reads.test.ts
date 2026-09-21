import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  EPISODE_A,
  EPISODE_B,
  episodeIds,
  expectDomainError,
  follow,
  seedApprovedChannel,
  unfollow,
  userDO,
} from "./helpers";

describe("user read receipts", () => {
  it("records receipts once and reports the read subset", async () => {
    const stub = userDO(ALICE);

    expect(await stub.markRead([EPISODE_A, EPISODE_A, EPISODE_B])).toBe(2);
    expect(await stub.markRead([EPISODE_A])).toBe(0);
    expect(
      await stub.readEpisodeIds([EPISODE_B, EPISODE_A, "ccccccccccc"]),
    ).toEqual([EPISODE_A, EPISODE_B]);
    expect(await stub.markRead([])).toBe(0);
    expect(await stub.readEpisodeIds([])).toEqual([]);
  });

  it("handles id lists above the bound-parameter limit", async () => {
    const stub = userDO(ALICE);
    const ids = episodeIds(250);

    expect(await stub.markRead(ids)).toBe(250);
    expect(await stub.readEpisodeIds(ids)).toEqual([...ids].sort());
  });

  it("keeps receipts through unfollow and isolates them per user", async () => {
    // Follows live in the Registry; receipts stay here and outlive them.
    await seedApprovedChannel(CHANNEL_A, "Channel A");
    const alice = userDO(ALICE);
    await follow(ALICE, CHANNEL_A);
    await alice.markRead([EPISODE_A]);
    await unfollow(ALICE, CHANNEL_A);

    expect(await alice.readEpisodeIds([EPISODE_A])).toEqual([EPISODE_A]);
    expect(await userDO(BOB).readEpisodeIds([EPISODE_A])).toEqual([]);
  });

  it("rejects malformed episode ids", async () => {
    await expectDomainError(
      userDO(ALICE).markRead(["too short"]),
      "INVALID_INPUT",
    );
  });
});
