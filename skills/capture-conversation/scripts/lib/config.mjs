// Per-repo configuration. Every key is optional, so the skill works in a repo that has never been configured.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULTS = {
  out: "docs/prompts/conversations",
  retentionDays: 30,
  remindWithinDays: 7,
};

const settingsPath = (repo) => join(repo, ".agents", "capture.json");
export const titlesPath = (repo) =>
  join(repo, ".agents", "capture-sessions.json");

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

export async function settings(repo) {
  return { ...DEFAULTS, ...(await readJson(settingsPath(repo), {})) };
}

/** Cached titles and notes, keyed `<agent>-<short id>`. */
export const titles = (repo) => readJson(titlesPath(repo), {});

export async function writeTitles(repo, data) {
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(titlesPath(repo), `${JSON.stringify(sorted, null, 2)}\n`);
}
