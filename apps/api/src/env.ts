import type { RegistryDO } from "./do/registry";
import type { RegistryUser } from "./do/registry/types";
import type { UserDO } from "./do/user";

export type Env = Cloudflare.Env;

/** The per-request variables `middleware/user.ts` sets: who is asking, and the two DO stubs. */
type Variables = {
  identity: RegistryUser;
  registry: DurableObjectStub<RegistryDO>;
  user: DurableObjectStub<UserDO>;
};

/**
 * Hono generic for a route behind `requireIdentity`: bindings plus all three variables. There is
 * always a caller, so a handler reads `c.var.identity.userId` without asking.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};

/**
 * Hono generic for a route behind `optionalIdentity` — the five public reads
 * (docs/specs/route-visibility.md §4.1). The Registry is always there; `identity` and `user` are
 * there only when a session was presented, so the compiler makes every public handler say what it
 * does without a caller.
 *
 * Deliberately a second type rather than loosening `AppEnv`: the ~30 guarded handlers mean
 * `identity` when they say it, and a route cannot become anonymous by accident — it has to be
 * written against this one on purpose.
 */
export type PublicEnv = {
  Bindings: Env;
  Variables: Partial<Variables> & Pick<Variables, "registry">;
};
