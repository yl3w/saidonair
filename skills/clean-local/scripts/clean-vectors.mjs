#!/usr/bin/env node
/**
 * Clears every vector from the dev Vectorize index. Bundled with the `clean-local` skill (see ../SKILL.md);
 * `clean-local.sh` is the only thing that should invoke it, and only for `--include-vectors`.
 *
 * Usage: node clean-vectors.mjs --repo-root <path> [--yes]
 *   (no --yes)  dry run: enumerate and report, delete nothing
 *   --yes       delete every vector in the index
 * Exit: 0 done or nothing to do, 2 usage, 5 a wrangler call failed, 6 auth missing.
 *
 * Why enumerate-and-delete rather than `wrangler vectorize delete`:
 *   - AGENTS.md hard rule 4 forbids `wrangler vectorize delete`, and this keeps that ban intact.
 *   - Deleting the index would drop the `channelId` and `videoId` metadata indexes with it. AGENTS.md
 *     requires those to exist BEFORE the first upsert, and a vector inserted without them is silently
 *     unfilterable forever. Deleting vectors by id leaves the index and both metadata indexes alone.
 *
 * Namespaces (hard rule 3): `list-vectors` returns ids only and `delete-vectors` takes no namespace, so this
 * is an index-wide wipe. That is namespace-scoped in substance because `lib/vectorize.ts` writes exactly one
 * namespace, `shared-catalog`; `test/vectorize.test.ts` fails if a second one is ever introduced.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The dev index, hard-coded on purpose: no argument reaches it, so no input can redirect the wipe at a
 * deployed index. `test/wrangler-config.test.ts` fails if this drifts from `env.dev`'s `index_name` in
 * apps/api/wrangler.jsonc, or if a deployed index name appears anywhere in this file — including inside a
 * comment, which is why the deployed names are described here and never spelled.
 */
const INDEX = "media-rag-dev";

/** One `list-vectors` page. The API caps `--count` at 1000. */
const PAGE_SIZE = 1000;
/**
 * Ids per `delete-vectors` call. The Vectorize API caps this hard: 100 is accepted, 101 answers
 * `too many ids in payload; max id count is 100 [code: 40007]` (probed against the dev index 2026-09-14).
 */
const BATCH_SIZE = 100;
/** The Vectorize API returns an occasional 504 under no particular load, so every call is retried. */
const ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [2_000, 5_000];
/** Vectorize mutations are async; this repo has measured 10-80 s for a write to become readable. */
const VERIFY_TIMEOUT_MS = 120_000;
const VERIFY_INTERVAL_MS = 5_000;

function usage() {
  return "Usage: node clean-vectors.mjs --repo-root <path> [--yes]";
}

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

let repoRoot = "";
let yes = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--yes") yes = true;
  else if (arg === "--repo-root") repoRoot = process.argv[++i] ?? "";
  else fail(2, `unknown flag: ${arg}\n\n${usage()}`);
}
if (!repoRoot) fail(2, `--repo-root is required\n\n${usage()}`);

const apiDir = path.join(repoRoot, "apps", "api");

/**
 * The repo's pinned wrangler, never a global one. It is a devDependency of apps/api, so the workspace bin is
 * the direct path; the pnpm fallback covers a store layout that does not link it there.
 */
const localBin = path.join(apiDir, "node_modules", ".bin", "wrangler");
const wrangler = existsSync(localBin)
  ? { file: localBin, prefix: [] }
  : { file: "pnpm", prefix: ["--filter", "@media-digest/api", "exec", "wrangler"] };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs wrangler, capturing stdout. The version banner goes to stderr, so stdout is clean JSON.
 * Retried because the Vectorize API answers an intermittent 504 Gateway Timeout that succeeds on a repeat;
 * a single attempt turns that blip into a half-finished wipe.
 */
async function run(args, { allowFailure = false, attempts = ATTEMPTS } = {}) {
  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { stdout } = await execFileAsync(wrangler.file, [...wrangler.prefix, ...args], {
        cwd: apiDir,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
      return { ok: true, stdout };
    } catch (error) {
      last = String(error.stderr ?? error.message);
      if (attempt < attempts) {
        process.stderr.write(`  wrangler ${args[1] ?? args[0]} failed, retrying (${attempt}/${attempts - 1})\n`);
        await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 5_000);
      }
    }
  }
  if (allowFailure) return { ok: false, stdout: "", stderr: last };
  return fail(5, `wrangler ${args.join(" ")} failed after ${attempts} attempts:\n${last.trim()}`);
}

