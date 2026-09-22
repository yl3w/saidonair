/**
 * The frame a signed-out visitor arrives into (docs/design.md → The signed-out shell).
 *
 * **Just the wordmark.** It carried the invitation for part of 2026-09-21 — first as a fixed band
 * above a nav row, then as one combined bar — and the owner reverted it: the invitation is now a
 * daisyUI alert in the column (`JoinAlert`), on every public page. A bar that exists to advertise
 * spends a strip of every window on the same sentence a visitor has already read.
 *
 * There are **no controls here and none anywhere else on a public page**: no Follow, no Ask, no Add
 * a channel (docs/specs/public-reading.md §3, decision 10). A visitor reads; the alert invites;
 * signing in returns them here as a reader, and they act then. No bottom tab bar either — it exists
 * to put three reader destinations under a thumb, and a visitor has none.
 */
export function PublicShell() {
  return (
    <header class="sticky top-0 z-20 border-b border-rule bg-panel">
      <div class="mx-auto flex h-14 w-full items-center px-5 md:px-8">
        <a
          href="/"
          class="flex min-h-11 items-center font-serif text-section font-semibold tracking-tight text-ink"
        >
          Said on Air
        </a>
      </div>
    </header>
  );
}
