// Which person this browser is acting for. Identity, not authentication (docs/PRD.md
// §2): the selected email is sent as X-User-Email on every request. Stored in localStorage as a
// convenience; every access is guarded because storage can be blocked or throw.

const SELECTED_KEY = "media-digest:email";
const RECENT_KEY = "media-digest:recent-emails";
const MAX_RECENT = 5;
const MAX_EMAIL_LENGTH = 254;
// Deliberately loose, the same shape the API accepts: non-empty, one `@`, a dotted domain.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lowercase, exactly as the API normalizes; null when the value cannot be an identity. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_SHAPE.test(email) ? email : null;
}

export function selectedEmail(): string | null {
  return read(SELECTED_KEY);
}

/** Stores the normalized email as selected and remembers it; returns null if it is not an email. */
export function selectEmail(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (email === null) return null;
  write(SELECTED_KEY, email);
  const recent = [email, ...recentEmails().filter((e) => e !== email)];
  write(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  return email;
}

export function clearSelectedEmail(): void {
  try {
    localStorage.removeItem(SELECTED_KEY);
  } catch {
    // Storage unavailable: nothing was selected persistently anyway.
  }
}

export function recentEmails(): string[] {
  const raw = read(RECENT_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((e): e is string => typeof e === "string")
      : [];
  } catch {
    return [];
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the selection lives only for this page load.
  }
}
