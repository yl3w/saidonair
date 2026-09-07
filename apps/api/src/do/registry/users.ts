import type { UserRole } from "@media-digest/shared";
import { normalizeEmail } from "../../lib/email";
import { RegistryError } from "../../lib/errors";
import type { RegistryUser } from "./types";

type UserRow = {
  email: string;
  role: string;
  created_at: number;
  last_seen_at: number;
};

const USER_COLUMNS = "email, role, created_at, last_seen_at";

/** Normalizes an email argument or rejects the call; the DO never trusts caller casing. */
export function requireEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (!email) throw new RegistryError("INVALID_INPUT", "malformed email");
  return email;
}

/** Insert-or-touch. Unknown emails become `user`; an existing role is preserved. */
export function ensureUser(
  sql: SqlStorage,
  email: string,
  now: number,
): RegistryUser {
  const row = sql
    .exec<UserRow>(
      `INSERT INTO global_users (email, role, created_at, last_seen_at)
       VALUES (?, 'user', ?, ?)
       ON CONFLICT (email) DO UPDATE SET last_seen_at = excluded.last_seen_at
       RETURNING ${USER_COLUMNS}`,
      email,
      now,
      now,
    )
    .one();
  return toUser(row);
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
    `INSERT INTO global_users (email, role, created_at, last_seen_at)
     VALUES (?, 'owner', ?, ?)
     ON CONFLICT (email) DO UPDATE SET role = 'owner'`,
    email,
    now,
    now,
  );
}

/** Owner checks live in the DO so ordinary identity can never authorize owner actions. */
export function assertOwner(sql: SqlStorage, email: string): void {
  if (getUser(sql, email)?.role !== "owner") {
    throw new RegistryError("NOT_OWNER");
  }
}

function toUser(row: UserRow): RegistryUser {
  return {
    email: row.email,
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
