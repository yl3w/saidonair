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

**Which is which, made operational** (2026-09-15, PRD §9). Beside the object go the acts that are **reversible**,
**felt by nobody else**, and **prompted by looking at the thing** — noticing a channel has gone stale, or is too
noisy. At the destination go the **decisions**: the ones other people feel, the ones driven by a queue rather than
by browsing, and the ones that need a form or context the object's own page does not carry. Approving is the test
case that makes the line obvious — nobody browses to a channel in order to approve it, and approval carries a title,
an import count and a note that only Curate asks for. A bare Approve button beside the object was a worse version of
the same act, not a convenience.

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
| `--ink-2` | `#47433e` | 9.6:1 | body, excerpts, secondary text |
| `--ink-3` | `#615b55` | 6.5:1 | metadata, labels, captions |
| `--rule` | `#e6e1d9` | — | rules between rows |
| `--edge` | `#ddd8d0` | — | borders on controls, cards, inputs |
| `--accent` | `#35618f` | 6.4:1 | links, interactive text, unread emphasis |
| `--owner` | `#7a5d1b` | 6.0:1 | owner-only affordances, and nothing else |
| `--consequence` | `#8f3a34` | 7.5:1 | Decline and Skip, and nothing else |

`#a29c93` and anything paler is **non-text**: dots, hatching, an inactive swatch. The colour that carried most
secondary labels in the first drafts measured 2.8:1 and had to be removed from text everywhere.

Three colours carry meaning and are never decorative. Blue is "you can act on this". Amber is "this is yours because
you are the owner". Red is "someone else feels this" — it appears on exactly two actions in the whole product.

### 2.2 Type

Two families, self-hosted as woff2 — never from a font CDN, which would tell a third party when each reader sat down
to read. **IBM Plex Sans** for chrome — navigation, controls, tables, metadata, labels. **Source Serif 4** for
everything a person reads for its meaning — titles, excerpts, summaries, takeaways, chat answers, empty-state
sentences. The split is the fastest way to tell a reader what is content and what is furniture.

| Role | Size / family | Notes |
|---|---|---|
| Reading title | 36 px serif 600, `-0.015em`, 1.16 | 25 px on a phone |
| Screen title | 27 px serif 600, `-0.01em` | History and a channel — the screens the frame does not name. **Account lost its heading 2026-09-17**: the reader's own email and monogram sit in the bar and mark it current, so the frame does name it after all |
| Section head | 18–19 px serif 600 | day headers, chat titles |
| Row title, full | 20 px serif 600, 1.25 | 17 px on a phone |
| Row title, compact | 16 px serif 600 | a channel's name in a list — Sources, a feed just verified |
| Lede | 19 px serif, 1.58, `--ink-2` | the executive summary on the reading view |
| Body | 17 px serif, 1.55 | takeaways, chat answers |
| Excerpt | 15 px serif, 1.5, `--ink-2` | three lines maximum in a row |
| UI base | 13.5–14 px sans | nav, buttons, inputs |
| Table cell | 13.5 px sans | Curate |
| Meta | 12.5 px sans, `--ink-3` | counts, times, states |
| Label | 12 px sans uppercase, `0.09em`, `--ink-3` | the floor; nothing meaningful is smaller |

**12 px is the floor for anything bearing meaning**, uppercase labels included — they are the hardest to read small,
so they get the floor, not an exception below it.

**The Label token also names a group of things.** A chat message's role sits in it, and so does the line above a
reply's source cards. The rule is what the word may claim: a label names what the group *is*, never what it did —
the cards under an answer say "Based on" and not "Sources", because the model chooses which excerpts to lean on and
nothing downstream can verify that each one was used (`docs/specs/chat-relevance-rerank.md` §4.6). A label that
overstates is worse than no label, because a reader trusts the smaller type as machine fact.

### 2.3 Space, shape, and line

A 4 px base. Page padding 32 px desktop, 20 px phone. The reading column is 680 px; list columns are 760 px; the
right rail is 232 px, or 288 px when it holds a calendar. Rows are 18 px of vertical padding — one height, in
every list that draws them (§9). Sections are 20–26 px apart.

Radii: 3 px on controls, 4 px on cards and inputs, 6 px on a modal, 50% on avatars. Borders are 1 px `--edge`; row
rules are 1 px `--rule`. One shadow, and only on things that float: popovers, sheets, modals.

### 2.4 Icons

**Lucide**, through `lucide-preact`, at stroke-width 2 with round caps and joins, rendered at 16, 20 or 24 px —
`Icon.tsx` fixes those defaults so no screen sets them by hand. The set in use is small and deliberate: `chevron-*`,
`plus`, `check`, `search`, `calendar`, `list`, `list-filter`, `message-square`, `circle-plus`, `circle-alert`,
`table`, `external-link`, `rotate-cw`, `pause`, `play`, `minus`, `square-pen`, `x`. When a feature needs another, take it from
Lucide by name; never draw your own, and never use emoji anywhere in the product.

