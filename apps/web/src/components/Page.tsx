import type { ComponentChildren } from "preact";
import { useSession } from "../session";
import { Nav } from "./Nav";
import { PublicShell } from "./PublicShell";

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

/**
 * The column needs a **definite** width, not a maximum. The wrapper is `lg:w-fit` so a column and
 * its rail centre as a group, and `w-full` inside a fit-to-content parent resolves to the content's
 * own width — so a column holding something narrow shrink-wraps around it and the page lists to one
 * side. Screens whose rows carry wrapping text never showed this; a composer with nothing above it
 * did, and so did a list of short chat rows (2026-09-17). It applies with or without a rail.
 */
const COLUMNS = {
  reading: "lg:w-reading",
  list: "lg:w-list",
  wide: "",
} as const;

export function Page({
  measure = "list",
  rail,
  railMeasure = "rail",
  desktopOnly = false,
  bar,
  children,
}: {
  measure?: keyof typeof MEASURES;
  rail?: ComponentChildren;
  railMeasure?: "rail" | "rail-wide";
  /** Curate: dense, consequential and rare, so it is not designed twice (docs/design.md §6). */
  desktopOnly?: boolean;
  /**
   * A bar of this screen's own, instead of the product's nav — a way back and the acts that belong
   * to the one thing on the page, as the reading column has (docs/design.md §3). A screen that is
   * *about* one object takes it; a destination a reader navigates to keeps the nav.
   */
  bar?: ComponentChildren;
  children: ComponentChildren;
}) {
  const column = (
    <main class={`w-full min-w-0 ${MEASURES[measure]} ${COLUMNS[measure]}`}>
      {desktopOnly && (
        <p class="font-reading text-body text-ink-2 lg:hidden">
          Curate needs a wider screen than this one. What is waiting is on your
          Account screen, and the decisions that take five seconds are beside
          each channel on{" "}
          <a class="link link-hover link-primary" href="/sources">
            Sources
          </a>
          .
        </p>
      )}
      <div class={desktopOnly ? "hidden lg:block" : undefined}>{children}</div>
    </main>
  );
  return (
    <div class="min-h-dvh">
      {bar ?? <Frame />}
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

/**
 * Which frame a screen arrives into, decided in the one place that already owns the frame rather
 * than threaded through four screens as a prop (docs/specs/public-reading.md §4.2).
 *
 * **Only a settled absence of session gets the public shell.** A reader's session begins as
 * `loading` while `GET /me` is in flight, and showing them the visitor's band for that moment —
 * then replacing it — would be a flicker that says the wrong thing about who they are. A visitor
 * has no stored session at all, so `none` is theirs immediately, with nothing to wait for.
 */
function Frame() {
  const { state } = useSession();
  return state.status === "none" ? <PublicShell /> : <Nav />;
}
