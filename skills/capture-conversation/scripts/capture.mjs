#!/usr/bin/env node
// Capture an agent conversation into this repository.
//
//   node capture.mjs                    # the live session
//   node capture.mjs --session 1a2b3c4d # one session by short id
//   node capture.mjs --backfill         # every session still in the local caches
//   node capture.mjs --index            # rebuild the index only
//   node capture.mjs --retitle [id]     # drop cached titles so they are written again
//   node capture.mjs --out <dir>        # override the configured output directory
//   --dry-run                           # report, write nothing
//
// Every capture is screened before it is written (see screen.mjs). A capture with an unresolved finding is not
// written at all — screening after the fact would mean the secret had already landed in the repo.

import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { settings, titles, writeTitles } from "./lib/config.mjs";
import { day, renderCapture, renderIndex } from "./lib/render.mjs";
import { knownSecrets, screen } from "./screen.mjs";
import { claude } from "./sources/claude.mjs";
import { codex } from "./sources/codex.mjs";

const SOURCES = [claude, codex];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null;

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const config = await settings(repo);
const outDir = resolve(repo, value("--out") ?? config.out);
const dryRun = flag("--dry-run");

/**
 * Every logical session either cache holds for this repo, newest last.
 *
 * A conversation is not one file. Codex segments a single session across several rollout files that all report the
 * same session_id, so they are grouped here and read as one. Claude Code does the opposite — a resumed session's
 * transcript repeats its parent's turns — which `dropContained` below handles instead.
 */
async function allSessions() {
  const groups = new Map();
  for (const source of SOURCES) {
    for (const ref of await source.listSessions(repo)) {
      const key = `${ref.agent}-${ref.key}`;
      const group = groups.get(key) ?? {
        agent: ref.agent,
        id: ref.id,
        key,
        paths: [],
        mtimeMs: 0,
      };
      group.paths.push(ref);
      group.mtimeMs = Math.max(group.mtimeMs, ref.mtimeMs);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.mtimeMs - b.mtimeMs);
}

const turnId = (t) => `${t.at}\u0000${t.role}\u0000${t.text}`;

/** Read every segment of one session and merge them into a single ordered, deduplicated conversation. */
async function read(group) {
  const source = SOURCES.find((s) => s.name === group.agent);
  const seen = new Set();
  const turns = [];
  for (const ref of group.paths) {
    const segment = await source.readSession(ref);
    for (const turn of segment.turns) {
      const id = turnId(turn);
      if (seen.has(id)) continue;
      seen.add(id);
      turns.push(turn);
    }
  }
  turns.sort((a, b) => a.at.localeCompare(b.at));
  return { agent: group.agent, id: group.id, turns };
}

/**
 * Two sessions that share an exact turn are one conversation.
 *
 * Claude Code resumes a session by copying its parent's transcript under a new id, so the two overlap almost
 * entirely — but not quite: the parent can hold a turn the resume dropped, such as an instruction abandoned
 * mid-keystroke and retyped. Dropping the parent loses that turn; keeping both records the conversation twice.
 * Merging does neither.
 *
 * Turn timestamps are millisecond-precise, so a single shared `(at, role, text)` is conclusive rather than
 * suggestive — unrelated conversations do not collide on one.
 */
function mergeOverlapping(sessions) {
  const ids = sessions.map((s) => new Set(s.turns.map(turnId)));
  const parent = sessions.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving, so a long resume chain stays cheap
      i = parent[i];
    }
    return i;
  };

  for (let i = 0; i < sessions.length; i += 1) {
    for (let j = i + 1; j < sessions.length; j += 1) {
      if (sessions[i].agent !== sessions[j].agent) continue;
      if (find(i) === find(j)) continue;
      for (const id of ids[i]) {
        if (ids[j].has(id)) {
          parent[find(i)] = find(j);
          break;
        }
      }
    }
  }

  const clusters = new Map();
  sessions.forEach((session, i) => {
    const root = find(i);
    const cluster = clusters.get(root) ?? [];
    cluster.push(session);
    clusters.set(root, cluster);
  });

  return [...clusters.values()].map((cluster) => {
    if (cluster.length === 1) return cluster[0];
    const seen = new Set();
    const turns = [];
    for (const session of cluster) {
      for (const turn of session.turns) {
        const id = turnId(turn);
        if (seen.has(id)) continue;
        seen.add(id);
        turns.push(turn);
      }
    }
    turns.sort((a, b) => a.at.localeCompare(b.at));
    // Name the merged conversation after its fullest segment — the one that holds most of the arc.
    const primary = [...cluster].sort(
      (a, b) => b.turns.length - a.turns.length || a.id.localeCompare(b.id),
    )[0];
    return {
      agent: primary.agent,
      id: primary.id,
      turns,
      mergedFrom: cluster.length,
      // Every transcript this conversation was assembled from, so the reminder knows they are all accounted for.
      covers: cluster.map((c) => `${c.agent}-${c.id}`).sort(),
    };
  });
}

// The early history of this repo was rewritten, so committer dates are wrong for it and only the author date says
// when work happened. `git log --since` filters on the committer date, so the log is read once and windowed here.
const LOG = execFileSync(
  "git",
  ["log", "--format=%h%x09%aI%x09%s", "--reverse"],
  { cwd: repo, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, authored, ...rest] = line.split("\t");
    return { sha, at: Date.parse(authored), subject: rest.join("\t") };
  });

const commitsIn = (from, to) =>
  LOG.filter((c) => c.at >= Date.parse(from) && c.at <= Date.parse(to)).map(
    (c) => [c.sha, c.subject],
  );

const keyOf = (session) => `${session.agent}-${session.id}`;
const fileOf = (session, first) =>
  `${day(first)}-${session.agent}-${session.id}.md`;

