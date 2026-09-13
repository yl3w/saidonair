import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";

/**
 * Ordered list of Registry DO migrations. 0001 was rewritten on 2026-09-10 and again on 2026-09-12,
 * both before first deployment (docs/specs/api-reference-plan.md Step 4); the second rewrite folded
 * the 2026-09-11 column drop into it. Migration governance is open (docs/PRD.md §5.4): a file may be
 * edited in place and contain any DDL; an edited, already-applied file re-runs only after the storage
 * that applied it is wiped.
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
];
