import { describe, expect, it } from "vitest";
import { matchPublicRoute } from "../src/lib/public-routes";

/**
 * The public/guarded seam (`docs/specs/public-reading.md` §4.4). The Worker and the client both
 * import this, so a disagreement about which URLs are public is impossible by construction — these
 * tests are what stop the list itself drifting.
 */
describe("matchPublicRoute", () => {
  it("matches the four public paths", () => {
    expect(matchPublicRoute("/")).toEqual({ name: "landing" });
    expect(matchPublicRoute("/sources")).toEqual({ name: "sources" });
    expect(matchPublicRoute("/sources/UC123")).toEqual({
      name: "channel",
      channelId: "UC123",
    });
    expect(matchPublicRoute("/read/abc_123")).toEqual({
      name: "episode",
      episodeId: "abc_123",
    });
  });

  it("does not match a guarded path", () => {
    for (const path of [
      "/queue",
      "/history",
      "/history/2026-09-21",
      "/chats",
      "/chats/new",
      "/chats/x",
      "/account",
      "/curate",
      "/curate/UC123",
      "/sign-in",
      "/auth/callback",
    ]) {
      expect(matchPublicRoute(path)).toBeNull();
    }
  });

  it("does not match a deeper or trailing-slash path", () => {
    expect(matchPublicRoute("/sources/UC123/extra")).toBeNull();
    expect(matchPublicRoute("/sources/")).toBeNull();
    expect(matchPublicRoute("/read/")).toBeNull();
    expect(matchPublicRoute("/read/abc/def")).toBeNull();
  });

  it("keeps a hyphenated id, which YouTube ids contain", () => {
    expect(matchPublicRoute("/read/a-b_c123")).toEqual({
      name: "episode",
      episodeId: "a-b_c123",
    });
  });
});
