import {
  abortAllDurableObjects,
  listDurableObjectIds,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll } from "vitest";
import schema from "../migrations/auth/0001_better_auth.sql";
import { getRegistry } from "../src/do/registry";
import { resetAiFake } from "../src/lib/ai";
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

// Every test starts from an empty Registry and no User DOs. The pool's `reset()` does not clear this
// SQLite-backed DO in the pinned version, so wipe it explicitly, then abort the instance so
// its constructor (migrations + owner seed) runs again. This touches test-process storage
// only; AGENTS.md hard rule 4 still forbids anything like it against dev or deployed state.
afterEach(async () => {
  await runInDurableObject(getRegistry(env), (_, state) =>
    state.storage.deleteAll(),
  );
  for (const id of await listDurableObjectIds(env.USER_DO)) {
    await runInDurableObject(env.USER_DO.get(id), (_, state) =>
      state.storage.deleteAll(),
    );
  }
  await abortAllDurableObjects();
  // The fakes keep module-level state for the isolate; every test starts with an empty store.
  resetVectorFake();
  resetAiFake();
  resetWorkflowFake();
});
