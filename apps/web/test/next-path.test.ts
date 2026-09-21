import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "../src/lib/next-path";

describe("safeNextPath", () => {
  it("keeps a path within this app, query and all", () => {
    expect(safeNextPath("/read/abc123")).toBe("/read/abc123");
    expect(safeNextPath("/sources/UC123")).toBe("/sources/UC123");
    expect(safeNextPath("/sources?show=catalog")).toBe("/sources?show=catalog");
    expect(safeNextPath("/")).toBe("/");
  });

  it("refuses anything that would leave this origin", () => {
    for (const raw of [
      "https://evil.example/phish",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil.example",
    ]) {
      expect(safeNextPath(raw), raw).toBe(DEFAULT_AFTER_SIGN_IN);
    }
  });

  it("refuses the dead ends — the door itself and the spent callback", () => {
    expect(safeNextPath("/sign-in")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath("/sign-in?next=/queue")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath("/auth/callback")).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("falls back when there is nothing to fall back from", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath("")).toBe(DEFAULT_AFTER_SIGN_IN);
  });
});
