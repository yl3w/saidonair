import type { ComponentChildren } from "preact";
import { Nav } from "./Nav";

/**
 * The frame every screen arrives into: the bar, then one centred column. The three measures are the
 * design's (docs/design.md §2.3) — the reading column is 680 px, a list is 760 px, and a table is
 * given the page. The bottom padding clears the phone's tab bar, which floats over the content.
 *
 * A `rail` sits to the right of the column and carries navigation *about* the list — the days still
 * waiting, a calendar, a sort order — never content, and never on a screen too narrow to spare it.
 */
const MEASURES = {
  reading: "max-w-reading",
  list: "max-w-list",
  wide: "",
} as const;

export function Page({
  measure = "list",
  rail,
  railMeasure = "rail",
  children,
}: {
  measure?: keyof typeof MEASURES;
  rail?: ComponentChildren;
  railMeasure?: "rail" | "rail-wide";
  children: ComponentChildren;
}) {
  const column = (
    <main class={`w-full min-w-0 ${MEASURES[measure]}`}>{children}</main>
  );
  return (
    <div class="min-h-dvh">
      <Nav />
      <div class="mx-auto w-full px-5 pt-6 pb-28 md:px-8 md:pt-8 md:pb-16 lg:w-fit">
        {rail === undefined ? (
          <div class={`mx-auto ${MEASURES[measure]}`}>{column}</div>
        ) : (
          <div class="flex justify-center gap-10">
            {column}
            <aside
              class={`hidden shrink-0 lg:block ${
                railMeasure === "rail" ? "w-rail" : "w-rail-wide"
              }`}
            >
              {rail}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
