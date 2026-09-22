import { describe, expect, it } from "vitest";
import raw from "../wrangler.jsonc?raw";

/**
 * Wrangler inherits no bindings into environments, so every binding is declared once per
 * environment and this test keeps the three declarations in step — the same rule, and the same
 * test, as `apps/api/test/wrangler-config.test.ts` (AGENTS.md → Environments).
 *
 * What it guards that the API's twin does not: **each tier's service binding must point at the API
 * Worker of its own tier.** A web Worker bound to the wrong API is invisible in every other check —
 * it renders, it answers, it just reads somebody else's catalog.
 *
 * The comment stripper below is a twin of the API's. It is duplicated rather than shared because
 * the alternative is a package existing to hold twenty lines, and a test that reaches across
 * workspaces to import a helper is worse than a test that repeats one.
 */

type Named = { binding?: string; service?: string };
type WranglerEnv = {
  name?: string;
  main?: string;
  assets?: {
    directory?: string;
    binding?: string;
    not_found_handling?: string;
    run_worker_first?: string[];
  };
  services?: Named[];
};
type WranglerConfig = WranglerEnv & { env: Record<string, WranglerEnv> };

/** Drops line and block comments outside strings; the file is JSONC with no trailing commas. */
function stripComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 1;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const config = JSON.parse(stripComments(raw)) as WranglerConfig;

/** The top level is staging (AGENTS.md → Environments), so a bare deploy cannot reach production. */
const tiers = {
  staging: {
    env: config,
    worker: "media-digest-web-staging",
    api: "media-digest-api-staging",
  },
  dev: {
    env: config.env.dev,
    worker: "media-digest-web-dev",
    api: "media-digest-api-dev",
  },
  production: {
    env: config.env.production,
    worker: "media-digest-web",
    api: "media-digest-api",
  },
} as const;

describe("apps/web/wrangler.jsonc", () => {
  it("names each Worker on the x / x-staging / x-dev rule, with staging at the top level", () => {
    for (const [tier, { env, worker }] of Object.entries(tiers)) {
      expect(env?.name, tier).toBe(worker);
    }
  });

  it("binds each tier to the API Worker of its own tier", () => {
    for (const [tier, { env, api }] of Object.entries(tiers)) {
      expect(env?.services, tier).toEqual([{ binding: "API", service: api }]);
    }
  });

  it("declares the assets binding identically in all three", () => {
    for (const [tier, { env }] of Object.entries(tiers)) {
      expect(env?.assets, tier).toEqual({
        directory: "./dist/client",
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        // Every public route, because `not_found_handling: "single-page-application"` answers an
        // unmatched path with index.html *before* the Worker is invoked — so without this a
        // channel and a summary are served as the bare shell while `/` renders. `/sources` is
        // absent on purpose: it is the reader's screen and guarded.
        run_worker_first: [
          "/",
          "/sources/*",
          "/read/*",
          // Both are built by the Worker from the request's own origin (src/server/crawl.ts).
          "/robots.txt",
          "/sitemap.xml",
        ],
      });
    }
  });

  it("defines exactly the two named environments beside the top level", () => {
    expect(Object.keys(config.env).sort()).toEqual(["dev", "production"]);
  });
});
