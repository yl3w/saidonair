import {
  cloudflarePool,
  cloudflareTest,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const workersOptions = {
  wrangler: {
    configPath: "./wrangler.jsonc",
  },
  miniflare: {
    // Tests must not depend on the developer's .dev.vars.
    bindings: { OWNER_EMAIL: "owner@example.com" },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(workersOptions)],
  test: {
    pool: cloudflarePool(workersOptions),
    setupFiles: ["./test/setup.ts"],
  },
});
