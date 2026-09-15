# Design guide — Media Digest Assistant

**Who this is for.** Anyone designing a screen, a state, or a control in this product. It is the house style and the
reasoning under it, so that a feature designed by someone who has never read the wireframes still looks and behaves
like the rest of the product.

**Where it sits.** `docs/PRD.md` is canonical for *what the product does* — the channel and episode models, the
schema, the API, the acceptance criteria. This document is canonical for *how it looks and behaves*, and is
subordinate to the PRD the way the specs in `docs/specs/` are: if the two disagree, the PRD governs and this file is
the one to fix. Reasoning for a specific phase lives in its spec; `docs/specs/design-phase.md` is the current one.
The wireframes this guide describes are at
`https://claude.ai/code/artifact/61ac5352-ede9-49ba-a5e2-792dbeb76557` — twenty-six artboards, four pages.

**The product, in a paragraph.** People follow YouTube channels. Every new episode is transcribed, summarised into
an executive summary and timestamped takeaways, and lands in the reader's queue. The reader reads the summary rather
than watching the video, and clicks a timestamp when they want the moment itself. One person — the owner — also
approves which channels enter the shared catalog and fixes ingestion when it breaks. There are exactly two roles and
one of them has two jobs.

---

## 1. Principles

These are the arguments you inherit. You may overturn one; you may not ignore it.

**1. Reading is the product. Everything else is administration.**
The reading column is the only part of this product a person is glad to be in. Every other screen exists to get them
there or to keep it stocked. When a screen competes with reading for attention, reading wins.
*This means:* the reading view has no chrome it can live without, and no feature is added to it that does not help
someone read.

**2. One product, two roles — capability attaches to objects, not to sessions.**
There is no role switcher and no owner mode. The owner is a reader who also curates; the five-second decisions live
beside the thing being decided, and the dense administrative work lives at one separate destination, `/curate`.
*This means:* if you are about to add a mode, a "view as", or a second navigation, you are solving the wrong problem.
Put the control next to its object, or put the screen in Curate.

**3. The queue answers one question: what still needs me.**
Anything else — what arrived, when, from whom, what I already read — is History. Mixing the two produces a list that
answers neither.
*This means:* nothing with a read receipt appears in the queue, ever, not even greyed out.

**4. State is a fact, not a feeling.**
A reader should be able to tell what is going on from the words, in greyscale, with the sound off. Colour is the
third signal and never the only one; opacity is not a state.
*This means:* a row says "read" or "unread"; a calendar day still holding something is bold and underscored before
it is tinted; a disabled control says why it is disabled, on the row.

**5. Design at two sizes.**
Volume, not layout, is what breaks these screens. A chip per channel is elegant at six follows and four lines of
chrome at thirty; a list of days is fine for a week and useless for a year.
*This means:* every screen is drawn twice — a handful and a lot — before it is called done. The controls that carry a
long list (search, sort, tabs, pagination, a calendar instead of a list) are part of the design, not a later fix.

**6. Density comes from structure, not from small type.**
Curate is allowed to look like a tool. It is not allowed to be 11 px.
*This means:* when a screen feels crowded, take out a column, group the rows, or paginate. Do not shrink the text.

**7. Words are design.**
Every user-facing phrase lives in `apps/web/src/lib/copy.ts`. The component library supplies form; we supply words.
*This means:* if your design needs a new phrase, it is a change to that file and it is reviewed like any other design
decision. A state without a sentence is not finished.

---

## 2. The visual system

### 2.1 Colour

