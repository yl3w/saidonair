# Implementation plan — The Design phase

**Implements:** `docs/specs/design-phase.md` under `AGENTS.md`; PRD §7, §4.4, §9, §10.
**Written:** 2026-09-14, against `main` at `f86ebfb`.
**Status:** APPROVED 2026-09-15 with both dependency questions answered — fonts are self-hosted, and `lucide-preact`
is the icon dependency (owner decision, hard rule 1 satisfied). **All nine steps implemented 2026-09-15.** What is still owed is the owner's own walkthrough; see the record. What each step actually landed, and what it owes, is in the record at the end of this file.
**Shape:** nine steps, reordered 2026-09-15 so the two API steps come first. Steps 1 and 2 are API and carry tests; Steps 3 to 9 are web and carry a hand
walkthrough, because `apps/web` is typecheck and lint only (`AGENTS.md` → Testing). One commit per step, `pnpm check`
green before the next begins. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §5, all eleven criteria.

## Order, and why

**The two API steps come first, and the install comes after them** (reordered 2026-09-15). The first draft opened
with the Tailwind install, because every screen needs the primitives — but Tailwind's preflight makes all five
existing screens look broken the moment it lands, and Steps 1 and 2 do nothing to fix that. Since neither API step
needs a single token, moving them first means a session can end after Step 2 with the API ready, the tests green and
the app visually untouched. Everything from Step 3 on is one continuous run: install, shell, then the screens, so the
ugly middle stays inside one sitting.

After that the order is the old one. The shell lands before any screen, so each screen arrives into a finished frame;
the screens a reader uses daily come before the rest; and Curate is last, being the least changed and the only one
with no phone breakpoint to hold it up.

### Step 1 — The read model becomes explicit  (size: M)

**Files:** `apps/api/src/routes/digest.ts`, `apps/api/src/routes/channels.ts`, `apps/api/src/do/user.ts` (or the
read-receipt module it delegates to), `packages/shared/src/index.ts`, `apps/api/test/*`.

- 1.1 Remove receipt recording from `GET /digest` and `GET /channels/:id/episodes`. Rename `wasUnread` to `read` and
  invert it in the shared schema; both routes return it for an eligible caller and omit it for anyone else.
- 1.2 Add `POST /channels/:channelId/episodes/:episodeId/read` and `DELETE` of the same path. Eligibility is the
  existing check; an ineligible caller gets 404 and writes nothing.
- 1.3 Add `GET /channels/:channelId/episodes/:episodeId` — one episode with summary, related and read state.
- 1.4 Tests: a summary stays unread after a digest fetch and after an episodes fetch; POST records; DELETE removes;
  an ineligible caller changes nothing; the single-episode route answers the shared shape; `openapi.test.ts` sees
  three new operations and one renamed field.

**Done when:** `pnpm check` green.

### Step 2 — `/digest` becomes a range query  (size: M)

**Files:** `apps/api/src/routes/digest.ts`, `apps/api/src/do/registry/*` (the read model behind it),
`packages/shared/src/index.ts`, `apps/api/test/digest*.test.ts`.

- 2.1 Replace `since` with `from`, `to`, `unread`, `channelId` (repeatable), `cursor`, `limit`, `compact`. Delete
  `MAX_WINDOW_MS` and the default window. Order stays `summaryAvailableAt` descending.
- 2.2 The cursor is the last row's `(summaryAvailableAt, episodeId)` — **plan decision:** opaque base64 of that pair,
  so the client never composes one and a change of key is not a breaking change.
- 2.3 `compact` omits summary bodies and related items, leaving `{ episodeId, channelId, summaryAvailableAt, read }`.
- 2.4 Tests: unread filters to rows with no receipt; a range returns exactly its days; a cursor pages without
  overlap or gap; `compact` omits bodies; an unfollowed channel's rows leave every past day and a refollow restores
  them with their receipts.

**Done when:** `pnpm check` green, and the route document has no `since`.

### Step 3 — Tailwind, daisyUI, the theme, and the primitives  (size: M)

**Files:** `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/styles.css`,
`apps/web/src/components/Icon.tsx`, `apps/web/src/components/Avatar.tsx`, `apps/web/public/fonts/*`.

- 3.1 Install `tailwindcss`, `@tailwindcss/vite`, `daisyui` and `lucide-preact` — the first three already approved
  in `AGENTS.md` → Web UI code, the fourth approved by the owner on 2026-09-15. Wire the Vite plugin.
- 3.2 `styles.css`: the Tailwind import, the daisyUI plugin with all 35 built-ins excluded and one theme named
  `digest`, the token block of spec §4.1, and the `data-reading-theme` block for light, sepia and dark.
