/**
 * The web Worker (docs/specs/public-reading.md §4.4). A request whose path matches a built file is
 * answered by the assets binding before this runs at all — that is where `/assets/index-*.js` and
 * the fonts go, free and without an invocation. Everything else arrives here.
 *
 * Until step 8 of `public-reading-plan.md` it has nothing to add, so it hands every request straight
 * back: `not_found_handling: "single-page-application"` turns an unknown path into `index.html`,
 * which is exactly what Pages did for us. The point of this step is the hosting move, not behaviour.
 *
 * The globals here are workerd's, from `tsconfig.worker.json` — there is no `window` in this file's
 * world, which is the seam that keeps browser code out of the server bundle.
 */
export interface Env {
  /** The built client, served from the edge. */
  ASSETS: Fetcher;
  /**
   * The API Worker, in-process: no DNS, no TLS, no public hop, no CORS. Unused until step 8 renders
   * pages here; declared now so the binding is proven in local dev before anything depends on it.
   */
  API: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
