// Claude Code transcripts: ~/.claude/projects/<cwd with / replaced by ->/<session uuid>.jsonl
//
// Every line is a JSON object. Human turns are marked with a `promptSource`, which is what separates a typed
// instruction from the tool results, injected skill text, task notifications and compaction summaries that all
// arrive in the same `user` role.

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** promptSource values that mean a person put these words in. */
const HUMAN = new Set(["typed", "queued", "suggestion_accepted"]);

const root = () => join(homedir(), ".claude", "projects");

/** Claude Code names a project directory after its path, with every "/" turned into "-". */
const projectDir = (repoPath) =>
  join(root(), `-${repoPath.slice(1).replaceAll("/", "-")}`);

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
      // A session still being written can end mid-line.
    }
  }
}

/** Text out of a message body, which is either a bare string or an array of blocks. */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

async function listSessions(repoPath) {
  const dir = projectDir(repoPath);
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return []; // this repo has no Claude Code history
  }
  const out = [];
  for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
    const path = join(dir, file);
    const { mtimeMs } = await stat(path);
    const key = file.slice(0, 8);
    out.push({ agent: "claude", id: key, key, path, mtimeMs });
  }
  return out;
}

async function readSession(ref) {
  const turns = [];
  for await (const entry of lines(ref.path)) {
    const content = entry.message?.content;
    if (
      entry.type === "user" &&
      !entry.isMeta &&
      HUMAN.has(entry.promptSource)
    ) {
      const text = textOf(content);
      if (text.trim())
        turns.push({
          at: entry.timestamp ?? "",
          role: "user",
          text: text.trim(),
        });
    } else if (entry.type === "assistant") {
      const text = textOf(content);
      if (text.trim())
        turns.push({
          at: entry.timestamp ?? "",
          role: "assistant",
          text: text.trim(),
        });
    }
  }
  turns.sort((a, b) => a.at.localeCompare(b.at));
  return { agent: "claude", id: ref.id, turns };
}

export const claude = { name: "claude", listSessions, readSession };
