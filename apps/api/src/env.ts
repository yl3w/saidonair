import type { RegistryDO } from "./do/registry";
import type { RegistryUser } from "./do/registry/types";
import type { UserDO } from "./do/user";

export type Env = Cloudflare.Env;

/**
 * Hono generic for this Worker: bindings plus the per-request variables set by
 * `middleware/user.ts`: the caller's Registry identity, the Registry stub, and the caller's own
 * per-user DO stub.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    identity: RegistryUser;
    registry: DurableObjectStub<RegistryDO>;
    user: DurableObjectStub<UserDO>;
  };
};
