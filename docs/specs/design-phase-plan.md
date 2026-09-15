# Implementation plan — The Design phase

**Implements:** `docs/specs/design-phase.md` under `AGENTS.md`; PRD §7, §4.4, §9, §10.
**Written:** 2026-09-14, against `main` at `f86ebfb`.
**Status:** draft, awaiting the owner's approval of the spec. Two dependency questions (spec §4.1) block Step 0:
the font decision, and confirmation that copying twenty Lucide paths is preferred to adding `lucide-preact`.
**Shape:** nine steps. Steps 1 and 2 are API and carry tests; Steps 0 and 3 to 8 are web and carry a hand
walkthrough, because `apps/web` is typecheck and lint only (`AGENTS.md` → Testing). One commit per step, `pnpm check`
green before the next begins. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §5, all eleven criteria.

## Order, and why

The API moves first, because every screen after Step 3 reads from it and rewriting a screen twice is the one waste
this plan can avoid. The shell lands before any screen, so each screen arrives into a finished frame. Curate comes
last: it is the least changed and the only one with no phone breakpoint to hold it up.

### Step 0 — Tailwind, daisyUI, the theme, and the primitives  (size: M)

**Files:** `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/styles.css`,
`apps/web/src/components/Icon.tsx`, `apps/web/src/components/Avatar.tsx`, `apps/web/public/fonts/*`.

- 0.1 Install `tailwindcss`, `@tailwindcss/vite` and `daisyui` — the three already approved in `AGENTS.md` → Web UI
  code, so this adds nothing new. Wire the Vite plugin.
- 0.2 `styles.css`: the Tailwind import, the daisyUI plugin with all 35 built-ins excluded and one theme named
  `digest`, the token block of spec §4.1, and the `data-reading-theme` block for light, sepia and dark.
- 0.3 `Icon.tsx`: one named export per glyph of spec §4.1, Lucide path data, stroke-width 2, `size` prop of 16, 20 or
  24. `Avatar.tsx`: monogram from the title, tint from a hash of the channel id, four sizes.
- 0.4 Fonts per the owner's answer to the §4.1 TODO — woff2 under `public/fonts` with `@font-face`, or system stacks
  and no files.

**Plan decision:** Tailwind's preflight lands here, which restyles the five existing screens to unstyled-looking
before they are rebuilt. That is expected and lasts until Step 8; it is why this phase is one branch of commits
rather than a single release.

**Done when:** `pnpm check` green, `pnpm build` clean, no Zod in `dist`, the theme is the only theme in the CSS.

### Step 1 — The read model becomes explicit  (size: M)

**Files:** `apps/api/src/routes/digest.ts`, `apps/api/src/routes/channels.ts`, `apps/api/src/do/user.ts` (or the
read-receipt module it delegates to), `packages/shared/src/index.ts`, `apps/api/test/*`.

- 1.1 Remove receipt recording from `GET /digest` and `GET /channels/:id/episodes`. Rename `wasUnread` to `read` and
  invert it in the shared schema; both routes return it for an eligible caller and omit it for anyone else.
- 1.2 Add `POST /channels/:channelId/episodes/:videoId/read` and `DELETE` of the same path. Eligibility is the
  existing check; an ineligible caller gets 404 and writes nothing.
- 1.3 Add `GET /channels/:channelId/episodes/:videoId` — one episode with summary, related and read state.
- 1.4 Tests: a summary stays unread after a digest fetch and after an episodes fetch; POST records; DELETE removes;
  an ineligible caller changes nothing; the single-episode route answers the shared shape; `openapi.test.ts` sees
  three new operations and one renamed field.

**Done when:** `pnpm check` green.

### Step 2 — `/digest` becomes a range query  (size: M)

**Files:** `apps/api/src/routes/digest.ts`, `apps/api/src/do/registry/*` (the read model behind it),
`packages/shared/src/index.ts`, `apps/api/test/digest*.test.ts`.

- 2.1 Replace `since` with `from`, `to`, `unread`, `channelId` (repeatable), `cursor`, `limit`, `compact`. Delete
  `MAX_WINDOW_MS` and the default window. Order stays `summaryAvailableAt` descending.
- 2.2 The cursor is the last row's `(summaryAvailableAt, videoId)` — **plan decision:** opaque base64 of that pair,
  so the client never composes one and a change of key is not a breaking change.
- 2.3 `compact` omits summary bodies and related items, leaving `{ videoId, channelId, summaryAvailableAt, read }`.
- 2.4 Tests: unread filters to rows with no receipt; a range returns exactly its days; a cursor pages without
  overlap or gap; `compact` omits bodies; an unfollowed channel's rows leave every past day and a refollow restores
  them with their receipts.

**Done when:** `pnpm check` green, and the route document has no `since`.

### Step 3 — The shell: routes, nav, Account  (size: M)

**Files:** `apps/web/src/main.tsx`, `apps/web/src/components/Nav.tsx`, `apps/web/src/screens/Account.tsx` (sign in),
new `apps/web/src/screens/Settings.tsx`, `apps/web/src/api.ts`.

- 3.1 The routes of spec §4.2. The old paths are deleted, not redirected.
- 3.2 Nav: Queue, Sources, Chats; Curate for the owner above the desktop breakpoint only, with a count that renders
  only when non-zero. The monogram in the corner goes to `/account`.
