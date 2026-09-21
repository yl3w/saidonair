import type { UserRole } from "@media-digest/shared";
import { normalizeEmail } from "../../lib/email";
import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import type { RegistryUser } from "./types";

type UserRow = {
  user_id: string;
  email: string;
  auth_user_id: string | null;
  role: string;
  created_at: number;
  last_seen_at: number;
};

const USER_COLUMNS =
  "user_id, email, auth_user_id, role, created_at, last_seen_at";

/** Normalizes an email argument or rejects the call; the DO never trusts caller casing. */
export function requireEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (!email) throw new DomainError("INVALID_INPUT", "malformed email");
  return email;
}

/**
 * Insert-or-touch. Unknown emails become `user`; an existing role is preserved, and so is the
 * `user_id` minted on the first visit — `email` is still UNIQUE, so it remains the conflict target
 * even though it is no longer the primary key.
 */
export function ensureUser(
  sql: SqlStorage,
  email: string,
  now: number,
): RegistryUser {
  const row = sql
    .exec<UserRow>(
      `INSERT INTO global_users (user_id, email, role, created_at, last_seen_at)
       VALUES (?, ?, 'user', ?, ?)
       ON CONFLICT (email) DO UPDATE SET last_seen_at = excluded.last_seen_at
       RETURNING ${USER_COLUMNS}`,
      crypto.randomUUID(),
      email,
      now,
      now,
    )
    .one();
  return toUser(row);
}

/**
 * Addresses for a set of ids, for the screens that print who acted. Grouped, never one query per
 * row, and chunked because the Registry's parameter budget is 100 (AGENTS.md → Data & schema).
 * An id with no row, or a row with no address, is simply absent.
 */
export function emailsByIds(
  sql: SqlStorage,
  userIds: readonly string[],
): Record<string, string> {
  const found: Record<string, string> = {};
  for (const batch of chunk(userIds)) {
    for (const row of sql.exec<{ user_id: string; email: string | null }>(
      `SELECT user_id, email FROM global_users WHERE user_id IN (${placeholders(batch.length)})`,
      ...batch,
    )) {
      if (row.email !== null) found[row.user_id] = row.email;
    }
  }
  return found;
}

export function getUser(sql: SqlStorage, email: string): RegistryUser | null {
  const row = sql
    .exec<UserRow>(
      `SELECT ${USER_COLUMNS} FROM global_users WHERE email = ?`,
      email,
    )
    .toArray()[0];
  return row ? toUser(row) : null;
}

/**
 * Bootstrap for the configured owner: promotes (or creates) that identity and never
 * demotes anyone, so changing OWNER_EMAIL adds an owner rather than replacing one.
 */
export function seedOwner(sql: SqlStorage, email: string, now: number): void {
  sql.exec(
    `INSERT INTO global_users (user_id, email, role, created_at, last_seen_at)
     VALUES (?, ?, 'owner', ?, ?)
     ON CONFLICT (email) DO UPDATE SET role = 'owner'`,
    crypto.randomUUID(),
    email,
    now,
    now,
  );
}

function toUser(row: UserRow): RegistryUser {
  return {
    userId: row.user_id,
    email: row.email,
    authUserId: row.auth_user_id,
    role: toRole(row.role),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function toRole(value: string): UserRole {
  if (value === "owner" || value === "user") return value;
  // Unreachable given the CHECK constraint; fail loudly rather than widen the type.
  throw new Error(`unexpected global_users.role: ${value}`);
}
