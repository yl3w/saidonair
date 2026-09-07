import type { RegistryDO } from "./do/registry";
import type { RegistryUser } from "./do/registry/types";

export type Env = Cloudflare.Env;

/**
 * Hono generic for this Worker: bindings plus the per-request variables set by
 * `middleware/user.ts`. `user` (the per-user DO stub) joins `Variables` once the User DO exists.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    identity: RegistryUser;
    registry: DurableObjectStub<RegistryDO>;
  };
};
