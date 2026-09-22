import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

/**
 * The web's tests (`docs/specs/public-reading.md` §3, decisions 16–17; owner decision 2026-09-21,
 * reversing "typecheck and lint only"). A plain Node environment, deliberately:
 *
 * - **No `@cloudflare/vitest-pool-workers`**, unlike `apps/api`. Nothing here needs a binding — the
 *   Worker's own behaviour is proven under `wrangler dev`, as `CLAUDE.md` requires, and what is
 *   tested here are pure modules and `preact-render-to-string`, which runs in Node.
 * - **Component tests, but no DOM** (owner decision 2026-09-22, reversing "no component tests";
 *   `docs/PRD.md` §8 and §9). A component renders to a string through `preact-render-to-string` —
 *   already a dependency for the server render — so what a component *decides* from its props is
 *   testable with no new dependency. Interaction needs a DOM and stays hand-verified under
 *   `pnpm dev`; `happy-dom` was offered and declined.
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
