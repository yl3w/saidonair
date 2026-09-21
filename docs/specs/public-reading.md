# Feature spec — The public reading experience

**Written:** 2026-09-21, against `main` at `04d5d85`.
**Status:** **SPECCED** — requirements gathered with the owner on 2026-09-21, question by question. Not yet
approved for implementation; the plan is `public-reading-plan.md`.
**PRD:** §2 (who may do what — a visitor is a new actor), §3 (architecture: the web's hosting changes), §7 (the
screens, which gain four public renderings), §9, §10.
**Depends on:** `route-visibility.md`, implemented 2026-09-21, which made five API reads public. This is the other
half of that decision: until a signed-out visitor can reach a screen, those routes are correct, tested and invisible.

## 1. Summary

A signed-out visitor can browse the catalog, open a channel, and read any summary **in full**, at the same URLs a
reader uses. Three screens lose their session guard — `Sources`, `Source` and `Reading` — a fourth is new at `/`,
and nine guarded routes keep theirs.

| URL | Signed out | Signed in |
|---|---|---|
| `/` | Landing: the wordmark, the one-line promise, then every channel in the catalog | Redirects to `/queue`, as today |
| `/sources` | The catalog: approved and paused channels, with search, sort and paging at 25 | Today's Sources screen, unchanged |
| `/sources/:id` | A channel: title, counts, followers, then its `available` and `pending` episodes | Unchanged |
| `/read/:episodeId` | The whole summary — lede, takeaways with their timestamps, topics | Unchanged |

Nothing is truncated, teased or gated. The single call to action is a fixed band at the top of every public page.

Two things this also does, because server rendering is what makes a shared link worth sharing: **`apps/web` becomes
a Worker with static assets**, and the four public routes are rendered to HTML on the edge.

## 2. Why this shape

### 2.1 The job the surface does

The owner named three jobs and explicitly refused a fourth (2026-09-21):

- **A shareable read.** The unit that travels is one episode summary, posted into a group chat or a channel.
- **A browsable showcase.** The catalog is the pitch: what is covered, and how deep the archive goes.
- **A public archive.** The summaries are worth finding from a search engine, not only from a link someone sent.

**Not a demo that converts.** A teaser of each summary, a cap on how many can be read, a paywall by another name —
declined. The summaries are the product and they are readable. Everything in §3 follows from that: the visitor is
treated as a reader who has not signed in, not as a lead being worked.

### 2.2 Why the same URLs

A separate public namespace (`/browse`, `/e/:id`) was considered and rejected. One set of URLs means a link a reader
copies works for a stranger, a link a stranger opens works for a reader with no redirect, and there is exactly one
canonical URL per channel and per episode — which is what indexing wants and what two namespaces cannot give.

The cost is real and named: `Sources` is a heavy screen — three tabs, search, sort, paging, Add a channel, owner
actions — and it grows a signed-out branch.

### 2.3 Why server rendering, and why it forces the hosting question

The web is a client-rendered SPA: every URL serves the same empty shell. That is survivable for humans who wait for
JavaScript and fatal for the two audiences this feature exists for — the crawler, and the link unfurler in Slack or
iMessage, which never runs JavaScript at all. A shareable read that unfurls as a generic grey line is not shareable.

Rendering the four public routes on the edge makes the summary text present in the first byte. That decision then
forces a second: where it runs. `apps/web` moves from Pages to a **Worker with static assets** (§4.4), decided while
nothing is deployed and the move is free.

### 2.4 Why the visitor has no controls

The first design gave a visitor working Follow and Ask controls whose intent survived the OAuth round trip: click
Follow, sign in, come back following; type a question, sign in, come back with it sent. The owner struck both on
2026-09-21 after seeing the reading page drawn.

What that removes is not a button but a machine: intent serialised before the redirect, replayed exactly once after
`/auth/callback`, expiring, and failing safely when the channel was declined or the episode vanished while the
visitor was at Google. It was the most fragile thing in the feature and it existed to save one click.

**A visitor reads. The band invites. Signing in returns them to the page, where they act as a reader.**

## 3. Decisions this spec makes

All 2026-09-21, with the owner, unless stated.

