import { describe, expect, it } from "vitest";
import { ALICE, BOB, expectDomainError, userDO } from "./helpers";

describe("user preferences", () => {
  it("reads as empty until saved, then round-trips and overwrites", async () => {
    const stub = userDO(ALICE);
    expect(await stub.getPreferences()).toEqual({
      systemRules: "",
      updatedAt: null,
    });

    const saved = await stub.setPreferences("Answer in bullet points.");
    expect(saved.systemRules).toBe("Answer in bullet points.");
    expect(saved.updatedAt).not.toBeNull();
    expect(await stub.getPreferences()).toEqual(saved);

    const replaced = await stub.setPreferences("Be brief.");
    expect(replaced.systemRules).toBe("Be brief.");
    expect(await userDO(BOB).getPreferences()).toEqual({
      systemRules: "",
      updatedAt: null,
    });
  });

  it("caps the length of the rules", async () => {
    await expectDomainError(
      userDO(ALICE).setPreferences("x".repeat(4001)),
      "INVALID_INPUT",
    );
  });
});
