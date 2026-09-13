import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";

/**
 * Ordered list of per-user DO migrations. Migration governance is open (docs/PRD.md §5.4, 2026-09-12):
 * a file may be edited in place; storage that already applied it must be wiped for the edit to run.
 */
export const userMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
];