| # | Decision | Why |
|---|---|---|
| 1 | **The same URLs, with screens that degrade** | One canonical URL per object; a shared link works for everyone (§2.2) |
| 2 | **`/` becomes the landing page**: wordmark, the promise, then the catalog. Signed in it redirects to `/queue`, as it does today | The first screen proves the claim rather than describing it, and it needs no API the public routes do not already answer. A front page of the newest episodes across channels was rejected with it: there is no public cross-channel episode read, and adding one is a separate decision |
| 2a | **The landing page lists every channel, uncapped** (owner, 2026-09-21) | A cap and a *See all N channels* link were proposed and deferred together: the right number wants a real catalog on screen, and at today's size there is nothing to page. The link goes with the cap — the nav's **Channels** already reaches `/sources`, which is where search and sort live. Both return when paging does |
| 3 | **The public catalog lists approved channels — with episodes or without — and paused ones** | An approved channel with nothing yet still says the archive is coming; a paused channel's existing summaries are real. Both are the product |
| 4 | **Requested and declined channels are absent from the catalog list** | A stranger browsing a catalog should not be reading the owner's rejections, and a requested channel has nothing to show: the first import happens on approval |
| 5 | **A hidden channel's page still renders by direct link, minus `reviewNote`** (reversed from a 404 the same day) | The first answer was 404, and the next decision made it incoherent: a declined channel's summaries stay readable, so a 404 on the channel left the channel name on a shared summary pointing into a wall. Hidden from the list, reachable by link, with the owner's note never sent to a visitor |
| 6 | **A declined channel's summaries stay readable** | Follows the API, which deliberately filters the episode reads on no channel status (`route-visibility.md` §3). Declining stops new work; it does not retract work already done |
| 7 | **A public channel page lists `available` and `pending` episodes. `failed` and `skipped` are hidden** | `pending` with its reader-safe `waitReason` says the archive is alive. `failed` advertises a failure rate to strangers and `skipped` is a row that will never be readable |
| 8 | **One call to action: a fixed band at the top of every public page**, reading *Follow channels · keep a queue · ask about any episode*, with **Sign in**. The wordmark-and-Channels row sits beneath it and scrolls away | The owner's design, chosen over a bottom-pinned bar, a filled button in the nav, and an inverted single bar. It is unmissable, it says what an account is *for* rather than only "sign in", and it costs no vertical space once the nav has scrolled off |
| 9 | **The nav row returns only at the top of the page** | No scroll listener, no threshold to tune, nothing to feel twitchy. A visitor who wants the catalog scrolls up, which on a summary they are reading is where they are heading anyway |
| 10 | **No visitor-facing controls anywhere** — no Follow, no Ask composer, no Add a channel — and therefore **no intent is stored across sign-in** | §2.4. Strikes two earlier decisions of the same day: "sign in, then resume the action" and "type the question, then sign in to send" |
| 11 | **Sign-in moves to `/sign-in`**, and `Guard` redirects there | `SignIn.tsx` already exists and keeps its job at a new address, carrying `?next=`. The landing page cannot also be the sign-in screen, and an expired session deserves a page that explains itself rather than a marketing hero |
| 12 | **The four public routes are server-rendered; `apps/web` becomes a Worker with static assets** | §2.3, §4.4 |
| 13 | **`robots.txt`, a generated `sitemap.xml`, edge caching, and Cloudflare rate limiting all ship with the feature** | The first two are what turns "indexable" into "indexed". The cache is what makes a public archive affordable. Rate limiting has been named as a gap twice (`route-visibility.md` §5) and public pages are what make it matter |
| 14 | **No link-preview image** | The obvious version — derive `https://i.ytimg.com/vi/<episodeId>/…` from the id — is correct only while YouTube is the only source, and fails as a *broken image* rather than an error the day a second source lands. The durable version is an `image_url` column filled by whatever ingests the episode, and that is a schema change this feature does not need. Unfurls carry title and description, which is most of their value |
| 15 | **No shared secret between the web Worker and the API, and the five reads stay publicly reachable** | Asked directly by the owner once the service binding existed. A secret between two Workers is genuinely private, but it protects nothing while the same routes are open by decision — and locking them would force the web to proxy every public read, because after hydration the browser fetches them itself. The cache and the rate limit are the controls; nothing paid is reachable anonymously |
| 16 | **`apps/web` gains a test runner** (owner, 2026-09-21), reversing the standing "typecheck and lint only" | This feature adds pure modules worth pinning — the route matcher, the two list filters, the head-tag builder, the loader's status mapping — and a **second rendering path** where a mistake is invisible to both existing gates. Vitest, the runner `apps/api` already uses, in its plain Node environment: no `@cloudflare/vitest-pool-workers`, because nothing here needs a binding, and `preact-render-to-string` runs in Node |
| 17 | **Component and DOM tests stay out** | The reason the web had no runner still holds for components: daisyUI is CSS only, behaviour is verified by hand under `pnpm dev`, and a jsdom test of a Preact component mostly asserts that the component is the component. The new runner covers pure modules and the server render — a render test that asserts the markup contains the summary text also catches a server bundle reaching for `window` |

