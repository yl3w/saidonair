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
    bindings: {
      // Tests must not depend on the developer's .dev.vars.
      OWNER_EMAIL: "owner@example.com",
      // Canned YouTube feeds so no test reaches the network (see lib/youtube/rss.ts feedFetcher).
      // Keys are the helpers' CHANNEL_A…E; E has no feed, like YouTube's 404 for an unknown id.
      YOUTUBE_FEEDS_FAKE: JSON.stringify({
        UCAAAAAAAAAAAAAAAAAAAAAA: "Feed A",
        UCBBBBBBBBBBBBBBBBBBBBBB: "Feed B",
        UCCCCCCCCCCCCCCCCCCCCCCC: "Feed C",
        UCDDDDDDDDDDDDDDDDDDDDDD: "Feed D",
        UCEEEEEEEEEEEEEEEEEEEEEE: null,
      }),
    },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(workersOptions)],
  test: {
    pool: cloudflarePool(workersOptions),
    setupFiles: ["./test/setup.ts"],
  },
});