**When a control may be a glyph instead of a word** (2026-09-15, PRD §9). All three have to hold: it is
**reversible**, so a mis-tap costs nothing; the glyph is **conventional**, meaning the reader has met it in other
software rather than learning it here; and it is **used often enough to be learnt**. Pause and resume qualify;
checking a feed does, on `rotate-cw`. A decision somebody else feels never does — and for withdrawing approval
there is no honest glyph in any case, since `x`, `ban` and `circle-minus` all read as *delete* and a withdrawal
deletes nothing. The word is still the control's name: a glyph takes it as its accessible name and its tooltip, and
a list with room for the word uses the word. **A mixed group is the point, not a compromise** — two quiet glyphs
beside one red word say which acts are knobs and which is a decision, without a divider.

**Amber marks an owner power only where a reader's controls sit beside it.** On a channel's page the owner's glyphs
are `--owner` and the reader's follow is the accent, so one line carries both and says which is which; on Curate,
where every control belongs to the owner, amber would mark nothing, and the accent is right. A mark that never
varies marks nothing (2026-09-15, PRD §9).

Following is `plus` and unfollowing `minus`, not the commoner `plus`/`check`, because **`check` already means "mark
this summary done"** and one glyph with two meanings on screens a reader crosses in a session is worse than a long
word. Beware the `user-*` family here: `user-plus` means *add a person*, and on screens that also count followers it
would read as "add a follower". **A reader's own act is a bordered box; the owner's are bare** — the personal and
catalog-wide separation carried by form. Where a glyph names a specific thing, its accessible name names that thing
too: "Follow Computerphile", never twenty-five buttons all called "Follow".

### 2.5 Avatars

A **deterministic monogram**: one or two letters from the channel title on a tint derived from a hash of the channel
id, out of a fixed six-entry palette. Nothing in this product stores channel artwork and there is no permitted source
to fetch it from, so a grey disc would be a promise the data cannot keep. Sizes 20 / 28 / 34 / 46.

The six tints (added 2026-09-15, when the palette had to become real code). They are **identity, never state**, which
is why none of them may be read as one of the three colours that carry meaning: every one is pale and low in chroma,
and no meaning colour is ever used as a fill. Each carries its own ink, at 6.9:1 or better on its own tint.

| | Tint | Ink | |
|---|---|---|---|
| 1 | `#e7e2d8` | `#4a443b` | stone |
| 2 | `#dee5dc` | `#3f4a40` | sage |
| 3 | `#ece0d8` | `#55463c` | clay |
| 4 | `#dfe2ea` | `#434a57` | dusk |
| 5 | `#e3e6d6` | `#474c38` | moss |
| 6 | `#e8dfe6` | `#4f4350` | plum |

One letter for a one-word title, two initials otherwise — Computerphile is C, New York Times Podcasts is NY. The
letters are a visual aid and never the only name: a channel's title is always beside its mark, so the mark is hidden
from assistive technology, and that is what lets the 20 px size carry 11 px letters without breaking the 12 px floor.
The hash is FNV-1a over the channel id, so one channel is the same colour on every screen and for every reader.

### 2.6 Components

daisyUI 5 on Tailwind 4, with **one custom theme** and all 35 built-ins excluded, so the product inherits no
recognisable default look.

**Every daisyUI slot is one of the §2.1 tokens**, so no colour outside this guide can reach a screen: our `--accent`
is daisyUI's `primary` and `info`, our `--owner` is its `accent` and `warning`, our `--consequence` is its `error`,
`--ink` is `neutral`, `--panel` is `base-100` (so card, modal, table and popover land on white with no class of their
own) and `--ground` is `base-200` and the page. **There is no green**: `success` is the accent, because the product
has no success colour and a colour nobody designed is worse than a repeated one. Write `text-primary` rather than
reaching for `--accent` directly — daisyUI owns the name `accent`, and the token is the one place they could drift.

**Customize through daisyUI's own variables; never with utilities on top of its classes.** A daisyUI component is
a small state machine, not a bag of declarations. `.btn` resolves its background from `--btn-bg`, and `:hover` works
by *reassigning that variable*; `.input` and `.select` resolve their border from `--input-color`; every size in the
library is `--size-field` or `--size-selector` times a whole number. Put `bg-panel` beside `btn` and you pin
`background-color` directly — and because Tailwind's own utilities sit in an unnamed sub-layer of `utilities` while
daisyUI's sit in `daisyui.l1.l2.l3`, the utility wins on layer order regardless of specificity, and the hover
resolves into nothing. That is not a theoretical risk: it is how this product shipped 43 buttons with no hover state
on any of them (2026-09-17).

So the division is absolute:

| Lives in | What |
|---|---|
| the `@plugin "daisyui/theme"` block | every colour slot, `--radius-*`, `--border`, `--depth`, `--noise`, and **`--size-field`, which is where the 44 px floor of §7 comes from** — not a `min-h-11` at thirty call sites |
| a Tailwind `@utility` in `styles.css` | a variant daisyUI has no name for, written as daisyUI writes its own: set `--btn-color`, `--btn-fg`, `--btn-border`, `--input-color`, never `background-color` |
| the call site | daisyUI's classes, and **layout only** — `flex`, `gap`, `mt-*`, `w-*`, `shrink-0` |

A colour, border, background, radius or type size on an element that already carries a daisyUI class is a bug, not a
preference. Where daisyUI already has the variant, use its name rather than rebuilding it: the owner's amber pill is
`badge badge-outline badge-warning`, and it was `badge badge-sm border-owner bg-transparent text-meta text-owner`
until someone checked.

