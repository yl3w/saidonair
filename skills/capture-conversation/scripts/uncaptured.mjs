#!/usr/bin/env node
// Report conversations about to expire from a local cache that have never been captured.
//
// Registered on each agent's session-start event:
//   node uncaptured.mjs --agent claude|cursor|codex
//
// It never blocks, never writes a capture, and always exits 0. A reminder that can break someone's session start is
// worse than no reminder at all.

import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { settings } from "./lib/config.mjs";
import { claude } from "./sources/claude.mjs";
import { codex } from "./sources/codex.mjs";

const SOURCES = [claude, codex];
const DAY_MS = 86_400_000;

const args = process.argv.slice(2);
const agent = (
  args.includes("--agent") ? args[args.indexOf("--agent") + 1] : "claude"
).toLowerCase();
const force = args.includes("--force"); // ignore the throttle, for testing
// Widen the expiry window. Without this the reminder could only be exercised by waiting three weeks, which would
// mean shipping an unattended script untested.
const withinOverride = args.includes("--within")
  ? Number(args[args.indexOf("--within") + 1])
  : null;

/** Codex retention is not established; Claude Code's cleanupPeriodDays default is. Say so rather than implying. */
const APPROXIMATE = new Set(["codex"]);

/**
 * Throttle state lives outside the repo: it is per-machine, and committing it would let one developer's reminder
 * silence another's. One file per repo, shared across agents — three agents each nagging once a day is three nags.
 */
function throttlePath(repo) {
  return join(
    homedir(),
    ".cache",
    "capture-conversation",
    `${repo.replace(/[^\w]+/g, "_")}.json`,
  );
}

async function throttled(repo) {
  if (force) return false;
  const path = throttlePath(repo);
  const today = new Date().toLocaleDateString("sv-SE");
  try {
    const { lastReported } = JSON.parse(await readFile(path, "utf8"));
    if (lastReported === today) return true;
  } catch {
    // No state yet, or unreadable — report and write fresh state.
  }
  try {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify({ lastReported: today })}\n`);
  } catch {
    // If the throttle cannot be written the reminder still runs. Nagging beats silence.
  }
  return false;
}

/** Every session id already accounted for by a capture, including ones absorbed into a merged conversation. */
async function captured(outDir) {
  const covered = new Set();
  let files;
  try {
    files = await readdir(outDir);
  } catch {
    return covered; // nothing captured yet
  }
  for (const file of files.filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  )) {
    let body;
    try {
      body = await readFile(join(outDir, file), "utf8");
    } catch {
      continue;
    }
    const match = body.match(/<!--\s*capture:covers\s+([^>]*?)\s*-->/);
    if (match)
      for (const id of match[1].split(/\s+/).filter(Boolean)) covered.add(id);
  }
  return covered;
}

function say(message) {
  if (agent === "codex")
    console.log(JSON.stringify({ systemMessage: message }));
  else if (agent === "cursor")
    console.log(JSON.stringify({ continue: true, user_message: message }));
  else console.log(message); // Claude Code reads a hook's stdout directly
}

async function main() {
  let repo;
  try {
    repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return; // not a git repository; nothing to remind about
  }

  const config = await settings(repo);
  const outDir = resolve(repo, config.out);
  const covered = await captured(outDir);

  const now = Date.now();
  const expiring = [];
  for (const source of SOURCES) {
    for (const ref of await source.listSessions(repo)) {
      const key = `${ref.agent}-${ref.key}`;
      if (covered.has(key)) continue;
      const daysLeft = Math.floor(
        config.retentionDays - (now - ref.mtimeMs) / DAY_MS,
      );
      if (daysLeft <= (withinOverride ?? config.remindWithinDays))
        expiring.push({ key, agent: ref.agent, daysLeft, ref });
    }
  }
  if (!expiring.length) return;

  // A transcript can hold no conversation at all — an agent opened and closed. There is nothing to capture, so
  // reporting it every day until it expires is a false alarm. Checking costs a read, which is why it happens here,
  // against the handful of candidates, rather than against every transcript on disk.
  const nonEmpty = [];
  for (const candidate of expiring) {
    const source = SOURCES.find((x) => x.name === candidate.agent);
    try {
      const { turns } = await source.readSession(candidate.ref);
      if (turns.length) nonEmpty.push(candidate);
    } catch {
      nonEmpty.push(candidate); // unreadable is not the same as empty; say so rather than swallow it
    }
  }
  if (!nonEmpty.length) return;

  // Several rollout files can belong to one conversation; report it once, at its shortest remaining life.
  const byKey = new Map();
  for (const e of nonEmpty) {
    const seen = byKey.get(e.key);
    if (!seen || e.daysLeft < seen.daysLeft) byKey.set(e.key, e);
  }
  const rows = [...byKey.values()].sort((a, b) => a.daysLeft - b.daysLeft);

  if (await throttled(repo)) return;

  const gone = rows.filter((r) => r.daysLeft <= 0).length;
  const lines = [
    `${rows.length} uncaptured conversation${rows.length === 1 ? "" : "s"} in this repo ${gone ? "may already be gone" : "will expire soon"}:`,
  ];
  for (const r of rows.slice(0, 10)) {
    const when =
      r.daysLeft <= 0
        ? "past its retention window"
        : `~${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`;
    const caveat = APPROXIMATE.has(r.agent)
      ? " (Codex retention is unconfirmed; this is an estimate)"
      : "";
    lines.push(`  ${r.key} — ${when}${caveat}`);
  }
  if (rows.length > 10) lines.push(`  …and ${rows.length - 10} more`);
  lines.push(
    "",
    "Capture them with the capture-conversation skill, or ignore this — it will not ask again today.",
  );
  say(lines.join("\n"));
}

try {
  await main();
} catch {
  // A reminder must never break a session start. Failing silently is the correct behaviour here.
}
process.exit(0);
