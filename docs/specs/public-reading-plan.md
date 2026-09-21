# Implementation plan — The public reading experience

**Implements:** `docs/specs/public-reading.md` under `AGENTS.md`.
**Written:** 2026-09-21, against `main` at `04d5d85`.
**Status:** **IN PROGRESS.** Steps 1–7 complete 2026-09-21 — the feature works client-rendered; steps 8–10
(server rendering, the crawl surface, the product record) outstanding. Step 3's Google round trip
is the owner's to walk; step 4's landing page was walked by the owner in a browser and produced two changes — the
client-side refusal of the public reads, and the shell collapsing from two bars to one.
**Shape:** ten steps, each one or more commits when the owner asks, each ending with `pnpm check` green **and the
product running**. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

**The ordering rule:** nothing a visitor can see changes until step 4. Steps 1–3 are hosting, tooling and one moved
route — each verifiable on its own, each leaving the product working exactly as it does today for a signed-in
reader. Server rendering (step 8) lands *after* the screens already work client-rendered, so that if the render has
to be reverted the feature still functions for humans and only loses its crawlability.

**The public screens are one step each (4–7)**, taken in the order a visitor meets them: landing, catalog, channel,
summary. Each is separately reviewable and separately revertable, and each ends with one more link in the chain
working signed out. **Step 5 ended as a deletion** — the owner withdrew the signed-out catalog on 2026-09-21, so the
public set is three screens and `/sources` stays a reader's.

**The intermediate state that is not a bug.** Between steps 4 and 7 a visitor can reach a screen that is still
guarded — a channel row on the landing page before step 6, an episode row before step 7 — and lands on `/sign-in`.
That is correct behaviour for a screen that has not been opened yet, it is why step 3 comes before any of them, and
it should be stated in each commit message so a reviewer does not file it.

**Why the hosting move is first and not last.** It is the only step that can fail for reasons outside this repo —
a Vite plugin that fights the Preact preset, a dev registry that will not resolve a service binding. Finding that
out on day one costs a step; finding it out after five steps of screens costs the plan.

## Definition of complete

Spec §6, all twenty-one criteria, plus three this plan adds because they are ways the change could break something
that works today and none is visible in the spec's list:

22. A signed-in reader's existing flows are untouched end to end: queue → read → Done → history, and Ask → a chat
    with sources. Both walked in a browser after step 7 and again after step 8. Steps 5, 6 and 7 each touch a screen
    a reader uses every day, so each of those steps also re-walks the one screen it changed.
23. `pnpm dev` still starts API and web together, and the web's service binding resolves to the local API Worker
    rather than the deployed one.
24. `apps/web/dist` contains no Zod after the change (the existing rule, `AGENTS.md` → the web section), and the
    server bundle contains no reference to `window`, `document` or `localStorage` outside a guard.

## Owner actions (agents propose, never run — `AGENTS.md` → One-time setup)

1. **Approve six dependency additions** (`AGENTS.md` → How to work with the owner: dependency changes are asked for
   first). In `apps/web`: `preact-render-to-string` as a dependency; `wrangler`, `@cloudflare/vite-plugin`,
   `@cloudflare/workers-types`, `vitest` as devDependencies. ~~Nothing is added to `apps/api` or the root.~~
   **Amended in step 1, 2026-09-21:** `@cloudflare/vite-plugin@1.57.1` requires `wrangler@^4.136.1` and the API
   pinned `^4.129.0`, so `wrangler` and `@cloudflare/workers-types` were bumped **in both apps** to keep one
   toolchain rather than two versions of it. The API's 417 tests pass on the new pins.
2. **At first deploy only** — create the web Worker (`wrangler deploy` does it), and configure **rate limiting** on
   the public paths in the Cloudflare dashboard (spec §4.6). Neither is exercisable under `wrangler dev`, so both
   are recorded here and deferred to the first staging deploy rather than pretended to be done.

**No migration, no schema change, no secret, and `/clean-local` is *not* needed.** Nothing in this plan touches a
Durable Object, a migration file or a binding the API owns. This is the rare feature whose whole surface is the web.

## Risks, and what each one looks like when it bites

