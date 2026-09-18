// Codex transcripts: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session uuid>.jsonl
//
// The path carries no repository, so a session is matched to a repo by the `cwd` on its `session_meta` first line.
//
// Codex has no `promptSource` equivalent, so a typed turn cannot be told from an injected one by a flag. Injected
// turns arrive in the user role with recognisable openings and are excluded by prefix, which is weaker and will need
// revisiting whenever Codex changes what it injects.

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const root = () => join(homedir(), ".codex", "sessions");

/** Openings that mark a user-role turn the harness wrote rather than the developer. */
const INJECTED = [
  "<environment_context>",
  "<user_instructions>",
  "# AGENTS.md instructions",
  // Codex advertises uninstalled plugins in the user role. Twenty of these were captured as though the developer
  // had typed them before this was noticed.
  "<recommended_plugins>",
];

/** Payload types that are tool traffic or model internals, not conversation. */
const DROP = new Set([
  "reasoning",
  "custom_tool_call",
  "custom_tool_call_output",
  "function_call",
  "function_call_output",
]);

async function* lines(path) {
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // As with Claude Code, a live session can end mid-line.
    }
  }
}

/** Walk the date-sharded tree for every rollout file. */
async function* rollouts(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* rollouts(path);
    else if (entry.name.endsWith(".jsonl")) yield path;
  }
}

/** The first line of a rollout is its session_meta; read only that to decide whether the repo matches. */
async function meta(path) {
  for await (const entry of lines(path)) {
    if (entry.type !== "session_meta") return null;
    return entry.payload ?? null;
  }
  return null;
}

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .join("\n");

async function listSessions(repoPath) {
  const out = [];
  for await (const path of rollouts(root())) {
    const m = await meta(path);
    if (!m || m.cwd !== repoPath) continue;
    const { mtimeMs } = await stat(path);
    // Several rollout files carry the same session_id: Codex segments one conversation across them. The key
    // groups them back together; the path is what gets read.
    const key = String(m.session_id ?? "").slice(0, 8);
    out.push({ agent: "codex", id: key, key, path, mtimeMs });
  }
  return out;
}

async function readSession(ref) {
  const turns = [];
  for await (const entry of lines(ref.path)) {
    if (entry.type !== "response_item") continue;
    const p = entry.payload ?? {};
    if (DROP.has(p.type) || p.type !== "message") continue;
    const role = p.role;
    if (role !== "user" && role !== "assistant") continue; // `developer` is instructions, not conversation
    const text = textOf(p.content).trim();
    if (!text) continue;
    if (role === "user" && INJECTED.some((prefix) => text.startsWith(prefix)))
      continue;
    turns.push({ at: entry.timestamp ?? "", role, text });
  }
  turns.sort((a, b) => a.at.localeCompare(b.at));
  return { agent: "codex", id: ref.id, turns };
}

export const codex = { name: "codex", listSessions, readSession };
