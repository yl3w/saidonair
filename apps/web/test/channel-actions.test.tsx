import type { Channel } from "@media-digest/shared";
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ChannelStatusActions } from "../src/components/ChannelStatusActions";
import { CHANNEL_ACTION_COPY } from "../src/lib/copy";

/**
 * PRD §8 bullet 3: the seven catalog operations are the owner's, and "the web offers them to the
 * owner only". The API half is fully tested (`authorization.test.ts`); this half had no test at
 * all until 2026-09-22, because component tests were forbidden — and the M6 sweep had to accept
 * the gap for that reason rather than for a good one (docs/specs/m6-hardening.md §6; the rule was
 * reversed the same day, PRD §9).
 *
 * `ChannelStatusActions` is the **only** component that renders approve, decline, pause, resume
 * and Check feed, so what it offers for a given channel is what the product offers. Two rules
 * decide that, both owner decisions of 2026-09-15 (PRD §9):
 *
 * - **`scope`** — `adjustments` is what belongs beside the channel (the reversible knobs nobody
 *   else feels); `everything` adds the three decisions, which belong to Curate.
 * - **status** — a channel that is not approved has no knobs to offer, so beside the object it
 *   offers nothing at all.
 *
 * These are render tests: no DOM, and they assert what the component *decides*, never how it
 * looks. An assertion on a Tailwind class would be a test of daisyUI (`AGENTS.md` → Testing).
 */
function channel(over: Partial<Channel> = {}): Channel {
  return {
    channelId: "UC1",
    title: "A channel",
    canonicalUrl: "https://youtube.com/channel/UC1",
    status: "approved",
    paused: false,
    approvedAt: 1,
    reviewedAt: 1,
    reviewNote: null,
    lastIngestedAt: 2,
    episodes: { available: 3, pending: 0, failed: 0, skipped: 0 },
    following: false,
    followerCount: 0,
    ...over,
  };
}

const act = async () => {};

function offered(c: Channel, scope: "adjustments" | "everything"): string {
  return render(
    <ChannelStatusActions
      channel={c}
      busy={false}
      idPrefix="t-"
      scope={scope}
      act={act}
    />,
  );
}

/** Every catalog operation this component can render, by the words or names it renders them as. */
const OPERATIONS = {
  approve: CHANNEL_ACTION_COPY.approve,
  decline: CHANNEL_ACTION_COPY.decline,
  withdraw: CHANNEL_ACTION_COPY.withdraw,
  checkFeed: CHANNEL_ACTION_COPY.checkFeedHint,
  pause: CHANNEL_ACTION_COPY.pause,
  resume: CHANNEL_ACTION_COPY.resume,
} as const;

/** Which of them a rendering offers — listed, so a new one cannot appear unnoticed. */
function present(html: string): string[] {
  return Object.entries(OPERATIONS)
    .filter(([, copy]) => html.includes(copy))
    .map(([name]) => name);
}

describe("the catalog operations a channel surface offers", () => {
  it("offers nothing beside a channel that is not approved", () => {
    // Approving and declining are decisions, and a decision belongs to Curate. Beside the object
    // there is nothing to adjust yet, so the component renders nothing rather than an empty strip.
    for (const status of ["requested", "declined"] as const) {
      const html = offered(
        channel({ status, approvedAt: status === "declined" ? 1 : null }),
        "adjustments",
      );
      expect(present(html)).toEqual([]);
      expect(html).toBe("");
    }
  });

  it("offers the two reversible knobs beside an approved channel, and no decision", () => {
    expect(present(offered(channel(), "adjustments")).sort()).toEqual([
      "checkFeed",
      "pause",
    ]);
    // Paused swaps one knob for its opposite; it never offers both.
    const paused = present(offered(channel({ paused: true }), "adjustments"));
    expect(paused.sort()).toEqual(["checkFeed", "resume"]);
    expect(paused).not.toContain("pause");
  });

  it("adds the decisions only where the scope is everything", () => {
    expect(
      present(
        offered(
          channel({ status: "requested", approvedAt: null }),
          "everything",
        ),
      ).sort(),
    ).toEqual(["approve", "decline"]);
    // An approved channel's decision is withdrawal, and it says so rather than saying "Decline":
    // the word changes with `approvedAt`, because withdrawing reaches readers who already follow.
    expect(present(offered(channel(), "everything")).sort()).toEqual([
      "checkFeed",
      "pause",
      "withdraw",
    ]);
    // A declined channel can only be approved again.
    expect(
      present(offered(channel({ status: "declined" }), "everything")),
    ).toEqual(["approve"]);
  });

  it("names every glyph it renders, so no control is nameless", () => {
    // Check feed, pause and resume are glyphs (docs/design.md §2.4). The word still has to exist
    // for assistive technology and as the tooltip, which is the rule that makes a glyph allowed.
    const html = offered(channel(), "adjustments");
    expect(html).toContain(CHANNEL_ACTION_COPY.checkFeedHint);
    expect(html).toContain(CHANNEL_ACTION_COPY.pause);
    expect(html).toMatch(/aria-label|title=/);
  });
});
