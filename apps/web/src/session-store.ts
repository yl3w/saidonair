// What this browser holds after signing in. Replaces `account.ts`, which stored a typed-in address
// because identity was self-asserted (docs/PRD.md §2, until 2026-09-20).
//
// The token is the credential. The address is kept beside it only so a reload can render the
// account before `GET /me` answers; nothing is sent but the token.
//
// Every access is guarded: storage can be blocked or throw, and a reader in a private window should
// meet the sign-in screen, not a crash.

const KEY = "media-digest:session";

export type StoredSession = { token: string; email: string | null };

export function storedSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof (parsed as { token: unknown }).token === "string"
    ) {
      const { token, email } = parsed as StoredSession;
      return { token, email: typeof email === "string" ? email : null };
    }
    return null;
  } catch {
    return null;
  }
}

export function storeSession(session: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the session lives only for this page load.
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was stored persistently anyway.
  }
}
