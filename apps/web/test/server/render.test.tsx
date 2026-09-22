import type { Episode } from "@media-digest/shared";
import { LocationProvider } from "preact-iso";
import { locationStub } from "preact-iso/prerender";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app";
import { Bootstrap } from "../../src/lib/bootstrap";

/**
 * The render itself, in the shape the Worker performs it (`src/server/worker.tsx`).
 *
 * This is the test that would fail if the application tree reached for `window`, `document` or
 * `localStorage` while rendering — which is the whole risk of one tree being rendered in two
 * runtimes, and the thing neither typecheck nor lint can see. It asserts on the summary's own
 * words because markup that contains them is markup a crawler and an unfurl can read, which is
 * why the public routes are rendered at all.
 */

const EPISODE: Episode = {
  episodeId: "abc123",
  channelId: "UC1",
  channelTitle: "CBC Ideas",
  title: "How cities forget",
  publishedAt: Date.UTC(2026, 8, 5),
  status: "available",
  skipReason: null,
  waitReason: null,
  summaryAvailableAt: Date.UTC(2026, 8, 5),
  summary: {
    format: "structured",
    executiveSummary: "Three things the interview settles about archives.",
    takeaways: [
      { text: "The first city archive was a tax record.", startSec: 252 },
    ],
    topicTags: ["archives"],
  },
  related: [],
};

function render(path: string, data: Record<string, unknown> | null): string {
  locationStub(path);
  return renderToString(
    <LocationProvider>
      <Bootstrap value={data}>
        <App />
      </Bootstrap>
    </LocationProvider>,
  );
}

describe("the server render", () => {
  it("puts a summary's own words in the markup", () => {
    const html = render("/read/abc123", {
      "episode:abc123": { episode: EPISODE },
    });
    expect(html).toContain("How cities forget");
    expect(html).toContain(
      "Three things the interview settles about archives.",
    );
    expect(html).toContain("The first city archive was a tax record.");
  });

  it("renders a visitor's frame, not a reader's", () => {
    const html = render("/read/abc123", {
      "episode:abc123": { episode: EPISODE },
    });
    // The invitation is there, and the controls that need a session are not.
    expect(html).toContain("An account keeps your place");
    expect(html).toContain("Sign in");
    expect(html).not.toContain(">Done<");
  });

  it("renders the landing page's catalog", () => {
    const html = render("/", {
      landing: {
        channels: [
          {
            channelId: "UC1",
            title: "CBC Ideas",
            canonicalUrl: "u",
            status: "approved",
            paused: false,
            approvedAt: 1,
            reviewedAt: 1,
            reviewNote: null,
            lastIngestedAt: 2,
            episodes: { available: 18, pending: 0, failed: 0, skipped: 0 },
            following: false,
            followerCount: 3,
          },
        ],
      },
    });
    expect(html).toContain("CBC Ideas");
    expect(html).toContain("18 summaries");
  });

  it("renders without bootstrapped data rather than throwing", () => {
    // The `unavailable` path ships the shell, and a guarded screen reaches the client with none.
    // Neither may take the render down.
    expect(() => render("/read/abc123", null)).not.toThrow();
    expect(() => render("/queue", null)).not.toThrow();
  });
});
