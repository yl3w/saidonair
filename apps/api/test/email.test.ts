import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../src/lib/email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Bhaskar@Example.COM ")).toBe(
      "bhaskar@example.com",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "no-at-sign",
    "@example.com",
    "user@",
    "user@nodot",
    "two words@example.com",
    `${"a".repeat(250)}@example.com`,
  ])("rejects %j", (value) => {
    expect(normalizeEmail(value)).toBeNull();
  });
});
