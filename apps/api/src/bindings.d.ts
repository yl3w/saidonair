// Bindings from wrangler.jsonc plus secrets from .dev.vars / `wrangler secret`.
// Hand-maintained rather than `wrangler types` output so no generated file is committed.
declare namespace Cloudflare {
  interface Env {
    REGISTRY_DO: DurableObjectNamespace<import("./do/registry").RegistryDO>;
    USER_DO: DurableObjectNamespace<import("./do/user").UserDO>;
    /** Workers AI, `remote: true` in every environment; `lib/ai.ts` is the only caller. */
    AI: Ai;
    /**
     * The Vectorize index of this environment (`media-rag`, `-staging`, `-dev`), `remote: true`;
     * `lib/vectorize.ts` is the only caller and enforces the `shared-catalog` namespace (hard rule 3).
     */
    VECTORS: Vectorize;
    /**
     * Secret, never a `vars` entry. Normalized and seeded as the `owner` role each time the
     * Registry DO starts; absent or malformed means no owner is seeded (logged as a warning).
     */
    OWNER_EMAIL?: string;
    /**
     * Secret, never a `vars` entry: the DownSub API key (AGENTS.md → One-time setup). Read by
     * `lib/transcripts/status.ts` for the catalog's provider health and, in M3, by the transcript
     * adapter and pre-flight. Absent means the provider reads as `unreachable` and nothing is called;
     * vitest.config.ts pins it empty so no test reaches DownSub.
     */
    DOWNSUB_API_KEY?: string;
    /**
     * `vars` in wrangler.jsonc, overridable in `.dev.vars`: comma-separated browser origins allowed
     * by CORS; `scheme://*.host` matches any subdomain (Pages previews). Unset means the local Vite
     * origins (lib/cors.ts).
     */
    WEB_ORIGINS?: string;
    /**
     * Test only (vitest.config.ts): JSON of channel id → canned feed title, or null for "no such
     * channel", served by `lib/youtube/rss.ts` feedFetcher instead of fetching YouTube. Never set
     * in `.dev.vars` or deployed.
     */
    YOUTUBE_FEEDS_FAKE?: string;
    /**
     * Test only (vitest.config.ts): JSON `{ status?, videos }` of the transcript provider's health
     * and a canned `TranscriptResult` or `{ failure }` per video id, served by
     * `lib/transcripts/index.ts` instead of calling DownSub (test/fixtures/transcripts.ts). Never
     * set in `.dev.vars` or deployed.
     */
    TRANSCRIPTS_FAKE?: string;
    /**
     * Test only (vitest.config.ts): JSON options for the deterministic Workers AI fake in
     * `lib/ai.ts` (`{}` for defaults). Never set in `.dev.vars` or deployed.
     */
    AI_FAKE?: string;
    /**
     * Test only (vitest.config.ts): JSON options for the in-memory vector store in
     * `lib/vectorize.ts` (`{ visibilityDelayReads?, throwOn? }`; `{}` for defaults). Never set in
     * `.dev.vars` or deployed.
     */
    VECTORIZE_FAKE?: string;
  }
}
