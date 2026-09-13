import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";
import dropLifecycleVersion from "./0002_drop_lifecycle_version.sql";

/**
 * Ordered list of Registry DO migrations. 0001 was rewritten once, on 2026-09-10 before first
 * deployment (docs/specs/channel-simplification.md §6). Migration governance is open (docs/PRD.md
 * §5.4, 2026-09-12): a file may be edited in place and contain any DDL; an edited, already-applied
 * file re-runs only after the storage that applied it is wiped. 0002 drops two columns (2026-09-11).
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
  { version: "0002_drop_lifecycle_version", sql: dropLifecycleVersion },
];
