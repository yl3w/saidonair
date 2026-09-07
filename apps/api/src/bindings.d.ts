// Bindings from wrangler.jsonc plus secrets from .dev.vars / `wrangler secret`.
// Hand-maintained rather than `wrangler types` output so no generated file is committed.
declare namespace Cloudflare {
  interface Env {
    REGISTRY_DO: DurableObjectNamespace<import("./do/registry").RegistryDO>;
    /**
     * Secret, never a `vars` entry. Normalized and seeded as the `owner` role each time the
     * Registry DO starts; absent or malformed means no owner is seeded (logged as a warning).
     */
    OWNER_EMAIL?: string;
  }
}
