import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The Cloudflare plugin runs `src/server/worker.ts` inside workerd behind the ordinary Vite dev
// server, so `pnpm dev` keeps hot reload while serving what production will serve
// (docs/specs/public-reading.md §4.4). It reads the bindings from wrangler.jsonc.
//
// **The environment is chosen at build time, by `CLOUDFLARE_ENV`, not by a wrangler `--env` flag.**
// The plugin flattens one environment into the config it generates under `dist/ssr/`, and
// `wrangler deploy` is redirected to that file — so `wrangler deploy --env production` against a
// staging build deploys a production Worker bound to the *staging* API, silently. The package
// scripts set `CLOUDFLARE_ENV` and rebuild on every deploy for exactly that reason.
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    preact(),
    tailwindcss(),
  ],
});
