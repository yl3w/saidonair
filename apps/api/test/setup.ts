import {
  abortAllDurableObjects,
  listDurableObjectIds,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll } from "vitest";
import schema from "../migrations/auth/0001_better_auth.sql";
import { registryMigrations } from "../migrations/registry";
import { userMigrations } from "../migrations/user";
import { applyMigrations } from "../src/do/migrations";
import { getRegistry } from "../src/do/registry";
import { seedOwner } from "../src/do/registry/users";
import { resetAiFake } from "../src/lib/ai";
import { normalizeEmail } from "../src/lib/email";
import { resetVectorFake } from "../src/lib/vectorize";
import { resetWorkflowFake } from "../src/lib/workflows";

// better-auth's tables, once per test isolate. D1 is not a Durable Object, so `applyMigrations`
// does not reach it and the pool does not create them: without this every authenticated request
// fails with a schema mismatch rather than a 401. Applied statement by statement because D1's
// `exec` cannot take the file's comments.
beforeAll(async () => {
  const statements = schema
    .split("\n")
    .filter((line) => !line.startsWith("--") && line.trim().length > 0)
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await env.AUTH_DB.prepare(
      statement.replace(/^create (table|index) "/, 'create $1 if not exists "'),
    ).run();
  }
});

// Every test starts from an empty Registry and no User DOs. The pool's `reset()` does not clear
// these SQLite-backed DOs in the pinned version, so wipe them explicitly. This touches
// test-process storage only; AGENTS.md hard rule 4 still forbids anything like it against dev or
// deployed state.
//
// **The wipe rebuilds what the constructor builds, rather than trusting the abort to.** Each of
// these objects applies its migrations — and the Registry seeds the owner — once, in a
// constructor, under `blockConcurrencyWhile`. `deleteAll()` takes the tables away but cannot make
// a live instance forget it already ran: the object goes on believing it is migrated while its
// storage is empty, and anything reaching it in that state fails with `no such table:
// global_users`. That was an intermittent failure until 2026-09-22, because whether anything
// reached it depended on how a stub outlived the test that made it.
//
// `abortAllDurableObjects()` below is what was supposed to prevent it, and mostly did. But it is
// a race to rely on: it settles *after* the wipe, and nothing stops a surviving stub from
// routing to the old instance first. So the wipe now leaves storage exactly as a fresh
// constructor would leave it, and the abort is an optimisation — a clean instance per test —
// rather than the thing correctness rests on. Both are kept; only one of them has to win.
afterEach(async () => {
  await runInDurableObject(getRegistry(env), async (_, state) => {
    await state.storage.deleteAll();
    applyMigrations(state.storage, registryMigrations);
    const email = normalizeEmail(env.OWNER_EMAIL);
    if (email) seedOwner(state.storage.sql, email, Date.now());
  });
  for (const id of await listDurableObjectIds(env.USER_DO)) {
    await runInDurableObject(env.USER_DO.get(id), async (_, state) => {
      await state.storage.deleteAll();
      applyMigrations(state.storage, userMigrations);
    });
  }
  await abortAllDurableObjects();
  // The fakes keep module-level state for the isolate; every test starts with an empty store.
  resetVectorFake();
  resetAiFake();
  resetWorkflowFake();
});