- 3.3 Icons come from `lucide-preact`, imported by name at the point of use; `Icon.tsx` holds only the size and
  stroke defaults the design fixes (16 / 20 / 24, stroke-width 2, `currentColor`), so no screen sets them by hand.
  `Avatar.tsx`: monogram from the title, tint from a hash of the channel id, four sizes.
- 3.4 Fonts: IBM Plex Sans 400 and 600 and the Source Serif 4 variable face, latin subset, as woff2 under
  `public/fonts` with `@font-face` and `font-display: swap`, plus their OFL licence files. No third-party request.

**Plan decision:** Tailwind's preflight lands here, which restyles the five existing screens to unstyled-looking
before they are rebuilt. That is expected and lasts until Step 9; it is why Steps 3 to 9 want to run together.

**Done when:** `pnpm check` green, `pnpm build` clean, no Zod in `dist`, the theme is the only theme in the CSS.

### Step 4 — The shell: routes, nav, Account  (size: M)

**Files:** `apps/web/src/main.tsx`, `apps/web/src/components/Nav.tsx`, `apps/web/src/screens/Account.tsx` (sign in),
new `apps/web/src/screens/Settings.tsx`, `apps/web/src/api.ts`.

- 4.1 The routes of spec §4.2. The old paths are deleted, not redirected.
- 4.2 Nav: Queue, Sources, Chats; Curate for the owner above the desktop breakpoint only, with a count that renders
  only when non-zero. The monogram in the corner goes to `/account`.
- 4.3 Account: reading as and Switch account, reading preferences in `localStorage`, `system_rules` through the
  existing preferences routes, the counts toggle, and the owner's desktop-only line.
- 4.4 `api.ts` gains the Step 1 and 2 calls.

**Done when:** `pnpm check` green; every route deep-links and reloads under `wrangler pages dev`.

### Step 5 — Queue and the reading view  (size: L)

**Files:** new `apps/web/src/screens/Queue.tsx` and `Reading.tsx`, new `components/SummaryRow.tsx`,
`components/ChannelFilter.tsx`, `components/DensitySwitch.tsx`; `components/Digest.tsx` and `EpisodeItem.tsx` are
deleted; `lib/copy.ts`, `lib/day.ts` (new, local day boundaries).

- 5.1 Queue: unread only, grouped by local day, channel filter as a searchable menu, density switch, the check on
  each row, and the end-of-queue line pointing at History.
- 5.2 Reading view: the 680 px column of spec §4.5, the `Aa` panel closed by default, `Watch` once, `Done` recording
  the receipt and advancing to the next unread.
- 5.3 The phone breakpoints for both.

**Done when:** `pnpm check` green; a hand walkthrough of open → Done → next, and of the row check.

### Step 6 — History and the calendar  (size: M)

**Files:** new `apps/web/src/screens/History.tsx`, `components/Calendar.tsx`, `lib/day.ts`.

- 6.1 History by day with `/history/2026-09-12` addresses; done rows shown with their state in words; undo.
- 6.2 The calendar: five weeks, dated cells, four states, arrow-key traversal, a full date and counts in each cell's
  accessible name, month stepper, fed by one `compact` request.
- 6.3 The phone sheet.

**Done when:** `pnpm check` green; a walkthrough that undoes a receipt and sees the row return to the queue.

### Step 7 — Sources, and one source  (size: L)

**Files:** `apps/web/src/screens/Sources.tsx` (was `Home.tsx`'s channel half), `screens/Source.tsx` (was
`Channel.tsx`), `components/AddChannel.tsx` rewritten, `components/ChannelList.tsx` deleted.

- 7.1 Tabs, search, sort, paging at 25.
- 7.2 The three-step add: paste, verify against the long-form feed, decide — the owner's title, import count and note
  in the third step, a reader's request instead.
- 7.3 One source: episodes newest-published with their phrases, paging by year, and the owner strip.

**Done when:** `pnpm check` green; a walkthrough that adds a real channel as the owner and as a reader.

### Step 8 — Curate and channel review  (size: M)

**Files:** `apps/web/src/screens/Curate.tsx` (was `Owner.tsx`), `screens/CurateChannel.tsx` (was `OwnerChannel.tsx`),
`components/CatalogTable.tsx`, `AttentionList.tsx`, `RequestQueue.tsx`, `CatalogHealth.tsx`,
`ChannelStatusActions.tsx`, `lib/copy.ts`.

