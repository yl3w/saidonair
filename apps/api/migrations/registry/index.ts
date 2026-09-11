import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";
import dropLifecycleVersion from "./0002_drop_lifecycle_version.sql";

/**
 * Ordered list of Registry DO migrations. 0001 was rewritten once, on 2026-09-10 before first
 * deployment (docs/specs/channel-simplification.md §6); from here on a committed `.sql` file is
 * frozen and changes are appended (AGENTS.md → Data & schema conventions). 0002 is the one
 * owner-approved DROP COLUMN (2026-09-11).
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
  { version: "0002_drop_lifecycle_version", sql: dropLifecycleVersion },
];
