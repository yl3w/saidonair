import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { useSession } from "../session";

/**
 * Site header and primary nav. Owners see "Owner (n)", where n is the attention count from
 * GET /catalog, refreshed on every navigation rather than on a timer (spec §11).
 */
export function Nav() {
  const { state, signOut } = useSession();
  const { path, route } = useLocation();
  const email = state.status === "ready" ? state.email : null;
  const role = state.status === "ready" ? state.role : null;
  const [attention, setAttention] = useState<number | null>(null);

  useEffect(() => {
    if (role !== "owner") {
      setAttention(null);
      return;
    }
    let cancelled = false;
    api.getCatalog().then(
      () => {
        // Task 10: the attention count becomes the review queue plus the paused channels.
        if (!cancelled) setAttention(0);
      },
      () => {
        if (!cancelled) setAttention(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [role, path]);

  return (
    <>
      <header class="site">
        <span class="brand">Media Digest</span>
        <span class="who">
          {email}
          {role === "owner" ? " · owner" : ""} ·{" "}
          <button
            type="button"
            onClick={() => {
              signOut();
              route("/");
            }}
          >
            Switch account
          </button>
        </span>
      </header>
      <nav class="primary" aria-label="Primary">
        <a href="/home" aria-current={path === "/home" ? "page" : undefined}>
          Home
        </a>
        {role === "owner" && (
          <a
            href="/owner"
            aria-current={path.startsWith("/owner") ? "page" : undefined}
          >
            Owner{attention ? ` (${attention})` : ""}
          </a>
        )}
      </nav>
    </>
  );
}
