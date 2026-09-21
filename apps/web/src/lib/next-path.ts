/**
 * Where a reader lands after signing in (`docs/specs/public-reading.md` §4.3).
 *
 * A visitor reading a shared summary who signs in should come back to that summary, so the
 * destination rides the URL — `/sign-in?next=…`, then `…/auth/callback?to=…` — rather than being
 * stored anywhere. Nothing is kept across the round trip: that was struck along with the resumed
 * actions (spec §3, decision 10).
 *
 * **Every destination passes through here before it is used.** It arrives from a query string,
 * which anyone can write, and it ends up in a navigation — the shape of an open redirect. The API
 * guards its own half of the handoff against `WEB_ORIGINS` (`auth-phase.md` §A5); this is the web's
 * half, and the rule is narrower: a destination must be a path *within this app*, never a URL.
 */
export const DEFAULT_AFTER_SIGN_IN = "/queue";

export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return DEFAULT_AFTER_SIGN_IN;

  // An absolute URL, a scheme-relative one (`//evil.example`), or a backslash the browser
  // normalises into one (`/\evil.example`) all leave this origin. A path does not.
  if (!raw.startsWith("/")) return DEFAULT_AFTER_SIGN_IN;
  if (raw.startsWith("//") || raw.startsWith("/\\"))
    return DEFAULT_AFTER_SIGN_IN;

  // Landing back on the door you just came through, or on the callback that has already spent its
  // code, are both dead ends rather than destinations.
  if (raw === "/sign-in" || raw.startsWith("/sign-in?"))
    return DEFAULT_AFTER_SIGN_IN;
  if (raw === "/auth/callback" || raw.startsWith("/auth/")) {
    return DEFAULT_AFTER_SIGN_IN;
  }

  return raw;
}
