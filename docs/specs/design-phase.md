# Feature spec — The Design phase: a visual system, and the reader's product rebuilt on it

**Implements:** the unnumbered Design phase of `docs/PRD.md` §10, which sits between M3 and M4.
**Written:** 2026-09-14, against `main` at `f86ebfb`. PRD §7 governs the screens, §4.4 the read model, §9 the eleven
decisions this phase rests on.
**Wireframes:** `https://claude.ai/code/artifact/61ac5352-ede9-49ba-a5e2-792dbeb76557` — twenty-six artboards over
four pages (Architecture, Reader, Owner, Chats), each screen drawn at two sizes and at 390 px.
**Status:** APPROVED 2026-09-15. Both §4.1 dependency questions are answered: fonts are self-hosted, and icons ship
as `lucide-preact` rather than inlined path data. Plan: `docs/specs/design-phase-plan.md`, whose steps were reordered
the same day so the two API steps run before the Tailwind install. Nothing implemented.

## 1. Summary

The web has five screens built during M2 and M3 against a text-only rule that no longer applies. This phase replaces
the rule with a system: a small set of tokens, two families, one icon set, and a component library the repo has
already chosen but never installed. It is not a reskin. The information architecture changes underneath it, because
the wireframes exposed three things the old shape could not carry — a digest that expanded every summary inline and
so could not be a queue, a 24-hour window that made anything older unreachable, and one Home page holding three
unrelated jobs. §9 of the PRD records those decisions; this spec turns them into a contract.

Two boundaries keep the phase finite. **Chats are designed but not built here** — the artboards exist so the system
is proven against M4's hardest screen, and M4 builds them. And **owner operations are desktop only**, so Curate has
one breakpoint rather than two.

## 2. What the wireframes settled

Eleven decisions, all recorded in PRD §9 on 2026-09-14 and all reflected in the artboards:

| | Decision | Consequence here |
|---|---|---|
| 1 | No role gate; the owner is a reader with one extra destination | One nav, `/curate` added for the owner, controls beside the objects they govern |
| 2 | Only **Done** marks a summary read | Every read route becomes pure; one explicit write records the receipt |
| 3 | A summary gets its own screen and URL | `/read/:episodeId`, and a single-episode read on the API |
| 4 | Home splits into Queue and Sources; chats get `/chats` | Four reader destinations, not one page with jump links |
| 5 | The 24-hour window is dropped; days are kept | `/digest` loses its clamp, gains a range and a cursor |
| 6 | Unread and History are two views over one receipt | No `archived_at`; History is where a receipt can be undone |
| 7 | A calendar cell is a date first | Dated cells, four states, full accessible names, arrow-key traversal |
| 8 | Every screen is designed at two sizes | Search, sort, status tabs and pagination are part of the contract, not polish |
| 9 | Owner operations are desktop only | No Curate on a phone; Account says what waits and where to do it |
| 10 | An accessibility floor the design carries itself | 4.5:1, a 12 px type floor, 44 px targets, state never in colour alone |
| 11 | Lucide icons, monograms where artwork is missing | No third-party artwork fetches; a deterministic fallback that needs no data |

## 3. Decisions this spec makes

- **The visual system lives in one file.** `apps/web/src/styles.css` holds the Tailwind import, the daisyUI plugin,
  one custom theme, and the token block. No second stylesheet, no CSS-in-JS, no per-component `<style>`.
- **Icons are a dependency: `lucide-preact`** (owner decision 2026-09-15, which is the approval hard rule 1 asks
  for). I had recommended copying the twenty glyphs in use as path data; the owner took the library, and it is the
  better call for a UI still being designed — a glyph the next feature needs is an import rather than a trip to a
  website, the set stays internally consistent, and tree-shaking keeps only what is imported. `Icon.tsx` shrinks to
  the defaults the design fixes: sizes 16 / 20 / 24, stroke-width 2, `currentColor`.
- **The three reading themes are not daisyUI themes.** Light, sepia and dark apply to the reading surface through a
  `data-reading-theme` attribute and its own token block, so the one-custom-theme rule stands untouched.
- **The web keeps typecheck and lint only.** Component behaviour is verified by hand under `pnpm dev`, as
  `AGENTS.md` → Testing requires; the API changes below carry the tests.
- **Day boundaries are computed in the browser.** The API takes instants and never a timezone; the client asks for a
  range it has already worked out locally. This is what keeps `/digest` free of date logic.

## 4. Contract

### 4.1 The visual system

**Tokens** (`styles.css`, as CSS custom properties, consumed by the daisyUI theme):

| Token | Value | Use |
|---|---|---|
| `--ground` | `#fdfcfa` | the page |
| `--panel` | `#ffffff` | cards, tables, sheets |
| `--ink` | `#1b1917` | primary text, 16:1 |
| `--ink-2` | `#57524c` | body and secondary text, 8:1 |
| `--ink-3` | `#726b63` | metadata and labels, 5.3:1 |
| `--rule` | `#e6e1d9` | row rules |
| `--edge` | `#ddd8d0` | borders and controls |
| `--accent` | `#35618f` | links and interactive text, 6.4:1 |
| `--owner` | `#8a6a1f` | owner-only affordances, 5.0:1 |
| `--consequence` | `#8f3a34` | Decline and Skip only, 7.5:1 |

