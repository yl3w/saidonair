import { LocationProvider } from "preact-iso";
import { locationStub } from "preact-iso/prerender";
import { renderToString } from "preact-render-to-string";
import { App } from "../app";
import { Bootstrap, type BootstrapData } from "../lib/bootstrap";
import { matchPublicRoute } from "../lib/public-routes";
import { robots, sitemap } from "./crawl";
import { DEFAULT_HEAD, type Head, headFor, headTags } from "./head";
import { type Bootstrapped, load } from "./load";

/**
 * The web Worker (docs/specs/public-reading.md §4.4). A request whose path matches a built file is
 * answered by the assets binding before this runs at all — that is where `/assets/index-*.js` and
 * the fonts go, free and without an invocation. Everything else arrives here.
 *
 * Its one decision is `matchPublicRoute`. A public route is rendered; anything else — a guarded
 * screen, an unknown path — is handed back to the assets binding, which answers `index.html` and
 * lets the SPA route it. The session lives in `localStorage` and cannot be read here, so a guarded
 * screen has nobody to render for; that is the same seam, not a second one.
 */
export interface Env {
  /** The built client, served from the edge. */
  ASSETS: Fetcher;
  /** The API Worker, in-process: no DNS, no TLS, no public hop, no CORS. */
  API: Fetcher;
}

/**
 * An anonymous render is identical for everyone, so the edge may hold it. This is also the answer
 * to "there is no rate limiting anywhere" (`route-visibility.md` §5): a crawler sweeping the
 * archive mostly meets cache rather than a Durable Object.
 */
const CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only a page load can be rendered; anything else belongs to assets, which answers or 405s.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }

    // What a crawler asks for before anything else. Served from here, not `public/`, because both
    // carry the origin they are served from and there are three of those (src/server/crawl.ts).
    if (url.pathname === "/robots.txt") {
      return new Response(robots(url.origin), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(await sitemap(url.origin, env.API), {
        headers: {
          "content-type": "application/xml; charset=utf-8",
          // One call per channel to build (crawl.ts), so it is cached harder than a page: a
          // crawler re-reading it every few minutes should not cost the catalog each time.
          "cache-control": "public, max-age=600, s-maxage=3600",
        },
      });
    }

    const route = matchPublicRoute(url.pathname);
    if (route === null) return env.ASSETS.fetch(request);

    // Read the built shell rather than hardcoding it: Vite hashes the script and stylesheet names
    // on every build, and this way the tags are always the ones that exist.
    const shell = await env.ASSETS.fetch(
      new Request(new URL("/index.html", url).toString()),
    ).then((response) => response.text());

    const result = await load(route, env.API);

    if (result.kind === "unavailable") {
      // The API is down or broke. Serve the shell unrendered and uncached: the SPA boots, calls
      // the API itself, and shows the retry every screen already has. A 500 here would turn a
      // failure the client survives into a dead page — and a cached one at that.
      return page(shell, {
        markup: "",
        data: null,
        head: DEFAULT_HEAD,
        status: 200,
        cache: "no-store",
      });
    }

    if (result.kind === "missing") {
      // A real 404, with a rendered body. The SPA fallback cannot do this: it answers 200 with the
      // shell for every unknown path, which tells a crawler a deleted episode still exists.
      return page(shell, {
        markup: renderAt(url, null),
        data: null,
        head: DEFAULT_HEAD,
        status: 404,
        cache: "public, max-age=60",
      });
    }

    const data = bootstrap(result.data);
    return page(shell, {
      markup: renderAt(url, data),
      data,
      head: headFor(result.data, url.origin),
      status: 200,
      cache: CACHE,
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * The same tree the browser will hydrate. `LocationProvider` takes the URL explicitly — there is
 * no `window.location` here — and `Bootstrap` carries what was loaded, so the screens render their
 * content rather than their skeletons.
 */
function renderAt(url: URL, data: BootstrapData | null): string {
  // `LocationProvider` reads `location.pathname + location.search`, and workerd has no `location`.
  // `locationStub` is preact-iso's own answer: it puts a parsed URL on `globalThis`.
  //
  // A global mutated per request is a race in any runtime where two requests interleave — but
  // `renderToString` is synchronous and there is no `await` between these two lines, so nothing
  // can run in between. That is the whole reason this is not `renderToStringAsync`.
  locationStub(url.pathname + url.search);
  return renderToString(
    <LocationProvider>
      <Bootstrap value={data}>
        <App />
      </Bootstrap>
    </LocationProvider>,
  );
}

/** The screens' own keys, which is the one thing this module has to agree with them about. */
function bootstrap(data: Bootstrapped): BootstrapData {
  switch (data.route) {
    case "landing":
      return { landing: { channels: data.channels } };
    case "channel":
      return {
        [`channel:${data.channel.channelId}`]: { channel: data.channel },
        [`episodes:${data.channel.channelId}`]: { episodes: data.episodes },
      };
    case "episode":
      return {
        [`episode:${data.episode.episodeId}`]: { episode: data.episode },
      };
  }
}

function page(
  shell: string,
  opts: {
    markup: string;
    data: BootstrapData | null;
    head: Head;
    status: number;
    cache: string;
  },
): Response {
  const body = shell
    // The shell's own description goes, or the page carries two and a crawler reads the first —
    // which would be the generic one, on every rendered page (found under `wrangler dev`,
    // 2026-09-21).
    .replace(/\n?\s*<meta name="description"[^>]*>/, "")
    .replace("<title>Said on Air</title>", headTags(opts.head))
    .replace(
      '<div id="app"></div>',
      `<div id="app">${opts.markup}</div>${bootScript(opts.data)}`,
    );

  return new Response(body, {
    status: opts.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": opts.cache,
    },
  });
}

/**
 * What the server loaded, handed to the client so hydration does not refetch it and repaint.
 * `<` is escaped because a summary containing `</script>` would otherwise close this tag and put
 * episode text into the document as markup.
 */
function bootScript(data: BootstrapData | null): string {
  if (data === null) return "";
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script>window.__BOOT__=${json}</script>`;
}
