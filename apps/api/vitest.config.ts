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
      // Empty on purpose, overriding any key in .dev.vars: no test may reach DownSub. The provider
      // then reads as `unreachable` (lib/transcripts/status.ts), which the catalog route test asserts.
      DOWNSUB_API_KEY: "",
      // An exact origin and a subdomain wildcard, so test/cors.test.ts covers both forms.
      WEB_ORIGINS: "http://localhost:5173,https://*.example.pages.dev",
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