| Token | Value | Contrast on ground | Use |
|---|---|---|---|
| `--ground` | `#fdfcfa` | — | the page |
| `--panel` | `#ffffff` | — | cards, tables, sheets, popovers |
| `--ink` | `#1b1917` | 16:1 | titles, primary text, active nav |
| `--ink-2` | `#57524c` | 8:1 | body, excerpts, secondary text |
| `--ink-3` | `#726b63` | 5.3:1 | metadata, labels, captions |
| `--rule` | `#e6e1d9` | — | rules between rows |
| `--edge` | `#ddd8d0` | — | borders on controls, cards, inputs |
| `--accent` | `#35618f` | 6.4:1 | links, interactive text, unread emphasis |
| `--owner` | `#8a6a1f` | 5.0:1 | owner-only affordances, and nothing else |
| `--consequence` | `#8f3a34` | 7.5:1 | Decline and Skip, and nothing else |

`#a29c93` and anything paler is **non-text**: dots, hatching, an inactive swatch. The colour that carried most
secondary labels in the first drafts measured 2.8:1 and had to be removed from text everywhere.

Three colours carry meaning and are never decorative. Blue is "you can act on this". Amber is "this is yours because
you are the owner". Red is "someone else feels this" — it appears on exactly two actions in the whole product.

### 2.2 Type

Two families. **IBM Plex Sans** for chrome — navigation, controls, tables, metadata, labels. **Source Serif 4** for
everything a person reads for its meaning — titles, excerpts, summaries, takeaways, chat answers, empty-state
sentences. The split is the fastest way to tell a reader what is content and what is furniture.

| Role | Size / family | Notes |
|---|---|---|
| Reading title | 36 px serif 600, `-0.015em`, 1.16 | 25 px on a phone |
| Screen title | 27 px serif 600, `-0.01em` | Queue, Sources, Curate |
| Section head | 18–19 px serif 600 | day headers, chat titles |
| Row title, full | 20 px serif 600, 1.25 | 17 px on a phone |
| Row title, compact | 16 px serif 600, one line, ellipsis | the density switch trades the excerpt, never the title |
| Lede | 19 px serif, 1.58, `--ink-2` | the executive summary on the reading view |
| Body | 17 px serif, 1.55 | takeaways, chat answers |
| Excerpt | 15 px serif, 1.5, `--ink-2` | three lines maximum in a row |
| UI base | 13.5–14 px sans | nav, buttons, inputs |
| Table cell | 13.5 px sans | Curate |
| Meta | 12.5 px sans, `--ink-3` | counts, times, states |
| Label | 12 px sans uppercase, `0.09em`, `--ink-3` | the floor; nothing meaningful is smaller |

**12 px is the floor for anything bearing meaning**, uppercase labels included — they are the hardest to read small,
so they get the floor, not an exception below it.

### 2.3 Space, shape, and line

A 4 px base. Page padding 32 px desktop, 20 px phone. The reading column is 680 px; list columns are 760 px; the
right rail is 232 px, or 288 px when it holds a calendar. Rows are 18 px of vertical padding at full density and
9 px compact. Sections are 20–26 px apart.

Radii: 3 px on controls, 4 px on cards and inputs, 6 px on a modal, 50% on avatars. Borders are 1 px `--edge`; row
rules are 1 px `--rule`. One shadow, and only on things that float: popovers, sheets, modals.

### 2.4 Icons

**Lucide**, at stroke-width 2, round caps and joins, on the 24-unit grid, rendered at 16, 20 or 24 px. The set in use
is small and deliberate: `chevron-*`, `plus`, `check`, `search`, `calendar`, `list`, `list-filter`, `message-square`,
`circle-plus`, `circle-alert`, `table`, `external-link`, `rotate-cw`, `x`. Add one by name from Lucide; do not draw
your own, and do not use emoji anywhere in the product.

### 2.5 Avatars

A **deterministic monogram**: one or two letters from the channel title on a tint derived from a hash of the channel
id, out of a fixed six-entry palette. Nothing in this product stores channel artwork and there is no permitted source
to fetch it from, so a grey disc would be a promise the data cannot keep. Sizes 20 / 28 / 34 / 46.

### 2.6 Components

