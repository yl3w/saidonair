export type Migration = {
  /** Matches the file name without extension, e.g. `0001_init`. */
  version: string;
  sql: string;
};

type MigrationRow = { version: string };

/**
 * Applies every migration not yet recorded in `_migrations`, each in its own transaction,
 * and returns the versions applied. A second call applies nothing. Run this under
 * `blockConcurrencyWhile` so no request observes a half-migrated schema.
 */
export function applyMigrations(
  storage: DurableObjectStorage,
  migrations: readonly Migration[],
): string[] {
  const sql = storage.sql;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    sql
      .exec<MigrationRow>("SELECT version FROM _migrations")
      .toArray()
      .map((row) => row.version),
  );

  const newlyApplied: string[] = [];
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
    if (applied.has(migration.version)) continue;

    storage.transactionSync(() => {
      sql.exec(migration.sql);
      sql.exec(
        "INSERT INTO _migrations (version, created_at) VALUES (?, ?)",
        migration.version,
        Date.now(),
      );
    });
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}
