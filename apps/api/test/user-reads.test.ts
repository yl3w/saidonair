import { describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CHANNEL_A,
  expectDomainError,
  userDO,
  VIDEO_A,
  VIDEO_B,
  videoIds,
} from "./helpers";

describe("user read receipts", () => {
  it("records receipts once and reports the read subset", async () => {
    const stub = userDO(ALICE);

    expect(await stub.markRead([VIDEO_A, VIDEO_A, VIDEO_B])).toBe(2);
    expect(await stub.markRead([VIDEO_A])).toBe(0);
    expect(await stub.readVideoIds([VIDEO_B, VIDEO_A, "ccccccccccc"])).toEqual([
      VIDEO_A,
      VIDEO_B,
    ]);
    expect(await stub.markRead([])).toBe(0);
    expect(await stub.readVideoIds([])).toEqual([]);
  });

  it("handles id lists above the bound-parameter limit", async () => {
    const stub = userDO(ALICE);
    const ids = videoIds(250);

    expect(await stub.markRead(ids)).toBe(250);
    expect(await stub.readVideoIds(ids)).toEqual([...ids].sort());
  });

  it("keeps receipts through unfollow and isolates them per user", async () => {
    const alice = userDO(ALICE);
    await alice.follow(CHANNEL_A);
    await alice.markRead([VIDEO_A]);
    await alice.unfollow(CHANNEL_A);

    expect(await alice.readVideoIds([VIDEO_A])).toEqual([VIDEO_A]);
    expect(await userDO(BOB).readVideoIds([VIDEO_A])).toEqual([]);
  });

  it("rejects malformed video ids", async () => {
    await expectDomainError(
      userDO(ALICE).markRead(["too short"]),
      "INVALID_INPUT",
    );
  });
});