- 3.3 Account: reading as and Switch account, reading preferences in `localStorage`, `system_rules` through the
  existing preferences routes, the counts toggle, and the owner's desktop-only line.
- 3.4 `api.ts` gains the Step 1 and 2 calls.

**Done when:** `pnpm check` green; every route deep-links and reloads under `wrangler pages dev`.

### Step 4 — Queue and the reading view  (size: L)

**Files:** new `apps/web/src/screens/Queue.tsx` and `Reading.tsx`, new `components/SummaryRow.tsx`,
`components/ChannelFilter.tsx`, `components/DensitySwitch.tsx`; `components/Digest.tsx` and `EpisodeItem.tsx` are
deleted; `lib/copy.ts`, `lib/day.ts` (new, local day boundaries).

- 4.1 Queue: unread only, grouped by local day, channel filter as a searchable menu, density switch, the check on
  each row, and the end-of-queue line pointing at History.
- 4.2 Reading view: the 680 px column of spec §4.5, the `Aa` panel closed by default, `Watch` once, `Done` recording
  the receipt and advancing to the next unread.
- 4.3 The phone breakpoints for both.

**Done when:** `pnpm check` green; a hand walkthrough of open → Done → next, and of the row check.

### Step 5 — History and the calendar  (size: M)

**Files:** new `apps/web/src/screens/History.tsx`, `components/Calendar.tsx`, `lib/day.ts`.

- 5.1 History by day with `/history/2026-09-12` addresses; done rows shown with their state in words; undo.
- 5.2 The calendar: five weeks, dated cells, four states, arrow-key traversal, a full date and counts in each cell's
  accessible name, month stepper, fed by one `compact` request.
- 5.3 The phone sheet.

**Done when:** `pnpm check` green; a walkthrough that undoes a receipt and sees the row return to the queue.

### Step 6 — Sources, and one source  (size: L)

**Files:** `apps/web/src/screens/Sources.tsx` (was `Home.tsx`'s channel half), `screens/Source.tsx` (was
`Channel.tsx`), `components/AddChannel.tsx` rewritten, `components/ChannelList.tsx` deleted.

- 6.1 Tabs, search, sort, paging at 25.
- 6.2 The three-step add: paste, verify against the long-form feed, decide — the owner's title, import count and note
  in the third step, a reader's request instead.
- 6.3 One source: episodes newest-published with their phrases, paging by year, and the owner strip.

**Done when:** `pnpm check` green; a walkthrough that adds a real channel as the owner and as a reader.

### Step 7 — Curate and channel review  (size: M)

**Files:** `apps/web/src/screens/Curate.tsx` (was `Owner.tsx`), `screens/CurateChannel.tsx` (was `OwnerChannel.tsx`),
`components/CatalogTable.tsx`, `AttentionList.tsx`, `RequestQueue.tsx`, `CatalogHealth.tsx`,
`ChannelStatusActions.tsx`, `lib/copy.ts`.

- 7.1 Restyle at the spec's density: 13.5 px cells, full-ink primaries, structure carrying the density.
- 7.2 Status filters, a sorted column, 25 rows at a time; Needs you never paginates.
- 7.3 **Skip renders on failed episodes only** — the current screen offers it on a pending row, which §7 forbids.
- 7.4 The decline confirmation with the follower count, in a native `<dialog>`; busy and unavailable states with
  their reasons; the failed-refresh banner naming the time the numbers are from.
- 7.5 Below the desktop breakpoint, Curate is not reachable and the nav item is absent.

**Done when:** `pnpm check` green; a walkthrough of approve, decline-with-confirm, pause, start, retry and skip.

### Step 8 — The floor, and the documents  (size: M)

**Files:** every screen touched above; `AGENTS.md`; `docs/PRD.md` §7 and its route table;
`docs/specs/home-read-experience.md`, `docs/specs/channel-simplification.md`; this file.

- 8.1 The accessibility pass of spec §4.10 across every screen at both sizes and at 390 px: contrast, the 12 px
  floor, 44 px targets, and state in words rather than colour.
- 8.2 PRD §7 Screens rewritten to the built design; the route table takes the Step 1 and 2 changes; the
  implementation-status note loses "the Design phase … has its architecture approved and nothing built".
- 8.3 `AGENTS.md` → Web UI code gains the icon, avatar and reading-theme rules and repoints its screen reference.
- 8.4 The two superseded specs get a dated line.

**Done when:** `pnpm check` green, `git diff --check` clean, and the record below filled in.

## Risks

- **Preflight makes the middle of this plan ugly.** Between Step 0 and Step 8 the not-yet-rebuilt screens look
  unstyled. Mitigation is order: the shell first, then the screens a reader uses daily, Curate last.
- **`/digest` is the one route with a real behaviour change.** Steps 1 and 2 split it in two so a receipt regression
  and a paging regression cannot arrive in the same commit.
- **The channel filter needs a list the queue does not fetch.** It comes from `GET /follows`, which the shell
  already loads; if that proves awkward the alternative is a `channels` block on the digest response, which is worse
  and is not the first move.
- **Fonts.** Self-hosted files are two more artefacts to keep; system stacks are duller. The TODO is the owner's, and
  nothing else in the plan depends on the answer.
- **A long history makes the calendar's range query the widest read in the product.** `compact` is the mitigation;
  if five weeks of a heavy catalog is still slow, the next move is a per-day count aggregate, not pagination.

## Walkthrough record

_(to be filled in as the steps run)_
