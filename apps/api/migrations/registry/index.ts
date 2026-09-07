import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";
import channelRequestTitle from "./0002_channel_request_title.sql";

/**
 * Ordered list of Registry DO migrations. Append only — a committed `.sql` file is frozen
 * (AGENTS.md → Data & schema conventions). `.sql` imports resolve to strings through the
 * `Text` module rule in wrangler.jsonc.
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
  { version: "0002_channel_request_title", sql: channelRequestTitle },
];
