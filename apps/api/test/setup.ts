import {
  abortAllDurableObjects,
  listDurableObjectIds,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach } from "vitest";
import { getRegistry } from "../src/do/registry";
import { resetAiFake } from "../src/lib/ai";
import { resetVectorFake } from "../src/lib/vectorize";
import { resetWorkflowFake } from "../src/lib/workflows";

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
