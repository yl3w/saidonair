import { useLocation } from "preact-iso";
import {
  PUBLIC_BAND_COPY,
  PUBLIC_BAND_COPY_SHORT,
  PUBLIC_SIGN_IN_COPY,
} from "../lib/copy";

/**
 * The frame a signed-out visitor arrives into (docs/design.md → The signed-out shell;
 * docs/specs/public-reading.md §4.2).
 *
 * **One bar, doing both jobs** (owner decision 2026-09-21, revised the same day from two). It was
 * built as a fixed invitation band above a wordmark row that scrolled away, and seen in a browser
 * that was one bar too many: the rows carried three different left edges on a wide window, and the
 * second row's only content was a wordmark and a `Channels` link that the landing page — which
 * lists every channel — already made unnecessary. Combining them costs nothing the reader had and
 * returns 56 px to the page.
 *
 * So: the wordmark, the line saying what an account is *for*, and the button. Fixed, inverted, and
 * it never leaves — a visitor four screens into a summary still has it. Inverted also marks the
 * mode: a signed-out page does not look like a reader's page with pieces missing.
 *
 * There are **no other controls on a public page**: no Follow, no Ask, no Add a channel
 * (spec §3, decision 10). A visitor reads; the band invites; signing in returns them here as a
 * reader, and they act then. No bottom tab bar either — it exists to put three reader destinations
 * under a thumb, and a visitor has none.
 */
export function PublicShell() {
  const { path } = useLocation();
  const signIn = `/sign-in?next=${encodeURIComponent(path)}`;

  return (
    <>
      <header class="fixed inset-x-0 top-0 z-30 bg-neutral text-neutral-content">
        <div class="mx-auto flex h-14 w-full items-center gap-4 px-5 md:px-8">
          <a
            href="/"
            class="flex min-h-11 shrink-0 items-center font-serif text-section font-semibold tracking-tight"
          >
            Said on Air
          </a>

          {/* The pitch, and the only place it is made on a page that is not the landing page. The
              short form is not a truncation: it is the same three nouns with the sentence taken
              out, which survives a phone better than an ellipsis mid-word. */}
          <p class="min-w-0 truncate text-meta opacity-80">
            <span class="hidden lg:inline">{PUBLIC_BAND_COPY}</span>
            <span class="lg:hidden">{PUBLIC_BAND_COPY_SHORT}</span>
          </p>

          <a
            class="btn btn-sm ml-auto shrink-0 bg-panel text-ink hover:bg-panel"
            href={signIn}
          >
            {PUBLIC_SIGN_IN_COPY}
          </a>
        </div>
      </header>

      {/* Clears the fixed bar. A spacer rather than page padding, so no screen has to know the
          bar's height or remember to leave room for it. */}
      <div class="h-14" aria-hidden="true" />
    </>
  );
}
