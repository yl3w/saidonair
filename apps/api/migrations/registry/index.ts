import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";
import episodeDuration from "./0002_episode_duration.sql";

/**
 * Ordered list of Registry DO migrations. 0001 was rewritten on 2026-09-10 and again on 2026-09-12,
 * both before first deployment (docs/specs/api-reference-plan.md Step 4); the second rewrite folded
 * the 2026-09-11 column drop into it. Migration governance is open (docs/PRD.md §5.4): a file may be
 * edited in place and contain any DDL; an edited, already-applied file re-runs only after the storage
 * that applied it is wiped. 0002 is additive and was added on 2026-09-14 rather than folded into
 * 0001, because by then there was a local catalog worth keeping and an edit to 0001 would have
 * required wiping the storage that holds it.
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
  { version: "0002_episode_duration", sql: episodeDuration },
];