daisyUI 5 on Tailwind 4, with **one custom theme** and all 35 built-ins excluded, so the product inherits no
recognisable default look. Four rules that are not preferences — they are build constraints and their home is
`AGENTS.md` → Web UI code; they are here because they shape what you can design:

- the native `<dialog>` modal method only — never the checkbox or anchor variants, which lose escape-to-close and
  focus containment;
- `tabs` unused: section navigation is anchors, so a link is a link and a reload works;
- every user-facing phrase in `lib/copy.ts`;
- component behaviour is ours to verify by hand, because daisyUI is CSS only and the web has no tests.

### 2.7 Reading themes

The reading surface — and only the reading surface — offers light, sepia and dark, through a `data-reading-theme`
attribute with its own token block. This is not a product-wide dark mode and does not touch the daisyUI theme.

---

## 3. Layout patterns

**The frame.** A 56 px top bar: wordmark, then Queue · Sources · Chats (and Curate for the owner, desktop only, with
a count that renders only when something waits), then the reader's email and monogram on the right. Content is
centred. A right rail carries navigation *about* the list — days still waiting, the calendar, a sort order — never
content.

**A summary row.** Monogram, then: channel and when it became readable, in uppercase meta; the title in serif; up to
three lines of the executive summary as the excerpt; a meta line of takeaway count, episode length, read time, and
the publication date when it differs from the day it arrived. A check at the right marks it done without opening it.
The excerpt is always the executive summary, never a takeaway.

**The reading column.** Channel, title, a meta line, the lede set off by a rule, then the takeaways as the body with
their timestamps hanging in the left margin as links into the video. Tags, then related titles. Chrome is a back
arrow, `Aa`, `Watch` once, and `Done`.

**Tables** (Curate only). 13.5 px cells, primary text at full ink, secondary at `--ink-2`, a sorted column marked in
its header, status filters above, 25 rows at a time. Actions are text, not buttons, but they carry the padding and
the weight to be found and to be hit.

**Sheets** (phone). Anything that would be a popover on a desktop is a bottom sheet on a phone: the channel picker,
the date picker. A handle, a title, a search field where the list is long, and a two-button footer where the primary
action names what it will do — "Show these two", "Go to 12 September".

**Empty, loading, error, stale.** Four states, all of them designed, none of them a spinner alone:
an empty queue says *You are through everything* and points at History; loading uses skeleton rows of the real row's
shape; an error says what failed and offers the retry; and a screen showing data it could not refresh says so and
names the time the data is from, because acting on stale numbers is how an owner gets a refusal they do not
understand.

---

## 4. Interaction rules

- **44 px** minimum for anything a finger reaches. On a desktop, an action in a table row still needs vertical
  padding to be a target rather than a word.
- **Confirm only what someone else feels.** Declining an approved channel confirms, and the confirmation names the
  follower count and what those readers lose. Pausing, starting a run and retrying do not confirm — they are
  reversible and affect nobody.
- **Busy and unavailable are visible.** An action in flight shows it and says who started it. An unavailable one
  carries its reason on the row — "available in 46 min" — never a dead grey control.
- **Undo lives where the consequence is visible.** A read receipt can be undone in History, where the row is, and
  nowhere else.
- **Filters are never sticky across sessions.** A quiet screen must never be a filter someone forgot they set.
- **Nothing is written by looking.** Opening a summary, following a deep link, or paging through history records
  nothing. An explicit Done is the only write.

---

## 5. The scale playbook

What changes as the catalog grows. Design the second column before you ship the first.

| | A handful | A lot |
|---|---|---|
| Filter by channel | — | one control opening a searchable list, sorted by what is unread |
| Sections | stacked with headings | tabs with counts |
| A long list | scroll | search, a sort order, 25 at a time |
| Days | a list of days | a five-week calendar, whose height does not grow |
| A channel's history | scroll | paging by year |
| Rows | full, with an excerpt | a density switch that drops the excerpt, never the title |
| Chats | a rail | the rail groups by recency and gains search |
| A table | rows | status filters and a sorted column |