| # | Risk | What you would see | The answer |
|---|---|---|---|
| 1 | `/` is a built file, so the assets binding serves it before the Worker runs | The landing page renders client-side while every other public route renders on the server, and nothing errors | `run_worker_first: ["/"]` in the assets config (step 8.2). If your Wrangler rejects the array form, use `true` and hand non-public paths to `env.ASSETS.fetch` yourself |
| 2 | The Cloudflare Vite plugin fights `@preact/preset-vite` or the Tailwind v4 plugin | `pnpm dev` fails to boot, or HMR stops working | Fall back to `vite build` + `wrangler dev` against `dist` (slower loop, same runtime). Decide this in step 1, not later |
| 3 | The service binding does not resolve in local dev | A server render 500s or hangs when the API is running | Both Workers must be under `wrangler dev` for the dev registry to connect them; `pnpm dev` already runs both. Verified explicitly in step 1.6 |
| 4 | Hydration mismatch | A flash, a duplicated heading, or React-style "expected server HTML" warnings in the console | The client renders from `window.__BOOT__`, never from a skeleton (step 8.5). Any screen that reads `window` during first render is the bug |
| 5 | The theme script runs after server markup paints | A white flash on a dark-theme reader's shared link | Move the script into `<head>` (step 8.6) |
| 6 | `api.ts` is the only place `fetch` is called (`AGENTS.md`), and the server needs a different transport | A server render reaching for `VITE_API_URL` and going out over the internet, or worse, working in dev and failing deployed | `src/server/load.ts` is a second, deliberate call site with its own doc comment saying why (step 8.3). `api.ts` stays the browser's only one |
| 7 | Zod leaks into the server bundle through a value import | `grep -ril zod apps/web/dist` finds something | Same rule as today: `import type` from `@media-digest/shared`, checked in step 8.8 |
| 8 | A screen's signed-out branch quietly changes what a **reader** sees | Nobody notices until the owner opens their own queue | Steps 5, 6 and 7 each re-walk their one screen signed in as well as signed out (criterion 22). The session-dependent bits are additions to a shared render, never a forked copy of it |

---

### Step 1 — `apps/web` becomes a Worker, serving exactly what Pages served  (size: M)

**Nothing changes for any user.** The Worker's only job at the end of this step is to hand every request to the
assets binding — which is what Pages does. This step exists to move the hosting and prove the dev loop.

**Files:** `apps/web/package.json`, `apps/web/wrangler.jsonc` (new), `apps/web/vite.config.ts`,
`apps/web/src/server/worker.ts` (new), `apps/web/tsconfig.json`, `apps/web/src/server/tsconfig.json` (new),
`AGENTS.md`.

- 1.1 Add the devDependencies `wrangler`, `@cloudflare/vite-plugin`, `@cloudflare/workers-types` (owner action 1).
  The Worker and the browser want different global types — `Fetcher` and `ExportedHandler` on one side, `window`
  and `localStorage` on the other — so `src/server/` compiles under its own `tsconfig.json`, **placed inside
  `src/server/` so an editor finds it as the nearest config for those files**, with
  `"types": ["@cloudflare/workers-types"]` and no DOM lib. That separation is what makes risk 6 a
  typecheck error rather than a runtime surprise.
- 1.2 `apps/web/wrangler.jsonc`, three environments on the same rule as the API — production `media-digest-web`,
  staging `media-digest-web-staging`, dev `media-digest-web-dev`, the top level being staging so a bare
  `wrangler deploy` can never reach production:

  ```jsonc
  {
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "media-digest-web-staging",
    "main": "src/server/worker.ts",
    "compatibility_date": "2026-08-22",
    "compatibility_flags": ["nodejs_compat"],
    "assets": {
      "directory": "./dist/client",
      "binding": "ASSETS",
      "not_found_handling": "single-page-application"
    },
    "services": [{ "binding": "API", "service": "media-digest-api-staging" }],
    "env": {
      "dev": {
        "name": "media-digest-web-dev",
        "assets": { "directory": "./dist/client", "binding": "ASSETS", "not_found_handling": "single-page-application" },
        "services": [{ "binding": "API", "service": "media-digest-api-dev" }]
      },
      "production": {
        "name": "media-digest-web",
        "assets": { "directory": "./dist/client", "binding": "ASSETS", "not_found_handling": "single-page-application" },
        "services": [{ "binding": "API", "service": "media-digest-api" }]
      }
    }
  }
  ```

  **Plan decision:** bindings are repeated per environment rather than inherited, because Wrangler does not inherit
  them and `apps/api` already pays this cost with a test that catches drift. The web's equivalent test arrives in
  step 2.5.

- 1.3 `src/server/worker.ts`, the whole file for now:

  ```ts
  /**
   * The web Worker. Static files are matched by the assets binding before this runs; everything else
   * arrives here. Until step 5 it has nothing to add, so it hands every request straight back —
   * `not_found_handling: "single-page-application"` is what turns an unknown path into index.html,
   * which is exactly what Pages did for us (docs/specs/public-reading.md §4.4).
   */
  export interface Env {
    ASSETS: Fetcher;
    API: Fetcher;
  }

  export default {
    fetch(request: Request, env: Env): Promise<Response> {
      return env.ASSETS.fetch(request);
    },
  } satisfies ExportedHandler<Env>;
  ```

