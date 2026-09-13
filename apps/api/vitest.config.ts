import {
  cloudflarePool,
  cloudflareTest,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { FAKE_TRANSCRIPTS } from "./test/fixtures/transcripts";

const workersOptions = {
  wrangler: {
    configPath: "./wrangler.jsonc",
    // The environment a developer runs (`pnpm dev`); tests never reach its remote resources.
    environment: "dev",
  },
  // AI and Vectorize are `remote: true` for wrangler dev. Off here, the pool opens no remote session
  // and the bindings throw if anything touches them; the fakes below answer instead (M3.1 Step 0.2).
  remoteBindings: false,
  miniflare: {
    bindings: {
      // Tests must not depend on the developer's .dev.vars.
      OWNER_EMAIL: "owner@example.com",
      // Empty on purpose, overriding any key in .dev.vars: no test may reach DownSub. The fake below
      // answers instead; a test that clears it sees the provider as `unreachable`.
      DOWNSUB_API_KEY: "",
      // Canned transcripts and provider health (test/fixtures/transcripts.ts); see
      // lib/transcripts/index.ts. Tests may reassign `env.TRANSCRIPTS_FAKE` for one case.
      TRANSCRIPTS_FAKE: JSON.stringify(FAKE_TRANSCRIPTS),
      // Deterministic Workers AI and an in-memory vector store (lib/ai.ts, lib/vectorize.ts). Tests may
      // reassign either for one case.
      AI_FAKE: "{}",
      VECTORIZE_FAKE: "{}",
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
