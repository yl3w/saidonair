import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";

/**
 * Ordered list of per-user DO migrations. Append only — a committed `.sql` file is frozen
 * (docs/PRD.md §5.4).
 */
export const userMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
];