async function runJson(args) {
  const { stdout } = await run(args);
  try {
    return JSON.parse(stdout);
  } catch {
    return fail(5, `wrangler ${args.join(" ")} did not return JSON:\n${stdout.slice(0, 400)}`);
  }
}

/** Refuses early rather than letting a wrangler call open a browser login inside a tool call. */
async function requireAuth() {
  const result = await run(["whoami"], { allowFailure: true, attempts: 1 });
  const text = `${result.stdout}${result.stderr ?? ""}`;
  if (!result.ok || /not authenticated/i.test(text)) {
    fail(6, "refusing: wrangler is not authenticated. Run `wrangler login` first, then ask again.");
  }
}

/** `vectorCount` trails `processedUpToMutation`, so it is reported, never trusted as the truth. */
async function reportedCount() {
  const info = await runJson(["vectorize", "info", INDEX, "--json"]);
  return Number(info.vectorCount ?? 0);
}

/**
 * Every id in the index. The cursor expires (`cursorExpirationTimestamp`), so a walk that outlives it
 * restarts from the beginning rather than reporting a partial index as complete.
 */
async function listAllIds() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ids = [];
    let cursor;
    let expired = false;
    for (;;) {
      const args = ["vectorize", "list-vectors", INDEX, "--count", String(PAGE_SIZE), "--json"];
      if (cursor) args.push("--cursor", cursor);
      const page = await runJson(args);
      for (const vector of page.vectors ?? []) if (vector?.id) ids.push(vector.id);
      if (!page.isTruncated || !page.nextCursor) return ids;
      const expiry = Date.parse(page.cursorExpirationTimestamp ?? "");
      if (Number.isFinite(expiry) && expiry <= Date.now()) {
        expired = true;
        break;
      }
      cursor = page.nextCursor;
    }
    if (!expired) return ids;
    process.stderr.write("  cursor expired mid-walk; restarting the enumeration\n");
  }
  return fail(5, "gave up: the list-vectors cursor expired twice. Nothing was deleted.");
}

async function deleteIds(ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const args = ["vectorize", "delete-vectors", INDEX, "--ids", ...batch];
    const result = await run(args, { allowFailure: true });
    if (!result.ok) {
      process.stderr.write(`${result.stderr ?? ""}\n`);
      fail(5, `stopped after ${deleted} of ${ids.length} vectors: a delete batch failed ${ATTEMPTS} times.`);
    }
    deleted += batch.length;
    process.stdout.write(`  deleted ${deleted}/${ids.length}\n`);
  }
  return deleted;
}

/** Polls until the index reports empty. A non-zero tail is reported as a warning, never as success. */
async function verifyEmpty() {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let count = await reportedCount();
  while (count > 0 && Date.now() < deadline) {
    await sleep(VERIFY_INTERVAL_MS);
    count = await reportedCount();
  }
  return count;
}

await requireAuth();

const reported = await reportedCount();
const ids = await listAllIds();

if (ids.length === 0) {
  process.stdout.write(`Nothing to delete: ${INDEX} holds no vectors (index reports ${reported}).\n`);
  process.exit(0);
}

const drift = reported === ids.length ? "" : ` (the index reports ${reported}; writes are applied asynchronously)`;

if (!yes) {
  process.stdout.write(`  ${INDEX} on Cloudflare  (${ids.length} vectors)${drift}\n`);
  process.exit(0);
}

process.stdout.write(`Deleting ${ids.length} vectors from ${INDEX}${drift}:\n`);
await deleteIds(ids);

process.stdout.write("Waiting for Vectorize to apply the deletes (asynchronous, 10-80 s is normal)...\n");
const remaining = await verifyEmpty();
if (remaining > 0) {
  process.stdout.write(
    `\nWarning: ${INDEX} still reports ${remaining} vectors after ${VERIFY_TIMEOUT_MS / 1000} s.\n` +
      "Vectorize applies deletes asynchronously, so this is usually just lag. Check again with:\n" +
      `  wrangler vectorize info ${INDEX}\n`,
  );
} else {
  process.stdout.write(`${INDEX} is empty.\n`);
}

// The index and its metadata indexes are deliberately untouched; print them as proof.
const metadata = await run(["vectorize", "list-metadata-index", INDEX], { allowFailure: true });
if (metadata.ok) {
  process.stdout.write(`\nMetadata indexes kept on ${INDEX}:\n${metadata.stdout.trim()}\n`);
}
