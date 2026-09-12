const MAX_EMAIL_LENGTH = 254;
// Deliberately loose: the email is an identity key, not a deliverable address.
// It only has to be non-empty, contain one `@`, and have a dotted domain.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trim + lowercase, the identity normalization from docs/PRD.md §2.
 * Returns null when the value cannot serve as an identity.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_SHAPE.test(email) ? email : null;
}
