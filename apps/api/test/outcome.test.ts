import { describe, expect, it } from "vitest";
import type { CatalogChannel, ChannelRequest } from "../src/do/registry/types";
import { catalogState, deriveOutcome } from "../src/lib/outcome";
import { ALICE, CHANNEL_A } from "./helpers";

function request(overrides: Partial<ChannelRequest> = {}): ChannelRequest {
  return {
    requestId: "r1",
    userEmail: ALICE,
    youtubeChannelId: CHANNEL_A,
    submittedUrl: "u",
    channelTitle: null,
    status: "pending",
    reviewedAt: null,
    reviewedByEmail: null,
    ownerExplanation: null,
    approvedChannelId: null,
    autoFollowCompletedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function channel(overrides: Partial<CatalogChannel> = {}): CatalogChannel {
  return {
    channelId: CHANNEL_A,
    title: "A",
    canonicalUrl: "https://www.youtube.com/channel/UCAAAAAAAAAAAAAAAAAAAAAA",
    status: "pending",
    initialImportCount: 5,
    failureCode: null,
    failureDetail: null,
    availableAt: null,
    lastCheckedAt: null,
    lastIngestedAt: null,
    deletedAt: null,
    lifecycleVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const approved = { status: "approved", approvedChannelId: CHANNEL_A } as const;

describe("request outcome and catalog state", () => {
  it("derives the requester's one-phrase outcome (spec §6.4)", () => {
    expect(deriveOutcome(request(), null)).toBe("awaiting_review");
    expect(deriveOutcome(request(), channel({ status: "available" }))).toBe(
      "awaiting_review",
    );
    expect(deriveOutcome(request({ status: "rejected" }), null)).toBe(
      "rejected",
    );
    expect(deriveOutcome(request(approved), channel())).toBe("importing");
    expect(deriveOutcome(request(approved), null)).toBe("importing");
    expect(
      deriveOutcome(
        request(approved),
        channel({ status: "failed", failureCode: "NO_TRANSCRIPTS" }),
      ),
    ).toBe("import_failed");
    expect(
      deriveOutcome(request(approved), channel({ status: "available" })),
    ).toBe("approved_pending_follow");
    expect(
      deriveOutcome(
        request({ ...approved, autoFollowCompletedAt: 5 }),
        channel({ status: "available" }),
      ),
    ).toBe("following");
    // Deletion wins over any processing state.
    expect(
      deriveOutcome(
        request({ ...approved, autoFollowCompletedAt: 5 }),
        channel({ status: "available", deletedAt: 9 }),
      ),
    ).toBe("channel_removed");
  });

  it("maps a channel to its catalog state", () => {
    expect(catalogState(null)).toBe("not_in_catalog");
    expect(catalogState(channel())).toBe("pending");
    expect(catalogState(channel({ status: "available" }))).toBe("available");
    expect(catalogState(channel({ status: "failed" }))).toBe("failed");
    expect(catalogState(channel({ status: "available", deletedAt: 1 }))).toBe(
      "deleted",
    );
  });
});