**Pick the component before the classes.** `.btn` is a button: it centres its text and sets weight 600, which is
right for a control and wrong for a row. Dressing the channel filter's rows as `btn btn-ghost btn-block
justify-start` looked correct in the markup and shipped three channel names each starting at a different left edge,
because `justify-start` moves the flex children and `text-align: center` still centres the text inside the one that
grows (2026-09-17). A list of choices is `.menu`, which aligns to the start and leaves the weight alone. The check
that catches this is opening the screen — no audit of class names will, because the classes were not the mistake.

**Two things stay ours, and both were measured rather than assumed** (2026-09-17). daisyUI's `.label` sets its
colour to 60% of whatever it inherits, which takes a `--ink-3` form label to about 2.6:1 and fails §7 outright — so
form labels are plain elements, and a label that *wraps* its control sets `cursor-pointer` itself, since the control
inside it cannot speak for the words beside it. And navigation is anchors, per the rule below: the nav, the section
tabs and every in-sentence link are `.link`/`link-primary` or plain `<a>`, never `.btn`, which would dress a
destination as a button and lose what a link is for.

Four rules that are not preferences — they are build constraints and their home is
`AGENTS.md` → Web UI code; they are here because they shape what you can design:

- the native `<dialog>` modal method only — never the checkbox or anchor variants, which lose escape-to-close and
  focus containment;
- `tabs` unused: section navigation is anchors, so a link is a link and a reload works;
- every user-facing phrase in `lib/copy.ts`;
- component behaviour is ours to verify by hand, because daisyUI is CSS only and the web has no tests.

### 2.7 Themes

Light, sepia and dark, and they apply to **the whole product** — nav, queue, history, sources, Curate's tables, every
modal (owner decision 2026-09-15, reversing this section, which had said "the reading surface, and only the reading
surface"). A reader who wants to read in the dark wants to *use* the product in the dark; a light chrome around a
dark column is the worst of both.

A theme is a block of token values and nothing else. Every colour in the product is one of §2.1's tokens and every
utility resolves through `var(--token)`, so a theme redefines the tokens under one attribute on `<html>` and no
component knows which one is on. daisyUI's own slots are redefined with them, or its components would stay light.

| | light | sepia | dark |
|---|---|---|---|
| `--ground` | `#fdfcfa` | `#f3ead7` | `#16181b` |
| `--panel` | `#ffffff` | `#faf3e3` | `#1e2127` |
| `--ink` | `#1b1917` | `#241f18` | `#e9e7e3` |
| `--ink-2` | `#47433e` | `#463c30` | `#cac6c1` |
| `--ink-3` | `#615b55` | `#5c503f` | `#a9a49d` |
| `--rule` | `#e6e1d9` | `#ded0b4` | `#2e3136` |
| `--edge` | `#ddd8d0` | `#d2c3a4` | `#3c4149` |
| `--accent` | `#35618f` | `#2d567f` | `#8fb6e3` |
| `--owner` | `#7a5d1b` | `#6f5313` | `#d7b262` |
| `--consequence` | `#8f3a34` | `#8a2f28` | `#ee9d95` |

Every value was derived and measured, not picked: each theme's six text colours against both its grounds, the
inverted calendar cell, and all six avatar monograms on their own tints (§2.5 lists the light six; sepia and dark
have their own). **The palest across all three is 6.01:1** and nothing is below the 4.5:1 floor. **Add a colour and
you owe three values and their measurements**, or the product has a theme it was never checked in.

**The secondary ramp was darkened on 2026-09-15** (PRD §9), because the palette had been putting its palest colour
on its smallest type: `--ink-3` carries the 12 px label and the 12.5 px meta line and sat at 5.12:1, and `--owner`
at 4.92:1 carried the owner's marks. Both passed the floor — WCAG's 4.5:1 does not scale with size below 18.66 px,
so a 12 px label and a 17 px paragraph are held to the same number, which is how a compliant palette ends up hard
work at the small end. `--ink-2` moved with `--ink-3` rather than staying put: at 6.5:1 alone, `--ink-3` would have
come within 1.15:1 of it and the two levels would have collapsed into one colour with two names. **The step between
them is unchanged in every theme** — 1.47, 1.37, 1.46 — so only the floor rose.

**Type is the reader's too.** `--font-reading` is the family everything written to be read uses — the serif by
default, the sans when they ask for it — and `--reading-scale` multiplies the content type roles alone, so the
chrome keeps its own scale and the 12 px floor holds at every setting. The smallest content role at the smallest
setting is a 15 px excerpt at 0.92, which is 13.8 px.

The three attributes are set on `<html>` by `lib/settings.ts`, and again by a small script in `index.html` before
first paint, so dark never starts white.

---

## 3. Layout patterns

