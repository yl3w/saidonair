import { useEffect } from "preact/hooks";
import { useLocation } from "preact-iso";
import { API_BASE_URL } from "../api";
import { PRODUCT_TAGLINE } from "../lib/copy";
import { safeNextPath } from "../lib/next-path";
import { useDocumentTitle } from "../lib/title";
import { useSession } from "../session";

/**
 * The front door. Until 2026-09-20 it asked "Who is this for?" and took the answer at its word;
 * now it signs the reader in (docs/specs/auth-phase.md).
 *
 * Each provider is a **plain link**, never a fetch. Beginning a sign-in sets a `SameSite=Lax` state
 * cookie on the API's origin, and a cookie set from a cross-origin fetch is refused — so a flow
 * started with `fetch` works on localhost and fails deployed. A top-level navigation keeps every
 * cookie first-party (A4, A5).
 */
export function SignIn() {
  // The front door, whose heading is the wordmark: the product's own name and no second one.
  useDocumentTitle(null);

  const { state } = useSession();
  const { route, query } = useLocation();

  // Where this sign-in is heading, from `?next=` and never trusted raw (lib/next-path.ts).
  const to = safeNextPath(query.next);

  // Already signed in: this tab has somewhere to be, and it is the same somewhere.
  const signedIn = state.status !== "none";
  useEffect(() => {
    if (signedIn) route(to, true);
  }, [signedIn, route, to]);

  // The destination rides through the round trip on the callback's own URL: the API redirects to
  // `next` with the code in the fragment, and `/auth/callback` reads `?to=` before it erases the
  // address bar. Nothing is stored anywhere (docs/specs/public-reading.md §3, decision 10).
  const next = `${window.location.origin}/auth/callback?to=${encodeURIComponent(to)}`;
  const start = (provider: string) =>
    `${API_BASE_URL}/session/start?provider=${provider}&next=${encodeURIComponent(next)}`;

  return (
    <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
        Said on Air
      </h1>
      <p class="mt-1 font-reading text-body text-ink-2">{PRODUCT_TAGLINE}</p>

      <div class="mt-8">
        <a class="btn btn-quiet btn-block" href={start("google")}>
          Continue with Google
        </a>
        <p class="mt-3 text-meta text-ink-3">
          We ask Google only for your name and email address, and never post
          anything.
        </p>
      </div>
    </main>
  );
}
