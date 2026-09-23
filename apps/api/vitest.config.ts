import {
  cloudflarePool,
  cloudflareTest,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { FAKE_FEEDS } from "./test/fixtures/feeds";
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
      // The launcher fake (lib/workflows.ts): every instance reads `active` unless a test says otherwise.
      WORKFLOW_FAKE: JSON.stringify({ default: "active" }),
      // An exact origin and a subdomain wildcard, so test/cors.test.ts covers both forms.
      WEB_ORIGINS: "http://localhost:5173,https://*.example.pages.dev",
      // Canned YouTube feeds so no test reaches the network (test/fixtures/feeds.ts; see
      // lib/youtube/rss.ts feedFetcher). CHANNEL_A…D are title-only feeds, E has no feed like
      // YouTube's 404 for an unknown id, F carries fifteen entries under its long-form key for the
      // discovery tests, and G's long-form feed 404s while its channel feed verifies.
      YOUTUBE_FEEDS_FAKE: JSON.stringify(FAKE_FEEDS),
    },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(workersOptions)],
  test: {
    pool: cloudflarePool(workersOptions),
    setupFiles: ["./test/setup.ts"],
    /**
     * Vitest's default is 5,000 ms, and this suite's slowest tests live right under it — which is
     * what made `routes-follows-digest` → "bounds the range…" fail about twice in twenty-four full
     * runs, always that test, always at ~5,050 ms (2026-09-22).
     *
     * It is not a hang. Measured across sixteen full-suite runs it costs **2.6 s to 5.1 s**, a
     * continuous spread, against **394 ms** when its file runs alone — the difference is the other
     * forty-three files competing for the machine. Two tests are in that band, not one:
     *
     *     4,967 ms  routes-follows-digest  bounds the range, filters unread and by channel…
     *     4,091 ms  registry-episodes      holds together past the bound-parameter ceiling
     *     2,444 ms  routes-channels        answers one episode, and records or undoes its receipt…
     *
     * Both are heavy on purpose: the first makes twenty-seven requests over a seeded catalog, and
     * the second deliberately blows past the 100 bound-parameter ceiling. A budget equal to the
     * worst case is not a budget, so this is three times the worst measured. A real hang still
     * fails, fifteen seconds later.
     */
    testTimeout: 15_000,
  },
});