**The frame.** A 56 px top bar: wordmark, then Queue · Sources (and Curate for the owner, desktop only, with
a count that renders only when something waits), then the reader's email and monogram on the right.
**A screen that is *about* one object takes its own bar instead** — a way back on the left, that object's own acts
on the right, and no wordmark and no destinations (2026-09-15, PRD §9). **The bar takes its column's measure**, not
the window's (2026-09-17): its contents line up with what is beneath them, so a reading column's bar is 680 px and a
channel's is 760 px. A bar that spans the window puts the way back at the edge of the screen and the acts at the
other edge, which reads as chrome belonging to the product rather than to the thing on the page. The reading column has always done this;
a channel's page does too. A destination a reader *navigates to* keeps the nav; a page they *opened something to
get to* carries the way back out. Back is the browser's own, because that is what "the page I came from" means —
a remembered path is wrong the moment someone presses the browser's back button — with a real fallback for a
reader who arrived by a pasted link and has nowhere to return to.
**Primary navigation carries only what a reader can use** — Chats joined it on 2026-09-16, in the commit that built
the screen, having been absent rather than present-and-empty until then, because one destination leading to a
placeholder makes the ones that work read as unfinished too (owner decision 2026-09-15, PRD §9). Content is
centred. A right rail carries navigation *about* the list — days still waiting, the calendar, a sort order — never
content.

**A screen is named where the frame does not name it** (2026-09-15, PRD §9). The bar carries Queue · Sources ·
Curate and marks the current one in words, in weight and in a rule; below 768 px the same words are in the tab bar.
Neither ever scrolls away — one is sticky, the other fixed — so a 27 px heading repeating that word is a constant on
the one screen it names, which is the fault a queue row's "Unread" was. Those three carry their name as an
`sr-only` heading and lead with what is theirs: the channel filter, the Sources tabs, and in Curate the first
section itself — its three anchor links went out with the heading, being a table of contents over three headings
already on the screen. **History keeps a visible title** — it is in neither bar, it is reached by a link, and on a day it *is* the day. This is the row rule
one level up: a row is identified by what its list does not already say, a screen by what the frame does not.
Taking a name off the screen is not deleting it (§7), and it has to go somewhere: **every route names itself in the
tab** — `Queue · Said on Air` — which is what a bookmark and the browser's own history menu read.

**A line of facts.** Counts, dates, durations and states, separated by a middle dot — under a title, under a
channel's name, beside a row. **The separator belongs to the line, not to an item**: give the dot its own element
inside the row's gap, so the space either side of it matches and any item can drop out from anywhere without
leaving a stray mark at the front. The dots are hidden from assistive technology. One component, `MetaLine`, so
the three places that draw one cannot drift (2026-09-15).

**Facts and controls do not share a line.** A number beside a button is read as a control and pressed; a control
among facts is missed. The one exception the product had — a follower count beside the owner's actions, so a
withdrawal's consequence was visible before it was chosen — ended when withdrawal moved to Curate, and the count
went back among the facts where it belongs.

**A summary row.** The episode's publication date in the uppercase label; the title in serif; up to three lines of
the executive summary as the excerpt; a meta line of takeaway count and episode length, led by "Read" or "Unread"
**in a mixed list**; and, in a mixed list, the channel closing the row on its own line in the same label. A check at
the right marks it done without opening it. The excerpt is always the executive summary, never a takeaway.

**One row, in every list that draws one** (2026-09-15, PRD §9). The queue, a day of History and a channel's page
show the same shape at the same height; there is no second, denser form of it. A long list answers its length by
paging, not by shrinking its rows — the row is what the reader came for, and the control that shrank it was on one
screen out of three.

**A heading is when it reached the reader; a row is when it was published.** The first is a fact about the pipeline
and structures the pile; the second is a fact about the episode and belongs on it (2026-09-15, PRD §9). A row never
states its date twice, so nothing about publication appears in the meta line.

**No mark in a list** (2026-09-15, PRD §9). A monogram opening a row put furniture where the content belongs and
pushed the title 46 px right, and it was a second, weaker copy of a name the row already carries; the mark belongs
where it *identifies* — a Sources row, a channel's header, the reader's own — not where it repeats. What a row must
name goes in the uppercase label: the date opening it, the channel closing a mixed list's. **Not in the meta line** —
a channel title there is sixty characters at 12.5 px and wraps on a phone before it finishes.

**A row is identified by what its list does not already say.** The queue and a day of History mix channels, so the
mark, the name and the arrival time identify a row there. A channel's own page does not, and one monogram repeated
down thirty rows says nothing thirty times — so there the row drops both and leads with its **publication date**,
which is also the order that page is in. The same rule settles the arrival time: when a summary reached *you* is a
queue fact and has no place in a channel's history (2026-09-15, PRD §9).

**Every item on that line is a measured fact, and every one of them can vary.** Two consequences, both settled on
2026-09-15 (PRD §9). There is no reading-time estimate: the takeaway budget bounds a summary tightly enough that the
number could only ever say one, two or three minutes, and said two on nearly every row. And the read state is
printed **in a mixed list and nowhere else** — History and a source, not the queue, whose every row is unread by
definition, and not the reading column, which describes the episode and not the reader's standing with it. Where a
list *is* mixed the word is owed, and §7 is why: the difference between a read row and an unread one may never live
in colour or a dimmed row. Nor is the word printed for a caller the API gave no receipt state to — not following a
channel is not the same as not having read something.

