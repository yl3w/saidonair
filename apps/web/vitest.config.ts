import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

/**
 * The web's tests (`docs/specs/public-reading.md` §3, decisions 16–17; owner decision 2026-09-21,
 * reversing "typecheck and lint only"). A plain Node environment, deliberately:
 *
 * - **No `@cloudflare/vitest-pool-workers`**, unlike `apps/api`. Nothing here needs a binding — the
 *   Worker's own behaviour is proven under `wrangler dev`, as `CLAUDE.md` requires, and what is
 *   tested here are pure modules and `preact-render-to-string`, which runs in Node.
 * - **No jsdom and no component tests.** daisyUI is CSS only and component behaviour is verified by
 *   hand under `pnpm dev`; a jsdom test of a Preact component mostly asserts that the component is
 *   the component.
 *
 * Its own config file rather than `vite.config.ts`, which carries the Cloudflare plugin and would
 * try to stand a Worker up around a unit test.
 */
export default defineConfig({
  // The same preset the app is built with. Without it the default JSX runtime is React's, and the
  // server render test — which renders the real application tree — cannot resolve it. Setting
  // `esbuild.jsxImportSource` does not help: Vitest 4 on Vite 8 transforms with oxc, not esbuild.
  plugins: [preact()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
