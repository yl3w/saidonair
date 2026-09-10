import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";

/**
 * Ordered list of Registry DO migrations. 0001 was rewritten once, on 2026-09-10 before first
 * deployment (docs/specs/channel-simplification.md §6); from here on a committed `.sql` file is
 * frozen and changes are appended (AGENTS.md → Data & schema conventions).
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
];
