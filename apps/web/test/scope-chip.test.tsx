import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ScopeChip, ScopeLine } from "../src/components/ScopeChip";
import { SCOPE_OFF_COPY, SCOPE_ON_COPY } from "../src/lib/copy";

/**
 * PRD §8 bullet 9: "Dismissing the chip returns the next message to every eligible channel." The
 * API half is tested — `user-chats.test.ts` "leaves both messages unscoped when no hint is given" —
 * and the chip itself had no test until 2026-09-22, because component tests were forbidden
 * (docs/specs/m6-hardening.md §6; the rule was reversed the same day, PRD §9).
 *
 * **What this covers and what it does not.** A dismissal is a click, and there is no DOM here
 * (owner decision 2026-09-22: render tests, no `happy-dom`). So the click stays hand-verified
 * under `pnpm dev`. What is covered is the state a dismissal produces — no chip, and a line saying
 * the question now goes everywhere — which is the half a reader actually reads, and the half that
 * `docs/design.md` §3 calls the only thing telling them widening exists.
 */
describe("the scope chip", () => {
  it("renders nothing at all when there is no scope", () => {
    // The dismissed state. `null` is not an empty chip or a chip saying "everything": it is the
    // absence of the control, because scope is one episode or none.
    expect(render(<ScopeChip episodeTitle={null} onDismiss={() => {}} />)).toBe(
      "",
    );
  });

  it("names the episode it is holding, and offers a way out of it", () => {
    const html = render(
      <ScopeChip episodeTitle="A very long episode" onDismiss={() => {}} />,
    );
    expect(html).toContain("A very long episode");
    // The way out must be nameable by assistive technology: the `✕` alone reads as "remove this".
    expect(html).toContain("Stop asking about A very long episode");
  });

  it("escapes a title rather than letting it into the markup", () => {
    // Channel and episode titles are YouTube's, not ours.
    const html = render(
      <ScopeChip
        episodeTitle={'<img src=x onerror="1">'}
        onDismiss={() => {}}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("the line beneath the composer", () => {
  it("says which of the two searches is in force, in words", () => {
    // These two sentences are the whole of the reader's model of scope, which is why they are
    // asserted by their exported constants rather than by a string written twice.
    expect(render(<ScopeLine scoped={true} />)).toContain(SCOPE_ON_COPY);
    expect(render(<ScopeLine scoped={false} />)).toContain(SCOPE_OFF_COPY);
  });

  it("names every channel the reader follows once the scope is gone", () => {
    // The criterion's own claim, said to the reader: dismissing returns the next message to
    // everything eligible. If this sentence ever stopped saying so, the chip's `✕` would be the
    // only account of what just happened, and it does not give one.
    const widened = render(<ScopeLine scoped={false} />);
    expect(widened).toContain("every channel you follow");
    expect(widened).not.toContain("this episode only");
  });
});
