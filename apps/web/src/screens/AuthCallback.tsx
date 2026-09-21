import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { API_BASE_URL } from "../api";
import { useDocumentTitle } from "../lib/title";
import { useSession } from "../session";

/**
 * Where the handoff lands (docs/specs/auth-phase.md §4.5). The API put a single-use code in the URL
 * fragment — never a token, and a fragment is never sent to a server — and this screen spends it
 * for the session.
 *
 * **The hash is read before anything else, and erased before anything else.** A5 proved the hazard:
 * the router sends an unknown path to `route("/queue", true)`, a `replaceState` that discards the
 * fragment, so a sign-in appears to succeed and silently arrives with no code. This route must
 * exist, and must take the code out of the URL before any navigation.
 */
export function AuthCallback() {
  useDocumentTitle("Signing in");

  const { adopt } = useSession();
  const { route } = useLocation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    ).get("code");
    // Out of the address bar and out of history immediately, whether or not it is any good.
    window.history.replaceState(null, "", window.location.pathname);
    if (code === null) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    fetch(`${API_BASE_URL}/session/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as {
          token: string;
          email: string | null;
        };
      })
      .then(({ token, email }) => {
        if (cancelled) return;
        adopt({ token, email });
        route("/queue", true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [adopt, route]);

  return (
    <main class="mx-auto w-full max-w-list px-5 pt-8 md:px-8">
      {failed ? (
        <p class="text-ui text-consequence">
          That sign-in could not be completed — the link may have been used
          already, or it may have expired.{" "}
          <a class="link" href="/">
            Try again
          </a>
          .
        </p>
      ) : (
        <div class="skeleton h-8 w-48" />
      )}
    </main>
  );
}