The general rule, and the one to apply to the next thing somebody wants on a row: **a value that cannot vary is not
information, and a guess among facts devalues the facts.** Its corollary, for a page about one thing rather than a
list of them: **say what cannot be inferred.** A channel's page prints its state only when that state is not
"approved and running", because the page's own existence says the rest; a list of channels still prints it on every
row, because there the word tells one row from the next. And **a way out is an action, not a fact**: a link to the
source belongs in the bar, in the shape the reading column uses for `Watch`, never buried among the facts.

**A way out is named for what the thing is**, in this product's nouns — `Episode`, `Channel` — never for the verb
the destination would use or for the destination itself (2026-09-15, PRD §9). Where it goes is the external-link
glyph's job and the tooltip's. Identifiers that happen to be links — a channel id, an episode title — are not
controls and keep being themselves.

**The reading column.** Channel, title, a meta line opening with "Read" or "Unread", the lede set off by a rule, then
the takeaways as the body with their timestamps hanging in the left margin as links into the video. Tags, then
related titles. Chrome is a back arrow, `Aa`, `Watch` once, and `Done`.

The meta line is the episode's own facts — its publication date and its length — and **not the reader's standing
with it**: no "Read", no "Unread". Where someone stands with a summary is a triage fact and belongs where they
triage, on the History row that says the word and carries the Undo (2026-09-15, PRD §9).

**The lede is the opening and carries no heading; every section after it is named**, above its own 1 px rule, in the
12 px uppercase label — Takeaways, Topics, Related (2026-09-15, PRD §9). Three flowing sentences running into a
timestamped list is a change of kind, and a reader should not have to infer it; a bare row of words at the foot of
an article is not self-evidently a set of topics either. The heading carries no count: the row that led here already
gave one, the list is in front of the reader, and counts can be switched off.