`#a29c93` and paler are **non-text only** — dots, hatches, disabled swatches. The tertiary grey that carried most
secondary labels in the first drafts sat at 2.8:1; it is gone from text.

**Type.** IBM Plex Sans for chrome; Source Serif 4 for everything a reader reads — titles, excerpts, summaries, chat
answers. Both **self-hosted** (owner decision 2026-09-15) as woff2 under `apps/web/public/fonts` with `@font-face` and
`font-display: swap`, latin subset, with their OFL licence files: Plex Sans at 400 and 600, Source Serif 4 as its
variable face. A Google Fonts stylesheet would tell a third party when each reader sat down to read, and this product
does not make those requests (PRD §1). The alternative considered and rejected was system stacks — free, and duller
where it matters most, since the system serif on Windows is Times New Roman and the reading column is the product.

**Icons.** `lucide-preact`, imported by name at the point of use, at stroke-width 2 with round caps and joins,
rendered at 16, 20 or 24 px. The set the wireframes use: `chevron-left/right/up/down`, `plus`, `check`, `search`,
`calendar`, `list`, `list-filter`, `message-square`, `circle-plus`, `circle-alert`, `table`, `external-link`,
`rotate-cw`, `x`. Reach for another Lucide glyph when a new feature needs one; never draw your own, and no emoji
anywhere. `Icon.tsx` holds the size and stroke defaults so no screen sets them by hand.

**Avatars.** A deterministic monogram: one or two letters from the channel title, on a tint chosen by hashing the
channel id into a fixed six-entry palette drawn from the tokens. No network request, no stored artwork, no layout
shift. `components/Avatar.tsx`, sizes 20 / 28 / 34 / 46.

**daisyUI.** One custom theme named `digest`, all 35 built-ins excluded, per `AGENTS.md` → Web UI code. Components
used: `badge`, `status`, `stat`, `table`, `collapse`, `skeleton`, `avatar`, `modal` (native `<dialog>` only), `tabs`
**unused** as the rule requires — section navigation stays anchors.

### 4.2 Routes

| Route | Screen | Note |
|---|---|---|
| `/` | Sign in | unchanged in behaviour; restyled |
| `/queue` | Unread | the reader's home; `/home` is gone |
| `/read/:episodeId` | Reading view | new |
| `/history` · `/history/2026-09-12` | History | new; the day is an address, with its year |
| `/sources` · `/sources/:id` | Sources, one source | `/channel/:id` is gone |
| `/account` | Account | new; carries what was scattered in the header |
| `/curate` · `/curate/:id` | Curate, channel review | `/owner` and `/owner/channels/:id` are gone; desktop only |
| `/chats` · `/chats/:id` | Chats | designed here, built in M4 |

Nav is Queue, Sources, Chats, and — for the owner, on a viewport wide enough — Curate with a count that renders only
when something waits. Account is the monogram in the corner, never a nav item.

### 4.3 The read model

Three API changes, all of them removals or additions of the same shape:

- `GET /digest` **stops recording read receipts** and so does `GET /channels/:id/episodes`. Every read route is pure.
  `wasUnread` becomes `read`, which describes the row rather than the request that fetched it.
- `POST /channels/:channelId/episodes/:episodeId/read` records the receipt; `DELETE` removes it. Eligibility is
  unchanged — an active follower of an approved channel — and a call from anyone else records nothing and answers
  404, exactly as the old implicit rule did. `summary_reads` already holds `episode_id` and `read_at`; no migration.
- `GET /channels/:channelId/episodes/:episodeId` returns one episode with its summary, related items and read state,
  so `/read/:episodeId` is a deep link that works on a cold load.

### 4.4 Queue and History

One route serves both views. `GET /digest` takes:

| Parameter | Meaning |
|---|---|
| `unread` | `true` for the queue, absent for history |
| `from`, `to` | ISO instants, the reader's local day boundaries; no clamp and no default window |
| `channelId` | repeatable; the channel filter |
| `cursor`, `limit` | availability-ordered paging, newest first, default 50, max 200 |
| `compact` | omits summary bodies, so five weeks of calendar costs one small response |

`since` is removed. Day grouping happens in the client, from `summaryAvailableAt`. A summary's day is permanent; a
day's *contents* are the reader's current eligible follows, so unfollowing a channel removes its rows from every past
day and refollowing restores them along with their receipts (PRD §4.4).

**Queue** shows only rows with no receipt, grouped by day, with a channel filter, a density switch and a check on
each row that marks it done without opening it. It ends with what is waiting, not a fade: *That is everything
waiting — 312 summaries sit in History.* **History** shows everything eligible by day, navigated by a five-week
calendar of dated cells, and is the only place a receipt can be undone.

### 4.5 The reading view

