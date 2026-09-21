import { useLocation } from "preact-iso";
import {
  PUBLIC_BAND_COPY,
  PUBLIC_BAND_COPY_SHORT,
  PUBLIC_SIGN_IN_COPY,
} from "../lib/copy";

/**
 * The frame a signed-out visitor arrives into (docs/specs/public-reading.md §4.2; owner decision
 * 2026-09-21, chosen in a browser over a bottom-pinned bar and over a filled button in the nav).
 *
 * Two bars, and they behave differently on purpose:
 *
 * 1. **The invitation band is fixed and never leaves.** It says what an account is *for* rather
 *    than only "sign in", which is the whole argument for spending a bar on it. A visitor reading
 *    four screens of summary still has it.
 * 2. **The wordmark and Channels row scrolls away** with the content, and comes back only at the
 *    top of the page — no scroll listener, no threshold to tune, nothing to feel twitchy
 *    (spec §3, decision 9).
 *
 * There are **no other controls anywhere on a public page**: no Follow, no Ask, no Add a channel
 * (spec §3, decision 10). A visitor reads; the band invites; signing in returns them here as a
 * reader, and they act then. That decision deleted the machinery that would have serialised an
 * intent across the Google round trip and replayed it afterwards.
 *
 * No bottom tab bar either. It exists to put three reader destinations under a thumb, and a visitor
 * has one.
 */
export function PublicShell() {
  const { path } = useLocation();
  const signIn = `/sign-in?next=${encodeURIComponent(path)}`;

  return (
    <>
      <div class="fixed inset-x-0 top-0 z-30 bg-neutral text-neutral-content">
        <div class="mx-auto flex h-12 w-full max-w-5xl items-center gap-3 px-5 md:px-8">
          <p class="min-w-0 text-meta">
            <span class="hidden sm:inline">{PUBLIC_BAND_COPY}</span>
            <span class="sm:hidden">{PUBLIC_BAND_COPY_SHORT}</span>
          </p>
          <a
            class="btn btn-sm ml-auto shrink-0 bg-panel text-ink hover:bg-panel"
            href={signIn}
          >
            {PUBLIC_SIGN_IN_COPY}
          </a>
        </div>
      </div>

      {/* Clears the fixed band. A spacer rather than page padding, so no screen has to know the
          band's height or remember to leave room for it. */}
      <div class="h-12" aria-hidden="true" />

      <header class="border-b border-rule bg-panel">
        <div class="mx-auto flex h-14 w-full items-center gap-6 px-5 md:px-8">
          <a
            href="/"
            class="flex min-h-11 items-center font-serif text-section font-semibold tracking-tight text-ink"
          >
            Said on Air
          </a>
          <nav aria-label="Primary">
            <a
              href="/sources"
              aria-current={isCurrent(path, "/sources") ? "page" : undefined}
              class={`flex min-h-11 items-center border-b-2 text-ui hover:text-ink ${
                isCurrent(path, "/sources")
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent text-ink-2"
              }`}
            >
              Channels
            </a>
          </nav>
        </div>
      </header>
    </>
  );
}

/** `/sources` is current on `/sources/UC…` too. */
function isCurrent(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}