- 8.1 Restyle at the spec's density: 13.5 px cells, full-ink primaries, structure carrying the density.
- 8.2 Status filters, a sorted column, 25 rows at a time; Needs you never paginates.
- 8.3 **Skip renders on failed episodes only** — the current screen offers it on a pending row, which §7 forbids.
- 8.4 The decline confirmation with the follower count, in a native `<dialog>`; busy and unavailable states with
  their reasons; the failed-refresh banner naming the time the numbers are from.
- 8.5 Below the desktop breakpoint, Curate is not reachable and the nav item is absent.

**Done when:** `pnpm check` green; a walkthrough of approve, decline-with-confirm, pause, start, retry and skip.

### Step 9 — The floor, and the documents  (size: M)

**Files:** every screen touched above; `AGENTS.md`; `docs/PRD.md` §7 and its route table;
`docs/specs/home-read-experience.md`, `docs/specs/channel-simplification.md`; this file.

- 9.1 The accessibility pass of spec §4.10 across every screen at both sizes and at 390 px: contrast, the 12 px
  floor, 44 px targets, and state in words rather than colour.
- 9.2 PRD §7 Screens rewritten to the built design; the implementation-status note loses "the Design phase … has
  its architecture approved and nothing built"; and the route table takes **every** change this phase made, which is
  more than the two API steps (amended 2026-09-15, after Steps 4 and 5 each turned out to need a route the plan had
  assumed existed):
  - **Step 1** — `GET /digest` and `GET /channels/:id/episodes` record no receipt and report `read` rather than
    `wasUnread`; three new rows: `GET /channels/:id/episodes/:episodeId`, and `POST` and `DELETE` of
    `/channels/:id/episodes/:episodeId/read`.
  - **Step 2** — the `GET /digest?since=<iso>` row becomes `GET /digest` with `from`, `to`, `unread`, repeatable
    `channelId`, `cursor`, `limit` and `compact`, no default window and no clamp, answering a `compact`-discriminated
    body with `nextCursor`. Its "**Changing (§9)**" annotation goes: it has changed.
  - **Step 4** — `GET` and `PUT /preferences` were listed but had never been registered; they exist now, so the row
    stops being aspirational.
  - **Step 7** — one new row, `GET /channels/feed?channelId=`: what YouTube's two feeds say about an id, read on
    demand and stored nowhere, so the middle of the three-step add can show a reader what they are adding.
  - **Step 5** — one new row, `GET /episodes/:episodeId`. `/read/:episodeId` names the episode and not its channel,
    so the channel-scoped single-episode read cannot serve a cold load; `episodes.episode_id` is a catalog-wide
    primary key, so an episode names itself. The channel-scoped twin stays, for callers that already know the
    channel and want a mismatch to be a 404.
  - The `:episodeId` spelling throughout is the 2026-09-15 rename, already recorded in §9.
- 9.3 `AGENTS.md` → Web UI code gains the icon, avatar and reading-theme rules and repoints its screen reference.
- 9.4 The two superseded specs get a dated line.

**Done when:** `pnpm check` green, `git diff --check` clean, and the record below filled in.

## What the acceptance criteria say now

Spec §5, and where each stands:

| | Criterion | |
|---|---|---|
| 1 | No Zod in `dist`, one theme in the CSS | checked, every build |
| 2 | Every route deep-links and reloads under `wrangler pages dev` | checked, fifteen paths |
| 3–6 | The read model and the range query | 332 tests |
| 7–9 | Queue, Done, undo, Skip only on failed, the decline confirmation | built; the owner's walkthrough is what confirms them |
| 10 | The floor: 12 px, 4.5:1, 44 px, state never in colour alone | scanned; the 44 px rule gained its scope |
| 11 | `pnpm check` green, and the owner's click-through | half: the gate is green, the click-through is owed |

## Risks

- **Preflight makes the middle of this plan ugly.** From the moment Step 3 lands until Step 9, the not-yet-rebuilt
  screens look unstyled. Two mitigations: the API steps are in front of it, so a natural stopping point exists before
  any of it starts; and inside it, the shell comes first, then the screens a reader uses daily, Curate last.
- **`/digest` is the one route with a real behaviour change.** Steps 1 and 2 split it in two so a receipt regression
  and a paging regression cannot arrive in the same commit.
- **The channel filter needs a list the queue does not fetch.** It comes from `GET /follows`, which the shell
  already loads; if that proves awkward the alternative is a `channels` block on the digest response, which is worse
  and is not the first move.
- **Fonts.** Three woff2 files and two licence files are now artefacts the repo keeps current. Small, but real: a
  face that is never updated is a face that quietly diverges from the foundry's.
- **A long history makes the calendar's range query the widest read in the product.** `compact` is the mitigation;
  if five weeks of a heavy catalog is still slow, the next move is a per-day count aggregate, not pagination.