The arrow **names the list the summary was opened from** — the queue, a day in History, a source — and returns the
reader to it at the row they left; with no origin, as on a pasted link, it is the queue. `Done` writes the receipt
and goes to the same place, and appears only on a summary that still has none: a read one says so in its meta line,
and its receipt is undone in History, where the row is. A related title moves within the column and leaves the way
out alone (owner decision 2026-09-15, PRD §9, which withdrew `Done`'s advance to the next unread).

**Tables** (Curate only). 13.5 px cells, primary text at full ink, secondary at `--ink-2`, a sorted column marked in
its header, status filters above, 25 rows at a time. Actions are text, not buttons, but they carry the padding and
the weight to be found and to be hit.

**A column earns its place by serving a decision** (2026-09-15, PRD §9). Everything else — counts the system keeps
for itself, the state of an attempt, an internal format name — goes in a **diagnostics row the reader opens on the
one row that needs it**. A column that reads `—` on every healthy row, or the same word on every working one, is a
heading over nothing. The exception is the value that *is* the exception: promote it into the state, where it will
be acted on, and leave its opposite in the diagnostics.

**An action that is available and not advised is quiet, not absent.** `--ink-2` rather than the accent, with a
tooltip saying what it would do. Hiding it would cost the owner a capability; leaving it blue would spend the
meaning of blue, which is "you can act on this".

**A row's cells share a centre line.** Top-aligning them looks right only while every cell is text; put one 44 px
control in the row and the words sit at the top while the control sits in the middle of its own target, and the row
reads as broken. Middle-align the body rows — the control keeps its target and the text meets it (2026-09-15).

**A date is spelled by this product, never by the machine's default.** `toLocaleDateString()` with no options
answered `8/18/2026` beside `14d ago` in the same column, in an order that changes with the reader's locale. Every
date names its month.

**Sheets** (phone). Anything that would be a popover on a desktop is a bottom sheet on a phone: the channel picker,
the date picker, the reading column's `Aa`. A handle, a title, a search field where the list is long, and a footer
whose primary action names what it will do — "Show these two", "Go to 12 September".

**The footer's other button depends on when the content lands.** A sheet holding a draft the footer commits says
"Cancel", because there is something to abandon. A sheet whose controls apply as they are tapped — `Aa`, where the
page behind is the preview — has no primary action at all, and its one button says where it goes: "Back to reading".
Never "OK", and never "Done" on the reading view, where Done is the receipt and sits inches away.

**One shape at a time.** A popover and its sheet are the same control in two forms, so only the one in use belongs
in the document. Rendering both leaves duplicate ids, duplicate labels, and — where the control is built from
radios — one group split across two copies, of which the visible half shows nothing selected.

A popover that can only be closed by the button that opened it is a trap, on a touch screen most of all. Every one
closes on Escape and on a press outside it; a sheet is a native `<dialog>` and has both already (§2.6).

**Two views of one set agree, and say so from one derivation.** Where a screen shows both a worklist and the
inventory it is drawn from, a row in the inventory carries a mark saying it is in the worklist — and both read from
the same computed answer, never from two filters written twice (2026-09-15, PRD §9). The mark says only *that* the
row is work: **why** belongs to the columns that own it, and a row that states its reason twice is worse than one
that states it once.

**An empty category does not announce itself.** A screen that lists several kinds of outstanding work shows the
kinds that have some, and says the whole thing is clear **once** — not a heading, a zero and a sentence per kind,
which is what a healthy day looked like in Curate (2026-09-15, PRD §9). The counts belong on the headings that
survive, where they inform.

**Empty, loading, error, stale.** Four states, all of them designed, none of them a spinner alone:
an empty queue says *You are through everything* and points at History; loading uses skeleton rows of the real row's
shape; an error says what failed and offers the retry; and a screen showing data it could not refresh says so and
names the time the data is from, because acting on stale numbers is how an owner gets a refusal they do not
understand.

---

## 4. Interaction rules

- **A control announces itself before it is touched, and acknowledges the touch.** Four states carry that, and one
  of them is not optional because it is the only one a mouse user gets: **at rest** it has the form of a control —
  the bordered box of §2.4, or a glyph sitting in its own 44 px field; **on hover** it changes, quietly — daisyUI's
  7 % darkening, or a ghost button's 10 % ink wash, is the whole effect and enough; **while pressed** it changes
  again, so the click is confirmed before the network is; **disabled** it looks disabled (below). Focus is §7's and
  is already global.

  The **cursor is the last of these and the weakest**. It does not exist on a touch screen, it arrives only after
  the reader has already guessed and moved the mouse there, and it says nothing at all to a keyboard or a screen
  reader. It is a *confirmation of a guess the design already invited*, never the invitation. It comes free with
  `.btn` and every other daisyUI control, which is the only reason to care where it comes from.

  This rule is here because the product shipped without it (2026-09-17). Every control was assembled from raw
  utilities — `flex size-11 items-center justify-center text-ink-2` for an icon button — so there was no hover state
  anywhere in the web app, and the ones built on `.btn` had theirs cancelled by a `bg-panel` beside it (§2.6). The
  missing hand cursor was the only symptom visible enough for anyone to notice, and it was the least of it.

- **44 px** minimum for anything a finger reaches. On a desktop, an action in a table row still needs vertical
  padding to be a target rather than a word.
- **Confirm only what someone else feels.** Declining an approved channel confirms, and the confirmation names the
  follower count and what those readers lose. Pausing, starting a run and retrying do not confirm — they are
  reversible and affect nobody.
- **Work in progress is a state of the thing, not a note beside the button.** **Rewritten 2026-09-17**: this rule
  used to read "an action in flight shows it and says who started it; an unavailable one carries its reason on the
  row — 'available in 46 min' — never a dead grey control", and Curate followed it exactly, to this:
  *"bhaskar.maddala@protonmail.com started this; Retry is available in 60 min."* Three faults, all of them the
  rule's:
  - **It named the reader to themselves.** Owner screens have one owner. Attribute an action only when the actor
    might be someone else, and then only where that matters.
  - **It promised a time the product does not know.** The 60 minutes was the point at which Retry force-takes-over a
    lost background instance; the attempt itself finishes in two or three. A countdown to the wrong event is worse
    than no countdown, and a *deadline* is almost always the wrong event. **Say elapsed, not remaining** — "running
    for 2 min" cannot be wrong, and it needs no estimate the system does not have.
  - **It put the news in a footnote.** The status column still said "Summarised" while the episode was being
    re-summarised, so the row needed a sentence to explain a control. Say it where the state lives — "Re-processing ·
    running for 2 min" — and the disabled control explains itself.

  So: **an in-progress state belongs in the object's own status line and outranks whatever it last came to rest as.**
  A control that is unavailable because of it says nothing at all; a control that is unavailable for a reason the
  reader could act on still carries that reason.
- **An unavailable control must look unavailable.** `disabled` with unchanged colour and weight is a button that
  refuses every press while inviting them, which reads as a broken screen rather than an unavailable action.
- **A screen showing work in progress refreshes itself while it lasts, and only while it lasts.** Everything else
  here reloads when the reader acts, because everything else changes when the reader acts. Background work is the
  exception: it changes on its own, takes minutes, and is usually the reason something is unavailable. A settled
  screen makes no requests.
- **Undo lives where the consequence is visible.** A read receipt can be undone in History, where the row is, and
  nowhere else.
- **A screen gives the reader back to where they came from.** Anything opened out of a list returns to that list, at
  the row, and says which list it is returning to. Where the reader was is remembered by the **row's identity**,
  never by a scroll offset: an unfetched page of "Show more", or the row leaving the list, moves the pixels and
  neither moves the row.
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
| The queue | scroll | fifty at a time behind a Show more, to the end of the range |
| Days | a list of days | a five-week calendar, whose height does not grow |
| A channel's history | scroll | paging by year |
| Rows | full, with an excerpt | the same row — length is answered by paging, not by shrinking it (§9) |
| Chats | a list at `/chats` | grouped by recency, and it gains search — **the rail was dropped 2026-09-17**: a rail carries navigation *about* what is on the page (§3), and a list of other conversations is the only one in the product that would navigate away from it |
| A table | rows | status filters and a sorted column |

The rule underneath: **a control whose size grows with the data is not a control.** That is why the calendar replaced
a list of days, and why a chip row per channel became a menu.

And its twin, which the queue learned the hard way: **a list that stops short is not the list it claims to be.** A
screen answering "what still needs me" may not answer it for the first fifty and then send the reader somewhere that
answers a different question. Paging is what a long list owes; handing the reader to another screen is not paging.
A corollary for anything filtered after it is fetched, as the queue's receipts are: **an empty page is not an empty
list** — say "you are through everything" only when the range is exhausted, never when one page came back short.

---

## 6. Mobile

Every **reader** screen has a phone breakpoint: queue, reading, history, sources, one source, account, the
nothing-waiting state, and both pickers as sheets. **Owner operations are desktop only** — there is no Curate tab on
a phone, and Account tells the owner how many things wait and that they need a larger screen. Approving, declining,
retrying and the catalog table are dense, consequential and rare; designing them twice costs more than it returns.

Three rules: a bottom tab bar of the reader's destinations with 44 px targets — three since Chats was built
(§3); no fake status bar and no fake keyboard in a mockup — the real ones render on top of your layout; and nothing
scrolls horizontally except a table, a diagram, or a code block inside its own container.

---

## 7. The accessibility floor

Not a review stage. It is part of "done".

- Text meets **4.5:1** against its background. Check it; the paper palette makes it easy to drift pale.
- Nothing bearing meaning is under **12 px**, uppercase labels included.
- Every control a finger reaches is **44 px** — every button, every form control, every link that is
  a destination or an action on its own. **Two things are text rather than controls and are sized by
  the type scale instead**: a link inside a sentence, and the title of a row or a heading, which is
  content that happens to be clickable. The line to hold is that a *control* never inherits its size
  from the words in it; clarified 2026-09-15, when the floor was walked for the first time.
- **Every screen has an h1**, drawn or not. A name the design takes off the screen becomes `sr-only`; it is never
  deleted. A document whose first heading is a day group has no name for anyone navigating by headings, and
  `aria-current` in the nav names a link, not the page.
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

**Reversed 2026-09-15:** §2.7's "the reading surface, and only the reading surface" — the reader's theme, type and
size now apply to every page. The three palettes are in §2.7 and were measured before they were applied. And
`Done`'s advance to the next unread — the reading column now returns the reader to the list they opened the summary
from, and offers `Done` only where there is no receipt yet (§3, §4; PRD §9). And the queue's **density switch**,
which was the only place a summary row had two forms — the row now has one shape everywhere (§3, §5; PRD §9).

**Decided 2026-09-17:** the product uses daisyUI rather than re-skinning it (§2.6), and a control owes four states
rather than one (§4). Both came out of a single question — why no button showed the hand cursor — whose answer was
that Tailwind 4 stopped setting it, daisyUI sets it on `.btn`, and this product overrode `.btn` at every call site
with the utilities that also cancelled its hover. The cursor was a symptom of having built the controls twice.

**Open, and yours to close if you get there first:**

- **Whether the row's check should say "Done" in words** (raised 2026-09-15, deferred). It is the only write this
  product makes from a list, and it renders as a bare tick in a box: the owner asked what it was for, which is the
  finding. Three things point the same way — the reading view calls the identical action **Done**, History's read
  rows carry a text **Undo** in the very same column, so one list runs two idioms for two halves of one toggle, and
  principle 7 says words are design. Against it: thirty text buttons are louder in a long list than thirty ticks,
  and `check` is in the icon set on purpose. The accessible name is already right — *Mark "…" done* — so this is
  about what a sighted reader is shown, not about the floor.
- **Whether a source row should say "Following" as a state** (raised 2026-09-15). Today the only sign is the
  button's own verb — a `minus` where a `plus` would be — so telling which of twenty-five channels you follow means
  reading twenty-five controls. An action label is doing a state's job, which §4 says it should not: words first,
  then weight or shape, then colour. The counter is that a row already carries "12 unread" when there is something
  to read, which implies a follow, and a second marker beside it may be noise.
- Whether losing a read summary from History when its channel is unfollowed surprises people enough to change the
  rule. Today History renders current eligible follows; the receipt survives and returns on a refollow.
- ~~Chat titles: nothing sets `chats.title`.~~ Settled 2026-09-17: **a chat is named by its first question**, which
  `/chats` and a conversation's bar both do. The column stays — unset and harmless — because a rename route would
  want it and dropping it costs a migration and a wiped Durable Object to remove something nothing reads.
- ~~Chat search, which the rail's search box needs and no route provides.~~ **Not in this version** (owner decision
  2026-09-17). The rail it was wanted for is gone, so the requirement went with it.