One 680 px column. Channel, title, published date, duration, `Watch` in the bar exactly once. The executive summary
sets as a lede; the takeaways are the body, each with its timestamp hanging in the left margin as a
`youtu.be/<id>?t=` link; tags; related titles filtered to eligible channels. Chrome is a back arrow, `Aa` (closed
until pressed: type, size, theme), `Watch`, and `Done`. A scroll-progress rule sits at the top. **Nothing on this
screen writes anything until Done**, which records the receipt and advances to the next unread.

### 4.6 Sources, and one source

Sources holds Following, Catalog and Declined as tabs with counts, a search field, and a sort order — most unread,
recently active, name, longest followed — paging at 25. **Adding a channel is three steps**: paste an id; verify it
against the long-form feed, which reports the title, how many of the newest fifteen are long-form, and when the
newest landed; then decide. A reader files a request at step three; the owner gets title, import count and note in
the same place, which is the one-step approval §7 already describes. One source shows its episodes newest-published
with their phrases, paging by year on a long history.

### 4.7 Account

Which email is reading, and the only Switch account in the product. Reading preferences — type, size, theme — kept
per browser. `system_rules` as one free-text field, labelled as applying to chat answers alone. A toggle that turns
every count off for a reader who would rather not be kept score of. And, for the owner on a phone, one line saying
how many things wait in Curate and that they need a larger screen.

### 4.8 Curate, desktop only

Needs you, Catalog, Reviewed — unchanged in content from M3.7, restyled and given what a long table needs: status
filters, a sorted column, 25 rows at a time. Needs you never paginates. Three things the built screens lack:

- **Declining an approved channel confirms**, naming the follower count and what those readers lose (§7 already
  requires the confirmation; the screen never showed it).
- **Busy and unavailable are visible.** An action in flight shows it; an unavailable one carries its reason on the
  row, as Retry does while an attempt is under an hour old.
- **A failed refresh says so**, naming the time the numbers are from, rather than showing stale counts as live.

Safe actions stay `--accent`; Decline and Skip wear `--consequence`. **Skip renders on failed episodes only**, per
§7; a pending episode offers Retry alone.

### 4.9 Chats — designed, built in M4

The artboards define the conversation (a rail of chats beside one transcript, roles in the left gutter, no bubbles,
up to three source cards per reply), the states (pending, failed, the fixed no-follows reply, an answer with a
linkified YouTube URL, and what unfollowing does to an old answer), the first run, and the phone. A chat is named by
its first question; nothing generates a title. `Try again` resends the same question as a new attempt and keeps the
failed reply above it. Three gaps M4 must close, all recorded here: no route sets `chats.title`, no route searches
chats, and no chat can be deleted.

### 4.10 The accessibility floor

Text meets 4.5:1. Nothing bearing meaning is under 12 px, uppercase labels included. Every control a finger reaches
is 44 px. **State is never colour alone**: rows say "read" or "unread" in words at full contrast, a calendar day
still holding something is bold and underscored before it is tinted, and no row is dimmed with opacity to mean
anything. The calendar is a grid with arrow-key traversal and a full date in every cell's accessible name.

## 5. Acceptance criteria

1. `pnpm build` produces a bundle with no Zod in `apps/web/dist`, and the daisyUI theme is the only theme in it.
2. Every route in §4.2 deep-links and reloads under `wrangler pages dev`.
3. `GET /digest` and `GET /channels/:id/episodes` record no receipt; a test asserts a summary stays unread after both.
4. `POST …/read` records one and `DELETE …/read` removes it; an ineligible caller gets 404 and writes nothing.
5. `GET /channels/:id/episodes/:episodeId` answers a single episode with summary, related and read state.
6. `/digest` honours `from`/`to`/`unread`/`channelId`/`cursor`/`compact`, has no clamp, and rejects a range it cannot
   page.
7. The queue shows no row carrying a receipt; History shows both and undoes one.
8. Done on the reading view records the receipt and lands on the next unread; the back arrow records nothing.
9. Skip renders on failed episodes only; declining an approved channel confirms with the follower count.
10. No text under 12 px, no text below 4.5:1, no 44 px target missed, and no state communicated by colour alone —
    checked on every screen at both sizes and at 390 px.
11. `pnpm check` green, and the owner's click-through of the reader screens and Curate under `pnpm dev`.

## 6. Out of scope

Building chats (M4); the three chat routes §4.9 names; channel artwork and any third-party image; a dark theme
outside the reading surface; keyboard shortcuts beyond the calendar grid; animation; offline; the web's test story,
which stays typecheck and lint.

## 7. `AGENTS.md` and PRD alignment

The standing design guide is `docs/design.md`; the system §4.1 defines lives there in durable form, and this spec
is only the phase that installs it. `AGENTS.md` → Web UI code gains the icon and avatar rules and the reading-theme exception, and its screen pointer
moves from `home-read-experience.md` to this spec. PRD §7 Screens is **rewritten** by this phase — it currently
describes what M2 and M3 built — and its route table takes the §4.3 and §4.4 changes. PRD §9's eleven entries need no
edit; they are the input. `docs/specs/home-read-experience.md` and `channel-simplification.md` §7 get a dated line
saying this spec supersedes their screen descriptions, and keep their reasoning.