- 1.4 `vite.config.ts` gains the Cloudflare plugin beside the two that are there. If it fights either of them
  (risk 2), stop and report before working around it — the fallback changes the dev command and the owner should
  hear that from a person, not find it in a diff.
- 1.5 Scripts in `apps/web/package.json`. **Not** mirroring the API's `--env` flags: the environment is chosen by
  `CLOUDFLARE_ENV` at build time and every deploy rebuilds (Walkthrough record → the trap). `dev` is
  `CLOUDFLARE_ENV=dev vite`; `build` is a bare `vite build`, which is staging. `turbo.json` gains nothing: `dev`,
  `build`, `typecheck` and `lint` already fan out to every workspace.
- 1.6 **Verify the dev loop before moving on.** `pnpm dev` starts both Workers; the web serves the app at its port;
  a deep link (`/queue`) and a reload both work; HMR still applies a CSS change without a full reload. Then confirm
  the binding resolves by adding a temporary route that returns `await env.API.fetch(new Request("https://api/health"))`,
  checking it answers the local API's health body, and **deleting it in the same commit**.
- 1.7 `AGENTS.md`: the repo layout gains `apps/web/wrangler.jsonc` and `src/server/`; the web section's
  "verify deep links and reloads under `wrangler pages dev`" becomes `wrangler dev`; the Pages build-settings
  paragraph is replaced by the Worker's; Environments gains the web's three; the deploy commands gain the web's two.

**Done when:** `pnpm check` is green, `pnpm dev` runs the product, and a reader can use every screen exactly as
before. **If this step cannot be made to work, the whole SSR decision is reopened** — say so rather than forcing it.

---

### Step 2 — Vitest in `apps/web`, and the route matcher it proves  (size: S)

**Files:** `apps/web/package.json`, `apps/web/vitest.config.ts` (new), `apps/web/src/lib/public-routes.ts` (new),
`apps/web/test/public-routes.test.ts` (new), `apps/web/test/wrangler-config.test.ts` (new), `AGENTS.md`.

Test-first, because this step exists to establish that tests run here at all.

- 2.1 Add `vitest` (owner action 1) and `vitest.config.ts` — plain Node environment, no pool, no jsdom
  (spec §3, decisions 16–17). `test` script in `apps/web/package.json` so `pnpm check` picks it up.
- 2.2 Write `test/public-routes.test.ts` first, and run it to watch it fail on the missing module:

  ```ts
  import { describe, expect, it } from "vitest";
  import { matchPublicRoute } from "../src/lib/public-routes";

  describe("matchPublicRoute", () => {
    it("matches the three public paths", () => {
      expect(matchPublicRoute("/")).toEqual({ name: "landing" });
      expect(matchPublicRoute("/sources/UC123")).toEqual({ name: "channel", channelId: "UC123" });
      expect(matchPublicRoute("/read/abc_123")).toEqual({ name: "episode", episodeId: "abc_123" });
    });

    it("does not match a guarded path", () => {
      for (const path of ["/queue", "/history", "/history/2026-09-21", "/chats", "/chats/new",
                          "/chats/x", "/account", "/curate", "/curate/UC123", "/sign-in"]) {
        expect(matchPublicRoute(path)).toBeNull();
      }
    });

    it("does not match a deeper or trailing-slash path", () => {
      expect(matchPublicRoute("/sources/UC123/extra")).toBeNull();
      expect(matchPublicRoute("/sources/")).toBeNull();
      expect(matchPublicRoute("/read/")).toBeNull();
    });
  });
  ```

- 2.3 Implement `src/lib/public-routes.ts` to pass it — the file in spec §4.4's shape, exporting `PublicRoute` and
  `matchPublicRoute`. Its doc comment says it is imported by both the Worker and the client so the two cannot
  disagree about which URLs are public.
- 2.4 **Plan decision: the ids are matched as `[\w-]+`, and validity is the API's business.** The matcher decides
  *which screen*, not *whether the thing exists*; a malformed id becomes a 404 from the API in step 5, which is
  where a 404 belongs.
- 2.5 `test/wrangler-config.test.ts`, mirroring the API's: parse `wrangler.jsonc` and assert all three environments
  carry `ASSETS` and `API`, that the top level names the staging Worker, and that each environment's service target
  matches its own tier. This is the drift test step 1.2 owes.