## 4. Contract

### 4.1 What each public screen shows

**`/` — the landing page.** The wordmark, the promise (*What was said on the air, in text, with the minute it was
said*), then the catalog in full: channel title, summary count, and a greyed row for a channel with nothing yet. No
cap and no *See all* link (§3, decision 2a); the nav's **Channels** reaches `/sources` for search and sort. No
sign-in button in the body — the band above carries it. Signed in, this route redirects to `/queue` exactly as
`SignIn.tsx` does today.

**`/sources` — the catalog.** Approved and paused channels, keeping the search, the sort and the paging at 25 that
the reader's screen has, because a list elegant at six is four screens of scrolling at thirty (`docs/design.md` §5).
Each row: title, summary count, newest summary, follower count. No Follow control, no Add a channel, no tabs — the
reader's three-tab split (following / catalog / declined) has no meaning without a session.

**`/sources/:id` — a channel.** Title, summary count, follower count, newest date; then episodes newest first, each
with title, date, runtime and the summary's opening as an excerpt. A `pending` episode renders its `waitReason` in
the reader-safe phrasing `lib/copy.ts` already owns. A hidden channel renders the same, with a line saying it is not
in the catalog, and **never** its `reviewNote`.

**`/read/:episodeId` — a summary.** The reading column as a reader sees it: channel, title, date and runtime, the
executive summary, the takeaways with their timestamps linking into YouTube, the topics. The type and theme controls
stay — they are `localStorage` and need no session. **Absent:** `Done` (no receipt to write), `Ask` (no chat without
a session), and Related (the API returns `[]` to an anonymous caller, since related titles are filtered to the
caller's eligible channels).

### 4.2 The shell

Two stacked bars on every public page:

1. **The invitation band** — `position: fixed`, full width, inverted. *Follow channels · keep a queue · ask about any
   episode* and a **Sign in** button. On a phone the line shortens to *Follow · queue · ask*. It never scrolls away.
2. **The nav row** — the wordmark and **Channels**, in the ordinary page flow directly beneath the band. It scrolls
   off with the content and is present again only at the top of the page.

**The reading page has two bars, not three** (resolved by this spec, 2026-09-21 — the owner's instruction was
"branding + navbar below, scrollable out of view", and the reading page already replaces the nav with a bar of its
own). The band is fixed; beneath it the reading page's own bar carries the wordmark, the way back to **Channels**,
`Aa` and *Watch on YouTube*, and scrolls away like the nav row does elsewhere. `Done` and `Ask` are absent from it.
A third row stacking the product's nav above the reading bar would put 150 px of chrome over a reading column whose
standing rule is that it carries no chrome it can live without.

There is no bottom tab bar for a visitor: it exists to put three reader destinations under a thumb, and a visitor
has one.

### 4.3 Sign-in

`SignIn.tsx` moves from `/` to `/sign-in`, unchanged but for its route and the line about what the product asks
Google for. The band's button links to `/sign-in?next=<the current path>`; the existing handoff carries `next`
through the round trip, so a visitor returns to the page they were reading, now as a reader, with the band replaced
by the reader's nav. `Guard`'s "no session" redirect changes from `/` to `/sign-in`.

A first-time reader follows nothing, so their queue is empty — which `QUEUE_NO_FOLLOWS_NOTE` already answers
(*"Follow a channel and its summaries will land here as they are written"*). Nothing new is owed for first run.

### 4.4 Server rendering

**The host.** `apps/web` gains its own `wrangler.jsonc` on the same three environments as the API — `env.dev`, the
top level as staging, `env.production` — with `assets` pointing at `dist`, `not_found_handling:
"single-page-application"`, and `run_worker_first` for `/`, which is otherwise served as a file before the Worker is
ever invoked. A **service binding** to the API Worker means a render calls the API in-process: no DNS, no TLS, no
public hop, and no CORS.

**The handler.** One decision, then ordinary code:

- A path matching a built file is served by the assets binding; the Worker never runs.
- Otherwise `matchPublicRoute` runs. `null` — a guarded screen or an unknown path — is handed to `env.ASSETS.fetch`,
  which answers `index.html` and lets the SPA route it as today.
- A public route loads its data, renders the same component tree the browser will hydrate, and injects the markup,
  the per-page `<title>`, `<meta name="description">`, Open Graph tags and a canonical link into the built shell.
  The shell is read from the assets binding rather than hardcoded, so Vite's hashed filenames stay correct.

**No token is ever sent.** The render is anonymous by construction, which is both what makes it correct (it cannot
leak a `management` block into a shared page) and what makes it cacheable.

**Three failure shapes, deliberately different.** A 404 from the API renders a real 404 with a real body — the SPA
fallback cannot, since it answers 200 with the shell for every unknown path, telling a crawler a deleted episode
still exists. An API that is unreachable or 5xx ships the **shell, uncached**: the SPA boots, calls the API itself,
and shows the retry every screen already has. A 500 would turn a failure the client survives into a dead page.

**Caching.** `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` on a rendered page. An anonymous render
is identical for everyone, so the edge absorbs crawlers and unfurls without touching a Durable Object.

### 4.5 What the client changes

- **`main.tsx` splits.** `App` moves to `app.tsx`; `main.tsx` stays the browser entry. The Worker cannot import a
  module that calls `render()` at import time.
- **Hydration, not re-render.** The server serialises what it loaded into the document; the client hydrates from it
  and refetches afterwards. Without this the SPA boots into a skeleton and throws away the markup it was handed.
- **The pre-paint theme script moves into `<head>`.** It sits at the end of `<body>` today, which is correct when
  `#app` is empty and wrong the moment there is server markup above it: the browser can paint a summary in light
  theme before the script sets `data-readingtheme`.
- **`lib/public-routes.ts` is shared** by the Worker and the client, so the two can never disagree about which URLs
  are public.

### 4.6 Crawling, and the limit on it

- **`robots.txt`** allows `/`, `/sources`, `/sources/:id` and `/read/:id`; disallows `/queue`, `/history`, `/chats`,
  `/account`, `/curate`, `/sign-in` and `/auth/callback`.
- **`sitemap.xml`** is generated by the Worker from the catalog: every channel in the public list and every
  `available` episode, each with its publish date. Cached like a page.
- **Rate limiting** is Cloudflare's, configured on the public paths at deploy time.

## 5. The consequences to accept

- **A signed-in reader's first paint is the anonymous one.** Hard-loading `/read/abc` serves the cached public render;
  the client then refetches with the token and fills in `related`, `read` and the reader's controls. Correct, and a
  visible settle.
- **A republished summary can be five minutes stale** for signed-out readers. That is the cache doing its job.
- **The summaries are scrapeable, and now indexed.** Already true of the API since 2026-09-21; this makes it
  effective. It is the point of the decision, not a side effect.
- **Two hosting stories become one, at the cost of rewriting the deployed one.** Pages' push-to-deploy and per-branch
  previews are given up. Nothing is deployed today and the repo commits directly to `main`, so neither is in use.
- **The web grows a second rendering path.** Anything that renders differently on the server than the client is a
  hydration bug. The new runner (§3, decisions 16–17) pins the pure modules and asserts the rendered markup carries
  the summary text; it does not exercise hydration in a browser, which stays a `wrangler dev` walkthrough.
- **`pnpm check` gets slower and `apps/web` gets a `test` script**, so a failing web test now blocks the gate that
  has never had one.
- **A hidden channel is reachable by link but absent from the list.** Two rules where one would be simpler, and a
  comment has to say so or it reads as a bug.

## 6. Acceptance criteria

1. With no session, `/`, `/sources`, `/sources/:id` and `/read/:episodeId` all render content — not a redirect to
   `/sign-in`, and not an empty shell.
2. `curl` on each of the four returns HTML containing the page's real text: a channel title, an episode title, the
   executive summary.
3. Each of the four carries its own `<title>`, `<meta name="description">`, `og:title`, `og:description` and
   `<link rel="canonical">`, and no two pages share a title.
4. No rendered page contains `management`, `processing`, a `reviewNote`, or a follower's email address.
5. `/sources` lists approved and paused channels only; a requested or declined channel is absent.
6. `/sources/:id` for a requested or declined channel returns 200 with its episodes and no `reviewNote`.
7. `/read/:episodeId` for an episode of a declined channel returns 200 with the summary.
8. A channel page lists `available` and `pending` episodes, and no `failed` or `skipped` one.
9. An unknown episode id returns **404** with a rendered body, not 200 with the shell.
10. With the API binding made to fail, a public URL returns 200 with the shell and the client shows its own error
    and retry.
11. The guarded routes — `/queue`, `/history`, `/chats`, `/account`, `/curate` — return the shell from the Worker
    and redirect to `/sign-in` in the browser with no session.
12. The invitation band is present on all four public pages and absent for a signed-in reader.
13. Signing in from `/read/:episodeId` returns to that episode, now with the reader's nav, `Done` and `Ask`.
14. A signed-in reader loading `/` is sent to `/queue`.
15. `/robots.txt` disallows every guarded path; `/sitemap.xml` lists every public channel and every available
    episode, and no hidden channel.
16. A rendered page carries `s-maxage`; the unavailable-API response carries `no-store`.
17. Static assets (`/assets/*.js`, `/fonts/*`) are served without invoking the Worker.
18. `pnpm build` output contains no Zod (the existing rule), and the server bundle imports no browser-only API.
19. `pnpm test` runs in `apps/web` and covers `matchPublicRoute` (every public path and a guarded one), both list
    filters, the head-tag builder's escaping, and the loader's three outcomes.
20. A render test asserts the returned HTML contains the episode title and the executive summary, which is also the
    check that would fail if the server bundle reached for `window`.
21. The landing page renders every channel the catalog holds, with no cap and no *See all* link.

## 7. Out of scope

Link-preview images (§3, decision 14). A cross-channel "latest episodes" page and the public API read it would need.
Any change to a reader's screens beyond the `main.tsx` split. A visitor-facing Follow, Ask or Add a channel.
Proxying the API through the web origin, and the single-origin deployment behind it (`auth-phase.md` §8).
Component and DOM tests (§3, decision 17).

**Paging the landing page's catalog**, deferred with its cap and its *See all* link (§3, decision 2a). At today's
size every channel fits; the three of them return together when it stops fitting, and `/sources` — which already
pages at 25 — is the pattern to copy when they do.

Both of this spec's open questions were closed by the owner on 2026-09-21, the day it was written.

## 8. `AGENTS.md`, `docs/design.md` and PRD alignment

- **PRD §2** — a visitor is a new actor: may read the catalog and every summary, may do nothing else. The section
  describes only the owner and the reader today.
- **PRD §3** — the web is a Worker with static assets, not Pages, with a service binding to the API.
- **PRD §7 Screens** — four screens gain a signed-out rendering, described per §4.1; the entry for `/` changes from
  the sign-in screen to the landing page, and `/sign-in` is added.
- **PRD §9** — one entry per decision in §3, including the two struck the same day and why.
- **PRD §10** — this sits between the Auth phase and M6, carries no number for the reason the Design phase carries
  none, and M6's §8 sweep gains the criteria in §6.
- **`docs/design.md`** — a new section for the signed-out shell: the band, the nav beneath it, the four states each
  public screen owes, and the rule that a visitor is shown no control they cannot use.
- **`AGENTS.md`** — the repo layout gains `apps/web/wrangler.jsonc`, `src/server/` and `test/`; the web section's
  routing note changes from `wrangler pages dev` to `wrangler dev`; the Environments section gains the web's three;
  the deploy commands change; and **the Testing section is rewritten**: "`apps/web` has typecheck and lint only"
  becomes Vitest in a Node environment over pure modules and the server render, with components still verified by
  hand under `pnpm dev` and the `node --experimental-strip-types` note retired.
