import type { ComponentChildren } from "preact";
import { Nav } from "./Nav";

/**
 * The frame every screen arrives into: the bar, then one centred column. The three measures are the
 * design's (docs/design.md §2.3) — the reading column is 680 px, a list is 760 px, and a table is
 * given the page. The bottom padding clears the phone's tab bar, which floats over the content.
 */
const MEASURES = {
  reading: "max-w-reading",
  list: "max-w-list",
  wide: "",
} as const;

export function Page({
  measure = "list",
  children,
}: {
  measure?: keyof typeof MEASURES;
  children: ComponentChildren;
}) {
  return (
    <div class="min-h-dvh">
      <Nav />
      <main
        class={`mx-auto w-full px-5 pt-6 pb-28 md:px-8 md:pt-8 md:pb-16 ${MEASURES[measure]}`}
      >
        {children}
      </main>
    </div>
  );
}