async function capture(session, cache) {
  if (!session.turns.length) return null;

  const key = keyOf(session);
  const entry = cache[key] ?? {};
  const first = session.turns[0].at;
  const file = fileOf(session, first);

  const body = renderCapture({
    ...session,
    title: entry.title,
    note: entry.note,
    commits: commitsIn(first, session.turns.at(-1).at),
  });

  const screened = screen(body, {
    secrets,
    allow: config.allow ?? [],
    redact: config.redact ?? {},
  });
  const common = {
    key,
    file,
    date: day(first),
    agent: session.agent,
    turns: session.turns.length,
  };
  if (screened.findings.length)
    return {
      ...common,
      blocked: screened.findings,
      redacted: screened.redacted,
    };

  if (!dryRun) {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, file), screened.text);
  }
  return {
    ...common,
    titled: Boolean(entry.title),
    redacted: screened.redacted,
  };
}

/** Rebuild the index from whatever captures are on disk, so it can never disagree with the directory. */
async function buildIndex(cache) {
  let files;
  try {
    files = (await readdir(outDir)).filter(
      (f) => f.endsWith(".md") && f !== "README.md",
    );
  } catch {
    return []; // nothing captured yet
  }
  const entries = files.sort().map((file) => {
    const [date, agent, rest] = [
      file.slice(0, 10),
      file.slice(11).split("-")[0],
      file,
    ];
    const key = `${agent}-${rest.replace(`${date}-${agent}-`, "").replace(/\.md$/, "")}`;
    return {
      date,
      agent,
      file,
      key,
      title: cache[key]?.title,
      note: cache[key]?.note,
    };
  });
  if (!dryRun) await writeFile(join(outDir, "README.md"), renderIndex(entries));
  return entries;
}

const cache = await titles(repo);
const secrets = await knownSecrets(repo);

if (flag("--retitle")) {
  // Clearing a cached title is what makes it get written again. A hand-corrected entry is pinned and survives.
  const only = value("--retitle");
  let cleared = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (only && !key.endsWith(only)) continue;
    if (entry.pinned) continue;
    delete entry.title;
    delete entry.note;
    cleared += 1;
  }
  if (!dryRun) await writeTitles(repo, cache);
  console.log(`cleared ${cleared} cached title${cleared === 1 ? "" : "s"}`);
}

const sessions = await allSessions();
let targets;
if (flag("--backfill")) {
  targets = sessions;
} else if (value("--session")) {
  targets = sessions.filter((s) => s.id === value("--session"));
  if (!targets.length) {
    console.error(`no session ${value("--session")} for this repo`);
    process.exit(1);
  }
} else if (flag("--index") || flag("--retitle")) {
  targets = [];
} else {
  // The live session is the most recently touched transcript. Two within a minute of each other is ambiguous, and
  // capturing the wrong conversation silently is worse than refusing.
  const newest = sessions.at(-1);
  if (!newest) {
    console.error("no agent sessions found for this repo");
    process.exit(1);
  }
  const rivals = sessions.filter(
    (s) => Math.abs(s.mtimeMs - newest.mtimeMs) < 60_000,
  );
  if (rivals.length > 1) {
    console.error(
      "more than one session was active in the last minute — name one with --session:",
    );
    for (const r of rivals) console.error(`  ${r.agent}-${r.id}`);
    process.exit(1);
  }
  targets = [newest];
}

const read_all = [];
for (const group of targets) read_all.push(await read(group));

const merged = mergeOverlapping(read_all);
const results = [];
for (const session of merged) {
  const result = await capture(session, cache);
  if (result) results.push({ ...result, mergedFrom: session.mergedFrom });
}
const written = results.filter((r) => !r.blocked);
const blocked = results.filter((r) => r.blocked);

const indexed = await buildIndex(cache);

for (const w of written)
  console.log(
    `${dryRun ? "would write" : "wrote"} ${w.file} — ${w.turns} turns`,
  );
for (const w of written.filter((w) => w.mergedFrom)) {
  console.log(
    `  ${w.file} merges ${w.mergedFrom} transcripts of one conversation`,
  );
}
if (indexed.length)
  console.log(
    `${dryRun ? "would index" : "indexed"} ${indexed.length} capture${indexed.length === 1 ? "" : "s"}`,
  );

// The script never invents a title. A mechanical one built from the first prompt would be worse than none, and
// because a cached title is not regenerated it would poison the cache permanently.
const redacted = [...new Set(written.flatMap((w) => w.redacted ?? []))];
if (redacted.length) console.log(`redacted throughout: ${redacted.join(", ")}`);

if (blocked.length) {
  console.error(
    `\n${blocked.length} capture${blocked.length === 1 ? " was" : "s were"} NOT written — screening found:`,
  );
  for (const b of blocked) {
    console.error(`  ${b.file}`);
    for (const f of b.blocked)
      console.error(`      ${f.name} ×${f.count}  (first: ${f.sample})`);
  }
  console.error(
    "\nRead the finding. If it is a secret, remove it at the source; if it is harmless, add the exact",
  );
  console.error(
    'string to "allow" in .agents/capture.json and run again. Nothing was written for these sessions.',
  );
}

const untitled = indexed.filter((e) => !e.title);
if (untitled.length) {
  console.log(
    `\n${untitled.length} capture${untitled.length === 1 ? " needs" : "s need"} a title and note:`,
  );
  for (const e of untitled) console.log(`  ${e.key}  ${e.file}`);
  console.log(
    "\nRead each capture, then add { title, note } under its key in .agents/capture-sessions.json",
  );
  console.log("and re-run with --index.");
}

if (blocked.length) process.exit(1);
