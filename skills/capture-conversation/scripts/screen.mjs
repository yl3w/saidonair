#!/usr/bin/env node
// Screen a capture for things that must not enter a repository.
//
// Two kinds of result, and the difference matters:
//
//   Redactions are certain, so they are applied silently. A value read out of this machine's own .dev.vars is a
//   secret by definition; there is nothing for a human to decide.
//
//   Findings are suspicions, so they stop the write. A token-shaped string might be a credential or might be a
//   commit hash, and guessing either way is worse than asking.
//
// Run directly to check a file:  node screen.mjs <file>

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** Directories never worth walking for env files. */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".wrangler",
  ".turbo",
  "dist",
  "coverage",
  ".pnpm-store",
]);

// `.example` and `.sample` files are templates: committed on purpose, with placeholder values. Matching them blocks
// captures over strings that are already public in the repo — a false positive with nothing gained.
const isEnvFile = (name) =>
  (name === ".dev.vars" ||
    name.startsWith(".dev.vars.") ||
    name.startsWith(".env")) &&
  !/\.(example|sample|template)$/.test(name);

/** Every env file in the workspace — this repo keeps its at apps/api/.dev.vars, not the root. */
async function envFiles(dir, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) await envFiles(join(dir, entry.name), found);
    } else if (isEnvFile(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * The real secrets on a developer's machine are already enumerated in their env files. Matching the actual values
 * catches a pasted key that no generic pattern would recognise.
 */
export async function knownSecrets(repo) {
  const secrets = [];
  for (const file of await envFiles(repo)) {
    let body;
    try {
      body = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of body.split("\n")) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
      );
      if (!match) continue;
      const key = match[1];
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      // A short or all-numeric value is not a secret worth matching: PORT=3000 would redact every "3000".
      if (value.length < 8 || /^\d+$/.test(value)) continue;
      secrets.push({ key, value, from: basename(file) });
    }
  }
  return secrets;
}

/** Certain. Applied without asking. */
const REDACTIONS = [
  {
    // `git@github.com:user/repo.git` is an SSH remote, not an address. The trailing `(?![:\w])` leaves those alone;
    // without it a capture records "<email>:user/repo.git", which is simply a wrong record of what was said.
    name: "email address",
    re: /\b[\w.+-]+@[\w-]+\.[\w.-]*[\w-](?![:\w])/g,
    with: "<email>",
  },
];

/** Suspicious. Stops the write so a person decides. */
const FINDINGS = [
  { name: "bearer token", re: /\bBearer\s+(?!YOUR_|<|\$)[\w.-]{16,}/gi },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google API key", re: /\bAIza[\w-]{35}\b/g },
  {
    name: "GitHub token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
  },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // 32 hex is the shape of a Cloudflare account id — the one the 2026-09-18 export leaked past every pattern.
  // It is also the shape of an md5, so this asks rather than assumes.
  { name: "32-character hex id", re: /\b[0-9a-f]{32}\b/g },
];

/**
 * Returns the redacted text and anything that needs a decision. Findings never carry the matched value itself —
 * reporting a secret to prove it is a secret defeats the point.
 *
 * A value from an env file is redacted *and* reported as a finding. Redacting it silently would keep it out of the
 * repo but would also hide from the developer that a live credential had been pasted into a conversation, which is
 * a thing to act on rather than to tidy away. Naming the key in `allow` means "yes, redact that one and continue";
 * the raw value never reaches disk on either path.
 */
export function screen(text, { secrets = [], allow = [], redact = {} } = {}) {
  let out = text;
  const redacted = [];
  const findings = [];

  for (const secret of secrets) {
    if (!out.includes(secret.value)) continue;
    out = out.replaceAll(secret.value, `<redacted: ${secret.key}>`);
    redacted.push(`${secret.key} (${secret.from})`);
    // A value one of the certain redactions already neutralises — an email address, say — needs no decision: it is
    // gone either way, and blocking would refuse every capture that mentions the owner's own address.
    const alreadyCertain = REDACTIONS.some((rule) => {
      rule.re.lastIndex = 0;
      return rule.re.test(secret.value);
    });
    if (!alreadyCertain && !allow.includes(secret.key)) {
      findings.push({
        name: `value of ${secret.key}, from ${secret.from}`,
        count: 1,
        sample: "<redacted>",
      });
    }
  }
  // Strings this repository has declared should always be scrubbed. This is the third option between blocking a
  // capture forever and committing something you would rather not: name it, replace it, move on.
  for (const [value, replacement] of Object.entries(redact)) {
    if (!out.includes(value)) continue;
    out = out.replaceAll(value, replacement);
    redacted.push(`configured: ${replacement}`);
  }

  for (const rule of REDACTIONS) {
    if (!rule.re.test(out)) continue;
    rule.re.lastIndex = 0;
    out = out.replaceAll(rule.re, rule.with);
    redacted.push(rule.name);
  }

  for (const rule of FINDINGS) {
    rule.re.lastIndex = 0;
    const hits = [...out.matchAll(rule.re)]
      .map((m) => m[0])
      .filter((hit) => !allow.includes(hit));
    if (hits.length)
      findings.push({ name: rule.name, count: hits.length, sample: hits[0] });
  }

  return { text: out, redacted: [...new Set(redacted)], findings };
}

// CLI: screen one file and report. Writes nothing.
if (process.argv[1]?.endsWith("screen.mjs")) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node screen.mjs <file>");
    process.exit(2);
  }
  const repo = process.cwd();
  const result = screen(await readFile(file, "utf8"), {
    secrets: await knownSecrets(repo),
  });
  for (const r of result.redacted) console.log(`redacted: ${r}`);
  for (const f of result.findings)
    console.log(`FINDING: ${f.name} ×${f.count} (first: ${f.sample})`);
  process.exit(result.findings.length ? 1 : 0);
}