- 2.6 `AGENTS.md` → Testing: "`apps/web` has typecheck and lint only" is replaced per spec §8 — Vitest in a Node
  environment over pure modules and the server render; components still verified by hand under `pnpm dev`; the
  `node --experimental-strip-types` note retired.

**Done when:** `pnpm check` runs web tests and they pass, and `pnpm test --filter web` names two suites — `public-routes` and `wrangler-config`. (`public-view` is step 4's: nothing is built a step before something needs it.)

---

### Step 3 — Sign-in moves off `/`  (size: S)

**The first visible change, and the smallest one that can go wrong on its own.** After this step `/` is still not
public — it redirects — but sign-in lives where the rest of the plan expects it.

**Files:** `apps/web/src/main.tsx`, `apps/web/src/screens/SignIn.tsx`, `apps/web/src/session.tsx`,
`apps/web/src/lib/back.ts` (read only — confirm nothing hardcodes `/`), `apps/web/src/screens/Settings.tsx`
(sign-out's destination).

- 3.1 Route `SignIn` at `/sign-in`; leave `/` routed to it too, temporarily, so nothing breaks mid-step.
- 3.2 `SignIn.tsx` reads `?next=` and passes it through to the handoff's `next`, so a visitor returns where they
  were. Default stays `/queue`.

  **Found while implementing:** the destination has to survive *two* hops, not one. `AuthCallback` hardcoded
  `route("/queue")`, so carrying it to the callback is not enough — it rides on the callback's own query
  (`/auth/callback?to=…`) and is read there **before** the `replaceState` that erases the address bar, which
  discards the query as well as the fragment. Nothing is stored anywhere, which keeps decision 10 intact.

  **Plan decision: `next` is validated against the app's own path list before use** — it must start with `/` and
  not `//`, or it is dropped for the default. The API already guards its own redirect (`isAllowedOrigin`,
  `auth-phase.md` §A5); this is the web's half of the same rule and it costs three lines.
- 3.3 `Guard`'s "no session" redirect: `/` becomes `/sign-in?next=<current path>`.
- 3.4 Sign-out sends the reader to `/sign-in`, not `/`, until step 4 makes `/` a page worth landing on. Revisit in
  4.6.
- 3.5 Remove the temporary `/` → `SignIn` route once step 4's landing screen exists — **not in this step**. Note it
  in the commit message so the next step's author knows it is owed.

**Done when:** a signed-out reader hitting `/queue` lands on `/sign-in`, signs in, and arrives back at `/queue`.
Walked in a browser.

---

### Step 4 — The public shell, and the landing page  (size: M)

**The first screen a visitor can reach.** It carries the shell every later step reuses, which is why it is first
even though the summary is the screen that matters most.

**Files:** `apps/web/src/components/PublicShell.tsx` (new), `apps/web/src/screens/Landing.tsx` (new),
`apps/web/src/lib/public-view.ts` (new), `apps/web/test/public-view.test.ts` (new), `apps/web/src/main.tsx`,
`apps/web/src/components/Page.tsx`, `apps/web/src/lib/copy.ts`, `apps/web/src/screens/Settings.tsx`,
`docs/design.md`.

- 4.1 `lib/public-view.ts` with `publicChannels`, written test-first (`publicEpisodes` joins it in step 6, when a
  screen needs it):

  ```ts
  import type { Channel } from "@media-digest/shared";

  /** The catalog a visitor sees: approved, whether or not it has episodes yet, and paused with it. */
  export const publicChannels = (channels: readonly Channel[]): Channel[] =>
    channels.filter((channel) => channel.status === "approved");
  ```

  Its test asserts a `requested` and a `declined` channel are dropped, a **paused** approved one is kept, and an
  approved one with `episodes.available === 0` is kept.

  **Note for the implementer:** `paused` is a boolean on the channel, not a status — a paused channel's `status` is
  still `approved`, which is why one predicate covers both cases and why the test must include a paused row to stop
  someone "simplifying" the filter into `status === "approved" && !paused`.
- 4.2 `components/PublicShell.tsx` — the fixed band and the nav row beneath it (spec §4.2). The band is
  `position: fixed`, full width, inverted, carrying the line *Follow channels · keep a queue · ask about any
  episode* (shortened to *Follow · queue · ask* below `md`) and a **Sign in** button linking to
  `/sign-in?next=<path>`. The nav row — wordmark and **Channels** — sits in normal flow directly beneath it and
  scrolls away; it returns only at the top of the page, which costs no code at all (spec §3, decision 9). Copy
  lives in `lib/copy.ts` with the rest, never inline. The band's height is a token, because step 8's fixed
  positioning and every later screen's top padding both depend on it.
- 4.3 `Page.tsx` chooses the shell from the session: a ready session gets `Nav`, no session gets `PublicShell`. One
  change, in the one place that already owns the frame — not a prop threaded through four screens.
- 4.4 `screens/Landing.tsx` at `/`: the wordmark, the promise, then `publicChannels(...)` in full, uncapped, with a
  greyed row for a channel with no episodes yet (spec §3, decision 2a). No *See all* link. A ready session
  redirects to `/queue` — lift that effect out of `SignIn.tsx`, do not reinvent it. Remove the temporary `/` route
  from 3.5 in the same commit.
- 4.5 Sign-out lands on `/`, which is now a page worth landing on (closing 3.4).
- 4.6 `docs/design.md` gains the signed-out shell section: the band, the four states each public
  screen owes, and the rule that a visitor is shown no control they cannot use.

**Done when:** `pnpm check` green; a private window at `/` shows the landing page with the real catalog and the
band; a signed-in window at `/` still goes to `/queue`; and a channel row leads to `/sign-in` — correct until
step 6.

---

### Step 5 — The public catalog, `/sources`  (size: M)

**Files:** `apps/web/src/screens/Sources.tsx`, `apps/web/src/lib/copy.ts`.

- 5.1 `Sources` loses its `Guard` and splits on the session **inside** one screen: the loaders, the search box, the
  sort and the paging are shared; what a visitor does not get is added, not forked. A forked `PublicSources.tsx`
  would be two screens to keep in step and is explicitly not the shape here (risk 8).
- 5.2 Signed out: no tabs (`SOURCES_TABS` means nothing without a session — there is no "following" and no
  "declined" to show), no `AddChannel`, no `FollowButton`, no per-row busy state. The list is
  `publicChannels(channels)` with the existing search, sort and paging at 25 exactly as they are.
- 5.3 A visitor's row reads: title, summary count, newest summary date, follower count (spec §4.1 — the owner
  confirmed follower counts are fine for strangers on 2026-09-21). The sort options that depend on a session —
  "Most unread" — are absent from a visitor's control rather than present and inert.
- 5.4 The heading is *Channels*, and `useDocumentTitle` gives the page its own title for a visitor as for a reader.
- 5.6 **Reverted in review, 2026-09-21, after a browser walkthrough.** The owner's ruling: *"we also do not need a
  sources logged out experience"*. Everything above from 5.1 to 5.3 is undone — `/sources` keeps its `Guard` and
  its reader-only shape — and `/sources` leaves `matchPublicRoute`, so the public set is three screens, not four.
  What survives is 5.5's extraction, which the landing page uses. **Step 5 is therefore a net deletion**, and the
  screen a visitor browses is the landing page alone.
- 5.5 **Added in review, 2026-09-21.** The owner asked why a visitor needs `/sources` at all when the landing page
  lists every channel, which was the right question: signed out the two showed the same rows, and `/sources` added
  only search, sort and paging. **Both stay**, and the landing gains the search — reusing the control rather than
  copying it. `components/FindChannel.tsx` now holds it, and the three call sites that had been three copies of the
  same six lines — the catalog, the queue's channel filter, and the landing — share one. Sort and paging stay on
  `/sources`, which is the screen for working through a long list rather than arriving at one.

**Done when:** `pnpm check` green; a private window walks `/` → *Channels* → the catalog, searches and sorts it;
a signed-in window shows the three tabs, Add a channel and Follow exactly as before; and a channel row still leads
to `/sign-in`.

---

### Step 6 — The public channel page, `/sources/:id`  (size: M)

**Files:** `apps/web/src/screens/Source.tsx`, `apps/web/src/lib/public-view.ts`,
`apps/web/test/public-view.test.ts`, `apps/web/src/lib/copy.ts`.

- 6.1 Add `publicEpisodes` to `lib/public-view.ts`, test-first:

  ```ts
  /** A channel page's rows: readable now, or being worked on. Never `failed`, never `skipped`. */
  export const publicEpisodes = (episodes: readonly Episode[]): Episode[] =>
    episodes.filter((episode) => episode.status === "available" || episode.status === "pending");
  ```

  Its test asserts `failed` and `skipped` are dropped and that a `pending` episode survives **with its
  `waitReason` intact** — the reason is the point of showing the row at all.
- 6.2 `Source` loses its `Guard`, on the same shared-render rule as 5.1. Signed out: no `FollowButton`, no owner
  controls, rows from `publicEpisodes(...)`, and a `pending` row rendering its wait reason through the phrases
  `lib/copy.ts` already owns.
- 6.3 **The hidden-channel rule** (spec §3, decisions 5 and 6). A channel whose `status !== "approved"` still
  renders: the same page, plus a line saying it is not in the catalog, and **`reviewNote` is never rendered for a
  visitor** — not hidden with CSS, not passed to a component, not in the markup at all. A reader still sees it.
  This is the one place in the plan where a mistake leaks the owner's words to the world, so the commit that
  implements it is the commit to read twice.
- 6.4 The channel-name link on a summary (step 7) lands here, which is why this step precedes it.

**Done when:** `pnpm check` green; a private window walks `/` → catalog → a channel and sees its episodes; a
declined channel opened by direct link renders with the line and no note; the same page signed in is unchanged
from today; and an episode row still leads to `/sign-in`.

---

### Step 7 — The public summary, `/read/:episodeId`  (size: M)

**The screen the feature exists for.** Last because everything it links to now works.

**Files:** `apps/web/src/screens/Reading.tsx`, `apps/web/src/lib/reading-origin.ts`, `apps/web/src/lib/copy.ts`.

- 7.1 `Reading` loses its `Guard`, same shared-render rule.
- 7.2 **The bar, per spec §4.2: two bars, not three.** Beneath the fixed band, the reading page's own bar carries
  the wordmark, the way back to **Channels**, `Aa` and *Watch on YouTube*. `Done` and `Ask` are absent for a
  visitor — absent, not disabled, which is the rule `Ask` already follows for an ineligible reader
  (`Reading.tsx`'s existing comment says so; extend it rather than writing a second rule).
- 7.3 **Where back goes.** `readOrigin()` records the list a reader opened a summary from; a visitor arriving by
  shared link has none, and today's fallback is `/queue`, which they cannot see. **Plan decision: a visitor's
  fallback is the episode's own channel** — `/sources/:channelId` — not the catalog: it is the most useful next
  page and it is the one step 6 just built. Signed-in behaviour is untouched.
- 7.4 Related is already `[]` for an anonymous caller (the API filters it to eligible channels), so the section
  renders nothing on its own. **Assert that rather than special-casing it** — a `session === null` check here would
  be a second rule saying what the data already says.
- 7.5 The type and theme controls stay for a visitor: they are `localStorage` and need no session.
- 7.6 **Found while doing this, and it was step 6's bug too.** `Page` rendered `bar ?? <Frame/>`, so a screen that
  brings its own bar showed a visitor **no invitation band at all** — and those are precisely the two screens a
  shared link lands on. The band now renders above a screen-owned bar, and `useBarTop` puts that bar at `top-14`
  for a visitor so it sticks beneath the fixed band rather than under it.

**Done when:** `pnpm check` green; a private window opens a shared summary link and reads the whole thing — lede,
every takeaway, the timestamp links into YouTube, topics — with the band above and no `Done` or `Ask`; back goes to
the channel; and criterion 22's two signed-in flows are walked in full, since this step touches the screen a reader
spends the most time in.

---

### Step 8 — Server rendering  (size: L)

**Files:** `apps/web/src/app.tsx` (new), `apps/web/src/main.tsx`, `apps/web/index.html`,
`apps/web/src/lib/bootstrap.tsx` (new), `apps/web/src/lib/use-load.ts`, `apps/web/src/server/worker.tsx`,
`apps/web/src/server/load.ts` (new), `apps/web/src/server/head.ts` (new), `apps/web/wrangler.jsonc`,
`apps/web/test/head.test.ts` (new), `apps/web/test/load.test.ts` (new), `apps/web/test/render.test.tsx` (new).

- 8.1 Add `preact-render-to-string` (owner action 1). Split `App` out of `main.tsx` into `app.tsx`; `main.tsx` keeps
  the browser entry and the `render()` call. The Worker cannot import a module that renders on import.
- 8.2 `wrangler.jsonc`: add `"run_worker_first": ["/"]` to each environment's assets block, with a comment naming
  risk 1 — `/` matches `index.html` and would otherwise never reach the Worker.
- 8.3 `src/server/load.ts` in spec §4.4's shape: `Loaded` as `ok | missing | unavailable`, one `get` helper over
  `env.API.fetch` with **no `Authorization` header**, and the three route cases. Its doc comment states both reasons
  the header is absent — the anonymous shape is what a visitor must get, and it is what makes the response
  cacheable — and that this is the second and only other `fetch` call site in the web (risk 6).
  `test/load.test.ts` drives it with a stub `Fetcher`: a 200 becomes `ok`, a 404 becomes `missing`, a 500 becomes
  `unavailable`, and **a channel whose status is `requested` or `declined` becomes `ok`** — it renders, minus the
  note (spec §3, decision 5). Assert that last one explicitly and name the decision in the test's title: an earlier
  draft of this spec returned 404 there, and the sketch that circulated on 2026-09-21 still shows the old rule.
- 8.4 `src/server/head.ts`: `headFor(data)` returning `{ title, description, canonical, type }` per route —
  an episode's description is its executive summary truncated on a word boundary, a channel's is its title and
  count — and `headTags(head)` doing the escaping. `test/head.test.ts` asserts a title containing `<`, `&` and `"`
  survives as entities, and that a summary containing `</script>` cannot close the boot script (the `<` rule).
- 8.5 `lib/bootstrap.tsx`: a context holding what the server loaded, a `useBootstrap(key)` hook, and `useLoad`
  seeding its first state from it instead of `loading`. `main.tsx` hydrates when `window.__BOOT__` and server
  markup are both present, and renders from scratch otherwise.
- 8.6 Move the pre-paint theme script from the end of `<body>` into `<head>` in `index.html` (risk 5). Its comment
  gains one line: it now guards server-rendered content, not only an empty root.
- 8.7 **`src/server/worker.ts` is renamed `worker.tsx`** (it now holds JSX) and `main` in all three environments of
  `wrangler.jsonc` follows. It becomes spec §4.4's handler — method check, `matchPublicRoute`, shell from
  `env.ASSETS`, the three outcomes with their three cache policies, and `renderToString` inside `LocationProvider`
  and `Bootstrap`. `test/render.test.tsx` asserts the rendered markup of an episode contains its title and its
  executive summary, which is also the check that fails if the server bundle reaches for `window` (criterion 20).
- 8.8 Verify under `wrangler dev`: `curl` each of the three public URLs and read the HTML; `curl` an unknown episode
  id and see a 404 with a body; stop the API and see the shell with `no-store`; `curl` a guarded path and see the
  shell, not a render; then load a shared summary link in a dark-theme browser and watch for a flash. Confirm a
  built asset (`/assets/index-*.js`) is served **without** invoking the Worker — a `console.log` at the top of
  `fetch` that never fires for it, removed in the same commit (criterion 17). Finally `grep -ril zod apps/web/dist`
  finds nothing (risk 7).

**Done when:** all of 8.8 passes and criterion 22's signed-in flows still work after a hard reload — which is the
case where a reader now sees the anonymous render settle into theirs.

---

### Step 9 — `robots.txt`, `sitemap.xml`, and the cache  (size: S)

**Files:** `apps/web/public/robots.txt` (new), `apps/web/src/server/sitemap.ts` (new),
`apps/web/src/server/worker.tsx`, `apps/web/test/sitemap.test.ts` (new).

- 9.1 `public/robots.txt` — a static asset, because it never varies:

  ```text
  User-agent: *
  Allow: /$
  Allow: /sources
  Allow: /read/
  Disallow: /queue
  Disallow: /history
  Disallow: /chats
  Disallow: /account
  Disallow: /curate
  Disallow: /sign-in
  Disallow: /auth/

  Sitemap: https://<the deployed origin>/sitemap.xml
  ```

  **Plan decision: the `Sitemap:` line is written at build time from the same origin the app is served from**, not
  hardcoded — a staging robots.txt pointing at production's sitemap is a mistake nobody would catch by reading it.
  If that proves awkward in the asset pipeline, serve `robots.txt` from the Worker instead and say so.
- 9.2 `src/server/sitemap.ts`: fetch the public channels and, for each, its available episodes; emit `<url>`
  entries for `/`, `/sources`, each `/sources/:id` and each `/read/:episodeId`, with `<lastmod>` from
  `summaryAvailableAt` or the channel's newest episode. Hidden channels are excluded — the catalog filter is the
  same `publicChannels`, imported, not reimplemented. `test/sitemap.test.ts` asserts a declined channel and a
  `failed` episode are absent and that the XML escapes an ampersand in a title.
- 9.3 Route `/sitemap.xml` in the Worker above the asset fallback, cached like a page.
- 9.4 Cache headers were written in 8.7; confirm them here against real responses rather than trusting the code —
  `curl -I` on a rendered page shows `s-maxage=300`, on the unavailable path shows `no-store`.

**Done when:** both files answer correctly under `wrangler dev`, and the sitemap lists exactly the URLs a visitor
can reach.

---

### Step 10 — The documents this falsified  (size: M)

Docs travel with their work in this repo, so most edits have already landed: `AGENTS.md` in steps 1 and 2,
`docs/design.md` in step 4. What is left is the product record.

**Files:** `docs/PRD.md`, `docs/specs/public-reading.md`, `docs/specs/route-visibility.md`.

- 10.1 **PRD §2** — a visitor is a new actor: may read the catalog and every summary, may do nothing else.
- 10.2 **PRD §3** — the web is a Worker with static assets and a service binding to the API, not Pages.
- 10.3 **PRD §7 Screens** — four screens gain a signed-out rendering per spec §4.1; the `/` entry changes from the
  sign-in screen to the landing page; `/sign-in` is added.
- 10.4 **PRD §9** — one entry covering this feature, naming the decisions that were *reversed in flight*: the 404 on
  hidden channels, "sign in then resume the action", and "type the question then sign in to send". A decisions log
  that records only what survived teaches nothing.
- 10.5 **PRD §10** — a line between the Auth phase and M6, carrying no number for the reason the Design phase does
  not, and M6's §8 sweep gains spec §6's criteria.
- 10.6 **`route-visibility.md` §7** — its open question ("does a public catalog imply a public web?") is answered;
  point it here rather than leaving a question mark against something now built.
- 10.7 **`public-reading.md`** — status to implemented, with the commits, and the walkthrough record below filled in.

**Done when:** `pnpm check` green and no document still describes the web as a Pages site or `/` as the sign-in
screen. Grep for both before calling it done.

---

## Walkthrough record

*(`CLAUDE.md`: Workers runtime behaviour is not proven by `vitest` alone, so every step that touches the Worker
ends under `wrangler dev`.)*

**Step 1, 2026-09-21.** `pnpm dev` from a clean process table — API on 8787, web on 5173. Six checks, all passing:
`/` serves the shell with its title; `/queue` and `/read/abc123` both answer 200 with the app root, so deep links
and the SPA fallback survive the move; `/fonts/source-serif-4-latin.woff2` is served as `font/woff2`;
**`/__binding-probe` returned `{"service":"api","status":"ok"}`**, which is the API Worker answering in-process
through the service binding (the probe was deleted in the same commit); and touching `src/styles.css` produced
`[vite] (client) hmr update /src/styles.css` alongside an `(ssr) hmr update` of the worker entry, so hot reload
survives too. Risk 2 did not materialise — the Cloudflare plugin, the Preact preset and the Tailwind plugin
coexist. Risk 3 did not either, once the process table was clean.

**A trap found by a dry run, not by reading** — and the reason step 1's scripts do not look like the API's.
`@cloudflare/vite-plugin` flattens **one** environment into a generated config under `dist/ssr/`, and writes
`.wrangler/deploy/config.json` to redirect `wrangler deploy` to it. So `wrangler deploy --env production` against a
staging build deploys a **production Worker bound to the staging API**, and says nothing. Verified by dry run:
`--env production` on a default build listed `env.API (media-digest-api-staging)`. The environment is therefore
chosen at build time by `CLOUDFLARE_ENV`, confirmed for all three tiers, and every `deploy` script rebuilds. A bare
`pnpm build` is still staging, so the "a bare deploy can never reach production" property survives — it now lives
in the build rather than the deploy.

## Plan decisions

1. **Bindings repeated per environment**, with a drift test (1.2, 2.5).
2. **Route ids matched loosely; existence is the API's answer** (2.4).
3. **`next=` validated as a same-app path before use** (3.2).
4. **The `Sitemap:` line follows the serving origin** (9.1).
5. **Steps 4–7 ship the feature client-rendered before step 8 renders it on the server.** The alternative — build
   the Worker's rendering first — would mean debugging screens and hydration at the same time, and would leave
   nothing demonstrable until both worked.
6. **One screen per step, in the order a visitor meets them** (owner instruction, 2026-09-21). The shell lands with
   the landing page because every later screen needs it; `publicChannels` lands there too because the landing page
   is the first list; `publicEpisodes` waits for step 6, which is the first screen that has episodes. Nothing is
   built a step before something needs it.
7. **A signed-out branch is an addition to a shared render, never a forked screen** (5.1, 6.2, 7.1). Four
   `PublicX.tsx` copies would drift from the reader's version silently, and the drift would only show on the
   screens nobody has signed out of lately.
8. **A visitor's "back" from a summary is the episode's channel** (7.3), where a reader's is the list they came
   from. A visitor has no list.
