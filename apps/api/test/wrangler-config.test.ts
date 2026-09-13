import { describe, expect, it } from "vitest";
import raw from "../wrangler.jsonc?raw";

/**
 * Wrangler inherits no bindings into environments, so every binding is declared once per environment
 * and this test keeps the three declarations in step (AGENTS.md → Environments, owner decision
 * 2026-09-13): same Durable Objects and migrations everywhere, named resources following the
 * `x` / `x-staging` / `x-dev` rule, cron triggers in production only.
 */

type Named = {
  name?: string;
  binding?: string;
  index_name?: string;
  class_name?: string;
};
type WranglerEnv = {
  name?: string;
  vars?: Record<string, string>;
  durable_objects?: { bindings: Named[] };
  migrations?: unknown[];
  vectorize?: Named[];
  ai?: { binding: string; remote?: boolean };
  workflows?: Named[];
  triggers?: { crons?: string[] };
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
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 1;
    } else out += ch;
  }
  return out;
}

const config = JSON.parse(stripComments(raw)) as WranglerConfig;
const staging = config;
const dev = config.env.dev;
const production = config.env.production;

describe("wrangler.jsonc environments", () => {
  it("declares exactly dev and production beside the staging top level", () => {
    expect(Object.keys(config.env).sort()).toEqual(["dev", "production"]);
    expect(staging.name).toBe("media-digest-api-staging");
    expect(dev?.name).toBe("media-digest-api-dev");
    expect(production?.name).toBe("media-digest-api");
  });

  it("gives every environment the same Durable Objects; migrations are declared once and inherited", () => {
    for (const env of [dev, production]) {
      expect(env?.durable_objects).toEqual(staging.durable_objects);
      expect(env?.migrations).toBeUndefined();
    }
    expect(staging.migrations).toHaveLength(2);
    expect(staging.durable_objects?.bindings.map((b) => b.name).sort()).toEqual(
      ["REGISTRY_DO", "USER_DO"],
    );
  });

  it("names per-environment resources production `x`, staging `x-staging`, dev `x-dev`", () => {
    const named = (env: WranglerEnv | undefined) => [
      ...(env?.vectorize ?? []).map((v) => ({
        binding: v.binding,
        name: v.index_name,
      })),
      ...(env?.workflows ?? []).map((w) => ({
        binding: w.binding,
        name: w.name,
      })),
    ];
    const prod = named(production);
    expect(
      named(staging)
        .map((r) => r.binding)
        .sort(),
    ).toEqual(prod.map((r) => r.binding).sort());
    expect(
      named(dev)
        .map((r) => r.binding)
        .sort(),
    ).toEqual(prod.map((r) => r.binding).sort());
    for (const resource of prod) {
      expect(
        named(staging).find((r) => r.binding === resource.binding)?.name,
      ).toBe(`${resource.name}-staging`);
      expect(named(dev).find((r) => r.binding === resource.binding)?.name).toBe(
        `${resource.name}-dev`,
      );
    }
    // The AI binding has no name but must exist everywhere or nowhere, remote everywhere it exists.
    expect(Boolean(dev?.ai)).toBe(Boolean(production?.ai));
    expect(Boolean(staging.ai)).toBe(Boolean(production?.ai));
  });

  it("runs both cron triggers in production and none elsewhere", () => {
    expect(production?.triggers?.crons).toEqual([
      "0 */6 * * *",
      "30 */6 * * *",
    ]);
    expect(staging.triggers).toBeUndefined();
    expect(dev?.triggers).toBeUndefined();
  });

  it("keeps the local web origins in dev only; the deployed tiers set theirs when the web exists", () => {
    expect(dev?.vars?.WEB_ORIGINS).toBe(
      "http://localhost:5173,http://127.0.0.1:5173",
    );
    expect(staging.vars ?? {}).not.toHaveProperty(
      "WEB_ORIGINS",
      dev?.vars?.WEB_ORIGINS,
    );
  });
});
