#!/usr/bin/env node
// Register (or remove) the expiry reminder on each agent's session-start event.
//
//   node register-hook.mjs --agent claude-code cursor codex
//   node register-hook.mjs --agent claude-code --remove
//
// Agent names match the skills CLI, so `pnpm skills:install --agent …` can pass its arguments straight through.
//
// It merges: an agent's config file holds unrelated settings, and this must never be the reason one is lost. Our
// entry is found by the script path in its command, so re-running updates rather than duplicating.

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// The path the hook runs, relative to the repo root — hooks run with the repository as their working directory.
const SCRIPT = "skills/capture-conversation/scripts/uncaptured.mjs";
// The substring that identifies an entry as ours, so re-running updates it instead of adding a second copy. It is
// deliberately a suffix of SCRIPT, so an entry still matches if someone has rewritten the path around it.
const MARKER = "capture-conversation/scripts/uncaptured.mjs";

// `|| true` is the safeguard that matters: if node itself cannot start — a bad path, a missing runtime — the hook
// must still exit 0. A reminder is never worth breaking someone's session start over.

/**
 * Each agent names the same event differently and wraps handlers differently. Everything else about them is the
 * same, so the shape of an entry is per-agent data rather than per-agent code.
 */
const AGENTS = {
  "claude-code": {
    file: join(".claude", "settings.json"),
    event: "SessionStart",
    envelope: "claude",
    entry: (command) => ({ hooks: [{ type: "command", command }] }),
    commandOf: (e) => e?.hooks?.[0]?.command,
    verified: true,
  },
  codex: {
    file: join(".codex", "hooks.json"),
    event: "SessionStart",
    envelope: "codex",
    entry: (command) => ({ hooks: [{ type: "command", command }] }),
    commandOf: (e) => e?.hooks?.[0]?.command,
    verified: true,
  },
  cursor: {
    file: join(".cursor", "hooks.json"),
    event: "sessionStart",
    envelope: "cursor",
    entry: (command) => ({ command }),
    commandOf: (e) => e?.command,
    base: { version: 1 },
    // Written from Cursor's published hook documentation. Cursor is not installed on this machine, so unlike the
    // other two this registration has never been exercised.
    verified: false,
  },
};

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const quiet = args.includes("--quiet");

/** `--agent a b c` — every value until the next flag, matching how the skills CLI reads it. */
function requestedAgents() {
  const at = args.indexOf("--agent");
  if (at === -1) return [];
  const names = [];
  for (let i = at + 1; i < args.length && !args[i].startsWith("-"); i += 1)
    names.push(args[i]);
  return names;
}

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};

/** True when nothing but scaffolding is left, so a file this created can be taken away again. */
const isTrivial = (config) => {
  const keys = Object.keys(config).filter((k) => k !== "version");
  return (
    keys.length === 0 ||
    (keys.length === 1 &&
      keys[0] === "hooks" &&
      !Object.keys(config.hooks ?? {}).length)
  );
};

async function apply(name) {
  const agent = AGENTS[name];
  if (!agent) return { name, status: "unsupported" };

  const path = agent.file;
  const existing = await readJson(path);
  const config = existing ?? { ...(agent.base ?? {}) };
  const command = `node ${SCRIPT} --agent ${agent.envelope} || true`;

  config.hooks ??= {};
  config.hooks[agent.event] ??= [];
  const list = config.hooks[agent.event];
  const mine = list.findIndex((e) => agent.commandOf(e)?.includes(MARKER));

  if (remove) {
    if (mine === -1) return { name, status: "absent" };
    list.splice(mine, 1);
    if (!list.length) delete config.hooks[agent.event];
    if (!Object.keys(config.hooks).length) delete config.hooks;
    if (isTrivial(config)) {
      await unlink(path).catch(() => {});
      return {
        name,
        status: "removed",
        path,
        note: "file had nothing else in it",
      };
    }
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    return { name, status: "removed", path };
  }

  if (mine !== -1) {
    if (agent.commandOf(list[mine]) === command)
      return { name, status: "already registered", path };
    list[mine] = agent.entry(command);
  } else {
    list.push(agent.entry(command));
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return {
    name,
    status: existing
      ? "registered (merged into existing config)"
      : "registered (file created)",
    path,
    unverified: !agent.verified,
  };
}

// With no `--agent`, the skills CLI auto-detects which agents to install to. There is no equivalent detection for
// hooks, and registering nothing would leave a fresh clone with the skill installed and the reminder missing — the
// kind of failure nobody notices. All three are registered instead: it is idempotent, and a config file for an
// agent that is not installed is inert.
const named = requestedAgents();
const names = (named.length ? named : Object.keys(AGENTS)).filter(
  (n) => AGENTS[n],
);
if (!names.length) {
  if (!quiet)
    console.log(
      `capture-conversation: no supported agent among ${named.join(", ")}; hook not registered.`,
    );
  process.exit(0);
}

for (const name of names) {
  const result = await apply(name);
  if (quiet && result.status === "already registered") continue;
  const extra = result.note ? ` — ${result.note}` : "";
  console.log(
    `capture-conversation hook: ${name} ${result.status}${result.path ? ` (${result.path})` : ""}${extra}`,
  );
  if (result.unverified) {
    console.log(
      "  note: written from documentation; Cursor is not installed here, so this is untested.",
    );
  }
}