- ~~Chat deletion: nothing deletes a chat, and the rail only grows.~~ **Not in this version** (owner decision
  2026-09-17). The list grows; a reader who wants a conversation gone has no way to get it, which is accepted.
- ~~Fonts: self-hosted files or system stacks.~~ Settled 2026-09-15: self-hosted.

---

## 9b. The signed-out shell

Added 2026-09-21 with the public reading experience (`docs/specs/public-reading.md`). Three screens —
`/`, `/sources/:id` and `/read/:episodeId` — render for a visitor with no session, at the same URLs a reader uses.
`/sources` is **not** among them: signed out it repeated the landing page, and its sort and paging are for working
through a long list rather than arriving at one. This section is the frame they arrive into; the screens themselves are §3 and §5 as before, with the
reader's controls absent.

**Every bar is `bar-column`** (`apps/web/src/styles.css`). A bar belongs to the column beneath it, not to the
window, and the two are measured the same way: the utility carries the page padding inside its own max-width, so a
bar's content box is exactly one measure wide and shares the column's left edge at every width. Writing
`max-w-reading px-8` instead puts the padding *inside* the measure, which is 32 px of drift and 64 px of lost width
— the bug that produced three left edges on the channel screen and, an hour later, on the landing page.

**The leading control in a bar aligns by its glyph, not its box.** A square button is 44 px with no horizontal
padding and its icon is 20 px, so the arrow sits 12 px inside the button's edge and reads as indented against the
column below it. Those buttons carry `-ml-3` to put the glyph on the column's own edge; the 44 px target is
untouched.