## Record

What each step landed, and what it still owes. The step bodies above are left as they were approved; where one
turned out to be wrong about the world, the correction is here rather than rewritten into the plan.

| Step | Commit | Note |
|---|---|---|
| 1 | `8b8a3d7` | As planned. `apps/web` took the one mechanical rename it needed to typecheck. |
| 2 | `b63b82a` | As planned. `compact` needed its own response shape, so `DigestResponse` became a union discriminated on `compact`; `unread` is filtered in the route, not the Registry, because receipts live in the User DO. |
| 3 | `5a337dd` | As planned. Two decisions written into `docs/design.md`: the six avatar tints (§2.5) and the daisyUI slot mapping, including that there is no green (§2.6). |
| 4 | `ea5fff7` | **4.3 was wrong: there were no "existing preferences routes".** PRD §7 has listed `GET`/`PUT /preferences` since the restart, and the shared schemas, the User DO methods and their migration were all written — but no handler was ever registered, so Account's one server-backed field had nothing to call. Both routes were added here with tests. |
| 5 | `6c60b03` | **§4.5's deep link could not work as specified.** `GET /channels/:channelId/episodes/:episodeId` needs a channel id that `/read/:episodeId` does not carry, so a cold load had nothing to call; `GET /episodes/:episodeId` was added. |
| 6 | `56bfd69` | **The calendar steps five weeks, not a month** — a month view is four, five or six rows and `docs/design.md` §5 asks for a height that does not grow; the heading names the months covered. Also closed a Step 5 shortfall now that `Sheet` existed: the channel filter is a bottom sheet on a phone (§3), which moves when the choice lands — a popover applies each tap, a sheet applies on its footer button. `lib/day.ts` was checked in node against the two days a year that are not 24 hours long. |

| 7 | `7c9b59a` | **A third route the plan assumed existed.** §4.6's middle step — verify against the long-form feed — had nothing to call: `POST /channels` verifies but creates and follows in the same breath, which would add a channel to the shared catalog on every paste. `GET /channels/feed?channelId=` reads both public feeds, counts the overlap and stores nothing. The add box left Curate for Sources, where §4.6 puts it. |

| 8 | `1afde9e` | **8.3 was already right.** The plan said the built screen offered Skip on a pending row; both the channel screen and the attention list already gated it on `status === "failed"` — a *wireframe* was what got it wrong, and §4.8's rule is what kept it out of the rebuild. The decline confirmation moved from `window.confirm` to a native `<dialog>` naming what followers lose; an unavailable Retry carries its reason on the row; a screen that could not refresh names how old its numbers are. `Owner.tsx` / `OwnerChannel.tsx` became `Curate.tsx` / `CurateChannel.tsx`, and with this every class name in the app resolves in the built CSS — the unstyled middle is over. |

| 9 | — | The floor was walked with a scanner rather than by eye: every type size, every colour pairing, and every interactive element. Three findings — a 10 px count in a calendar cell, ten standalone links and one search input under 44 px, and the inline retries, which became one `Retry` control. Nothing failed contrast. **The 44 px rule needed a scope**, so `docs/design.md` §7 now says what it applies to: every button, form control and standalone link, but not a link inside a sentence or the title of a row or heading, which are text sized by the type scale. The documents took the phase's four new routes, the rewritten §7 Screens, the Web UI rules for icons, avatars, reading themes, per-browser settings and day boundaries, and a dated supersession line on the two older specs. |

**Owed: the owner's click-through** (spec §5, criterion 11) — open → Done → next, the row check, the undo in History,
the three-step add as owner and as reader, and approve / decline-with-confirm / pause / start / retry / skip in
Curate. It needs a dev catalog with summaries in it, and the local Durable Objects were wiped on 2026-09-15 for the
`episodeId` rename, so it waits on the next ingestion. Everything checkable without one has been checked: `pnpm check`
green at every step, `pnpm build` clean with no Zod and one theme in `dist`, every route deep-linking and reloading
under `wrangler pages dev`, every `class=` token in the app resolving in the built CSS, `lib/day.ts` verified against
the two days a year that are not 24 hours long, and the API exercised under `wrangler dev` on throwaway state.

**Why both gaps got through review.** A spec is reviewed against the PRD, and in both cases the PRD is where the
mistake already was: it listed a route nothing had registered, and it described a single-episode read in prose that
reads correctly and does not survive contact with the address bar. `test/openapi.test.ts` cannot catch either — it
fails when a *registered* route is missing from the document, never when a documented route was never registered.
Worth a thought before the next phase's plan is written.
