// Bindings from wrangler.jsonc plus secrets from .dev.vars / `wrangler secret`.
// Hand-maintained rather than `wrangler types` output so no generated file is committed.
declare namespace Cloudflare {
  interface Env {
    REGISTRY_DO: DurableObjectNamespace<import("./do/registry").RegistryDO>;
    USER_DO: DurableObjectNamespace<import("./do/user").UserDO>;
    /**
     * Secret, never a `vars` entry. Normalized and seeded as the `owner` role each time the
     * Registry DO starts; absent or malformed means no owner is seeded (logged as a warning).
     */
    OWNER_EMAIL?: string;
    /**
     * Test only (vitest.config.ts): JSON of channel id → canned feed title, or null for "no such
     * channel", served by `lib/youtube/rss.ts` feedFetcher instead of fetching YouTube. Never set
     * in `.dev.vars` or deployed.
     */
    YOUTUBE_FEEDS_FAKE?: string;
  }
}