**A plain bar, and the invitation in the column.** The bar carries the wordmark and nothing else. The invitation is
a daisyUI **alert** at the top of every public column — the long sentence naming what an account is for, and one
button that names both doors, *Sign up / Sign in*.

It took three goes in one afternoon, and the arc is the useful part. A fixed invitation band above a wordmark row
put three different left edges on a wide window. Combining them into one inverted bar fixed the alignment and still
spent a permanent strip of every window on a sentence a visitor had already read. The alert keeps the invitation on
every page, in the reading measure, where it is part of the page rather than furniture around it — and it is a
component the library already has, themed in all three palettes, rather than a bar of our own.

**One measure, product-wide** (owner decision 2026-09-21, superseding §2.3's two). Every screen is 680 px, and
each screen's own bar is capped to match its column. A list measure of 760 px sat beside the reading one until
then, and the cost showed on the invitation: the same component wrapped on one page and not on the next, which is
what anyone notices about something meant to be identical everywhere. The only exception is Curate, which is given
the page — a dense table is not a measure, it is the absence of one.

The invitation's sentence is set in **`text-ui`**, not the reading serif. It is interface rather than something
written to be read (§2.7), and at body size in serif it needed the whole reading column to itself.

**The box is §2.4's, not daisyUI's.** `.alert` paints itself `--color-base-200` and borders itself in the same
token — and that token *is* `--ground`, so the component arrives the exact colour of the page with an invisible
border, reading as loose text with a button beside it. `alert-quiet` sets daisyUI's own `--alert-color` hook to
`--panel` and adds the 1 px `--edge`, which is the bordered box the product already uses for a reader's own
controls, and trims the padding: a standing invitation on every page is not an event, and 12 px top and bottom on
each of them adds up.

**The two doors sit where their audiences look** (revised 2026-09-21). **Sign in** is in the bar's top-right
corner, which is the "who you are" slot — a reader's email and monogram are there, and for a visitor it holds the
way to become one. A returning reader looks there without reading anything, which is the whole argument. **Sign up**
is the alert's one button, for the stranger who needs telling first. Both go to `/sign-in`, because a first sign-in
is what creates the account, and the door says so in a line of its own so that whichever word was clicked was the
right one.

The alert's sentence says what an account *adds* — the bar has already said what the product *is*, and two pitches
in the same words would be one too many.

The sign-in control belongs to three bars — the public shell's, the channel's and the summary's — so like the
alert it **decides for itself whether to render**. A control each bar has to remember to add is a control one bar
will not have; that failure happened four times on the day this was built.

It carries **no `role="alert"`**, which daisyUI's own examples do: that role is a live region, announced over
whatever a screen reader is currently reading, and this is a standing invitation rather than something that just
happened. The class styles it; the semantics are an ordinary piece of the page.

**A visitor is shown no control they cannot use.** No Follow, no Ask, no Add a channel, nothing disabled with a
tooltip. This is principle 7 applied to a stranger: the page says what an account adds, in words, once, and the
rest of the page is the thing itself. It also means the product never has to explain a dead button, and no intent
has to survive a sign-in round trip.

**The reading page keeps two bars, not three.** Beneath the shell, the reading column keeps its own bar — the way
back, `Aa`, *Watch on YouTube* — minus `Done` and `Ask`, which need a session. A third row stacking the product's
nav above the reading bar would put 150 px of chrome over a column whose standing rule (§3) is that it carries no
chrome it can live without.

**What a visitor does not get, and why it is absence rather than disablement:** `Done` (there is no receipt to
write), `Ask` (there is no chat without a session), Related (the API filters related titles to the caller's
eligible channels and an anonymous caller has none), and the bottom tab bar (it exists to put three reader
destinations under a thumb, and a visitor has none). The type, size and theme controls **stay** — they live in this
browser's storage and need nobody.

---

## 10. Where things are

| | |
|---|---|
| What the product does | `docs/PRD.md` — §4 behaviour, §5 schema, §7 screens and routes, §9 decisions |
| How to work in the repo | `AGENTS.md` — hard rules, layout, toolchain, testing, code style |
| Reasoning for a phase | `docs/specs/<name>.md` and its `-plan.md`; the current one is `public-reading` |
| The wireframes | `https://claude.ai/code/artifact/61ac5352-ede9-49ba-a5e2-792dbeb76557` |
| Tokens and theme | `apps/web/src/styles.css` — the one stylesheet: Tailwind, the daisyUI theme, the tokens, the faces |
| The two font files | `apps/web/public/fonts/` with their OFL licences and a README |
| Every user-facing phrase | `apps/web/src/lib/copy.ts` |
| Icons and avatars | `apps/web/src/components/Icon.tsx`, `Avatar.tsx` |
