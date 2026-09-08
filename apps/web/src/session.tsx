// Who the browser is acting for, resolved once through GET /me. The role is for rendering only:
// every owner-only operation is authorized again by the API (AGENTS.md → Identity model).
import type { UserRole } from "@media-digest/shared";
import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { clearSelectedEmail, selectEmail, selectedEmail } from "./account";
import { ApiError, api } from "./api";

export type SessionState =
  | { status: "none" }
  | { status: "loading"; email: string }
  | { status: "ready"; email: string; role: UserRole }
  | { status: "error"; email: string; error: Error };

type SessionContextValue = {
  state: SessionState;
  /** Selects an account; returns the normalized email or null when it is not an email. */
  select: (raw: string) => string | null;
  signOut: () => void;
  retry: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const [email, setEmail] = useState<string | null>(() => selectedEmail());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SessionState>(
    email === null ? { status: "none" } : { status: "loading", email },
  );

  useEffect(() => {
    if (email === null) {
      setState({ status: "none" });
      return;
    }
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
        // 400 means the stored value is not an identity the API accepts: forget it.
        if (error instanceof ApiError && error.status === 400) {
          clearSelectedEmail();
          setEmail(null);
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
  }, [email, attempt]);

  const select = useCallback((raw: string) => {
    const normalized = selectEmail(raw);
    if (normalized !== null) setEmail(normalized);
    return normalized;
  }, []);
  const signOut = useCallback(() => {
    clearSelectedEmail();
    setEmail(null);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <SessionContext.Provider value={{ state, select, signOut, retry }}>
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
 * Renders its children only with a ready session (and, with `ownerOnly`, an owner). No account
 * goes back to `/`; a non-owner on an owner page goes Home with a note. Errors offer a retry.
 */
export function Guard({
  children,
  ownerOnly = false,
}: {
  children: ComponentChildren;
  ownerOnly?: boolean;
}) {
  const { state, retry } = useSession();
  const { route } = useLocation();

  useEffect(() => {
    if (state.status === "none") route("/", true);
    if (ownerOnly && state.status === "ready" && state.role !== "owner") {
      route("/home?note=owner-only", true);
    }
  }, [state, ownerOnly, route]);

  if (state.status === "ready" && (!ownerOnly || state.role === "owner")) {
    return <>{children}</>;
  }
  if (state.status === "error") {
    return (
      <main>
        <p class="error">
          Couldn't load your account: {state.error.message}.{" "}
          <button type="button" onClick={retry}>
            Retry
          </button>
        </p>
      </main>
    );
  }
  return (
    <main>
      <p>Loading…</p>
    </main>
  );
}