The rule underneath: **a control whose size grows with the data is not a control.** That is why the calendar replaced
a list of days, and why a chip row per channel became a menu.

---

## 6. Mobile

Every **reader** screen has a phone breakpoint: queue, reading, history, sources, one source, account, the
nothing-waiting state, and both pickers as sheets. **Owner operations are desktop only** — there is no Curate tab on
a phone, and Account tells the owner how many things wait and that they need a larger screen. Approving, declining,
retrying and the catalog table are dense, consequential and rare; designing them twice costs more than it returns.

Three rules: a bottom tab bar of three items with 44 px targets; no fake status bar and no fake keyboard in a
mockup — the real ones render on top of your layout; and nothing scrolls horizontally except a table, a diagram, or a
code block inside its own container.

---

## 7. The accessibility floor

Not a review stage. It is part of "done".

- Text meets **4.5:1** against its background. Check it; the paper palette makes it easy to drift pale.
- Nothing bearing meaning is under **12 px**, uppercase labels included.
- Every control a finger reaches is **44 px**.
- **State is never colour alone.** Words first, then weight or shape, then colour.
- Every grid is keyboard-traversable, and every cell has a full accessible name — "12 September 2026, 3 summaries,
  3 unread", not "12".
- Focus is visible, with an offset outline, on everything focusable.
- The design must survive greyscale. If you cannot read it without colour, it is not finished.

---

## 8. Designing a feature here

1. **Find the question the screen answers.** One question. If it is two, it is two screens — that is how Queue and
   History came apart.
2. **Read the PRD section that governs it.** The behaviour is already decided more often than you expect; §4 is the
   functional requirements and §7 the screens.
3. **Check the contract.** Does the API return what your design shows? Does it accept what your design writes? A
   control the contract forbids — Skip on a pending episode, say — is a bug that reaches production as a 409.
4. **Draw it twice**: a handful and a lot. Then draw the phone, unless it is owner-only.
5. **Draw the four states**: empty, loading, error, stale.
6. **Write the words.** Every phrase, in `lib/copy.ts` form. If you cannot write the sentence, the state is not
   understood yet.
7. **Walk the floor** (§7) before you call it done.
8. **Hand over**: the artboards, the phrases, the contract changes your design needs, and the open questions you did
   not settle — named, not buried.

---

## 9. Decided, and open

**Decided** (PRD §9, 2026-09-14, in one day of review): no role gate; only Done marks read; a summary has its own
URL; Home split into Queue and Sources; the 24-hour window dropped; Unread and History as two views over one receipt;
a calendar cell is a date first; design at two sizes; owner operations desktop only; the accessibility floor; Lucide
and monograms.

**Open, and yours to close if you get there first:**

- Whether losing a read summary from History when its channel is unfollowed surprises people enough to change the
  rule. Today History renders current eligible follows; the receipt survives and returns on a refollow.
- Chat titles: nothing sets `chats.title`, so a chat is named by its first question. Either a rename route or drop
  the column.
- Chat search, which the rail's search box needs and no route provides.
- Chat deletion: nothing deletes a chat, and the rail only grows.
- Fonts: self-hosted files or system stacks.

---

## 10. Where things are

| | |
|---|---|
| What the product does | `docs/PRD.md` — §4 behaviour, §5 schema, §7 screens and routes, §9 decisions |
| How to work in the repo | `AGENTS.md` — hard rules, layout, toolchain, testing, code style |
| Reasoning for a phase | `docs/specs/<name>.md` and its `-plan.md`; the current one is `design-phase` |
| The wireframes | `https://claude.ai/code/artifact/61ac5352-ede9-49ba-a5e2-792dbeb76557` |
| Tokens and theme | `apps/web/src/styles.css` |
| Every user-facing phrase | `apps/web/src/lib/copy.ts` |
| Icons and avatars | `apps/web/src/components/Icon.tsx`, `Avatar.tsx` |
