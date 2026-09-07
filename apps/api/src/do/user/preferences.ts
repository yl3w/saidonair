import { DomainError } from "../../lib/errors";
import type { UserPreferences } from "./types";

type PreferencesRow = { system_rules: string; updated_at: number };

/** Rules are pasted into chat prompts verbatim; keep them bounded. */
const MAX_SYSTEM_RULES_LENGTH = 4000;

export function getPreferences(sql: SqlStorage): UserPreferences {
  const row = sql
    .exec<PreferencesRow>(
      "SELECT system_rules, updated_at FROM user_preferences WHERE id = 'default'",
    )
    .toArray()[0];
  return row
    ? { systemRules: row.system_rules, updatedAt: row.updated_at }
    : { systemRules: "", updatedAt: null };
}

export function setPreferences(
  sql: SqlStorage,
  systemRules: string,
  now: number,
): UserPreferences {
  if (systemRules.length > MAX_SYSTEM_RULES_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `systemRules must be at most ${MAX_SYSTEM_RULES_LENGTH} characters`,
    );
  }
  const row = sql
    .exec<PreferencesRow>(
      `INSERT INTO user_preferences (id, system_rules, created_at, updated_at)
       VALUES ('default', ?, ?, ?)
       ON CONFLICT (id) DO UPDATE
         SET system_rules = excluded.system_rules, updated_at = excluded.updated_at
       RETURNING system_rules, updated_at`,
      systemRules,
      now,
      now,
    )
    .one();
  return { systemRules: row.system_rules, updatedAt: row.updated_at };
}
