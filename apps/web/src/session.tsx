// Who this tab is acting for, resolved once through GET /me. The role decides what this tab
// offers; since A8 the API refuses the catalog operations itself too (docs/PRD.md §2). The stored session seeds
// the first render; after that this tab's session lives here and is bound into the API client, so
// another tab signing in or out cannot change what this one sends.
import type { UserRole } from "@media-digest/shared";
import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { API_BASE_URL, ApiError, api, bindSession } from "./api";
import { Retry } from "./components/Retry";
import {
  clearStoredSession,
  type StoredSession,
  storedSession,
  storeSession,
} from "./session-store";

export type SessionState =
  | { status: "none" }
  | { status: "loading"; email: string }
  | { status: "ready"; email: string; role: UserRole }
  | { status: "error"; email: string; error: Error };

type SessionContextValue = {
  state: SessionState;
  /** Takes the session the handoff just exchanged, and remembers it for the next page load. */
  adopt: (session: StoredSession) => void;
  signOut: () => void;
  retry: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const [stored, setStored] = useState<StoredSession | null>(() =>
    storedSession(),
  );
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SessionState>(
    stored === null
      ? { status: "none" }
      : { status: "loading", email: stored.email ?? "" },
  );

  useEffect(() => {
    // Bind before the state moves: the Guard renders children from `state`, so a screen can only
    // act once the session it will send is the one it shows.
    bindSession(stored);
    if (stored === null) {
      setState({ status: "none" });
      return;
    }
    const email = stored.email ?? "";
    let cancelled = false;
    setState({ status: "loading", email });
    api.getMe().then(
      (me) => {
        if (!cancelled) {
          setState({ status: "ready", email: me.email, role: me.role });
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        // 400 or 401 means this session is not one the API accepts any more: forget it and show
        // the front door rather than an error about a token the reader never saw.
        if (
          error instanceof ApiError &&
          (error.status === 400 || error.status === 401)
        ) {
          clearStoredSession();
          setStored(null);
          return;
        }
        setState({
          status: "error",
          email,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [stored, attempt]);

  const adopt = useCallback((session: StoredSession) => {
    storeSession(session);
    setStored(session);
  }, []);
  const signOut = useCallback(() => {
    // End it at the server too, not merely in this browser: a token dropped locally is still a
    // valid session until it expires. Local state is cleared either way — a reader who asks to
    // sign out is signed out of this tab even if the network refuses.
    const token = stored?.token;
    if (token !== undefined) {
      void fetch(`${API_BASE_URL}/auth/sign-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    clearStoredSession();
    setStored(null);
  }, [stored]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <SessionContext.Provider value={{ state, adopt, signOut, retry }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession outside SessionProvider");
  return value;
}

/** For screens rendered under a Guard, where the session is known to be ready. */
export function useReadySession(): { email: string; role: UserRole } {
  const { state } = useSession();
  if (state.status !== "ready") throw new Error("session is not ready");
  return { email: state.email, role: state.role };
}

/**
 * Renders its children only with a ready session (and, with `ownerOnly`, an owner). No session
 * goes back to `/`; a reader who is not the owner, on Curate, goes to the queue with a note. This
 * decides what is *shown*: since A8 the API refuses the catalog operations on its own, so a reader
 * who reaches one anyway meets a 403 rather than an unguarded write (docs/PRD.md §2).
 */
export function Guard({
  children,
  ownerOnly = false,
}: {
  children: ComponentChildren;
  ownerOnly?: boolean;
}) {
  const { state, retry } = useSession();
  const { route, path } = useLocation();

  useEffect(() => {
    // `/sign-in`, not `/` — `/` is the landing page a visitor browses, and an expired session
    // deserves a screen that explains itself (docs/specs/public-reading.md §4.3). The path comes
    // back with them, so a reader whose session lapsed mid-read returns to what they were reading.
    if (state.status === "none") {
      route(`/sign-in?next=${encodeURIComponent(path)}`, true);
    }
    if (ownerOnly && state.status === "ready" && state.role !== "owner") {
      route("/queue?note=owner-only", true);
    }
  }, [state, ownerOnly, route, path]);

  if (state.status === "ready" && (!ownerOnly || state.role === "owner")) {
    return <>{children}</>;
  }
  if (state.status === "error") {
    return (
      <main class="mx-auto w-full max-w-list px-5 pt-8 md:px-8">
        <p class="text-ui text-consequence">
          Couldn't load your account: {state.error.message}.{" "}
          <Retry onClick={retry} />
        </p>
      </main>
    );
  }
  return (
    <main class="mx-auto w-full max-w-list px-5 pt-8 md:px-8">
      <div class="skeleton h-8 w-48" />
    </main>
  );
}
