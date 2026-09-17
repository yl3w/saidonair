# Implementation plan — M4.3 The chat screens

**Implements:** `docs/specs/m4-3-chat-web.md` under `AGENTS.md`; parent `docs/specs/chat-origin-scope.md`; roadmap
`docs/specs/chat-origin-scope-plan.md`.
**Artboards:** https://claude.ai/code/artifact/2ac197c6-36ab-45e0-9a30-3deb23e9cbc4 — build against them, not
against this prose. Tokens, type and spacing are `docs/design.md` §2; every colour resolves through `var(--token)`
so the three themes keep working with no per-component knowledge.
**Written:** 2026-09-16, against `main` at `2ac6650`.
**Status:** in progress. **Steps 1–4 complete 2026-09-16**, committed as two commits rather than four. Step 5, the
walkthrough, is not started — and it is the only thing that verifies any of this.
**Amended 2026-09-16, while building — the step boundaries were wrong twice, the same way.** Step 1 would have
committed `Chats` into primary navigation pointing at a screen that did not exist; Step 3 would have committed a
conversation screen whose composer said it arrived in Step 4. Both are the condition PRD §9 deleted the last
placeholder over. Steps 1–2 and 3–4 therefore commit in pairs. The lesson is general and worth carrying to any web
chunk: **a screen is the shippable unit here, not a layer of it** — the API could be built in five commits because
each left a coherent contract behind, and a half-built screen never does.
**Shape:** five code steps, each ending with `pnpm check` green and one commit when the owner asks. **The web
workspace is typecheck and lint only — it has no tests** (`docs/specs/channel-simplification.md`), so every step's
evidence is the browser, and Step 5 is the click-through that closes M4. Steps 1 and 2 are independent; 3 needs 2;
4 needs 3. Decisions this plan makes are marked **plan decision** and stand unless vetoed.
**Before starting:** nothing in `apps/api` changes. If a route seems to be missing something the screen needs, say
so rather than adding it here — M4.1 and M4.2 are committed and the API's shape is settled.

## Definition of complete

Spec §4, all fourteen criteria, and the walkthrough below.

### Step 1 — `Ask`, and the way in  (size: M)

**Files:** `apps/web/src/screens/Reading.tsx`, `apps/web/src/api.ts`, `apps/web/src/main.tsx`,
`apps/web/src/components/Nav.tsx`.

- 1.1 `api.ts`: the four chat calls beside the existing ones, in the `api` object's style —
  `listChats()`, `createChat(title?)`, `getChatMessages(chatId, limit?)`, and
  `sendMessage(chatId, body: { message: string; aboutEpisodeId?: string })`. Types come from
  `@media-digest/shared` (`ChatsResponse`, `ChatResponse`, `ChatMessagesResponse`, `ChatExchangeResponse`), which
  M4.1 and M4.2 already export — do not restate a shape here.
- 1.2 `Reading.tsx`: `Ask` joins the chrome beside `Episode` and `Done`. It renders only when the episode has a
  summary, `processing.vectorizedAt` is set, and the caller is eligible. **Plan decision:** eligibility is
  `episode.read !== undefined` — `GET /episodes/:episodeId` returns `read` only to an eligible caller (PRD §7), so
  the screen already holds the answer and needs no second call. If that reads too clever in review, a `follows`
  lookup is the alternative and costs a request.
- 1.3 It navigates to `/chats/new`, setting the scope in `lib/ask-scope.ts` on the way, and writes nothing (spec
  decision 1, revised 2026-09-16: nothing is in the URL). Nothing else on the
  reading screen changes: `Done` still owns the only write.
- 1.4 `main.tsx`: three routes — `/chats`, `/chats/new`, `/chats/:chatId` — with `new` declared **before** the
  parameterised one, or `preact-iso` matches `new` as a chat id.
- 1.5 `Nav.tsx`: `Chats` joins `DESTINATIONS` after Sources, with a `MessageSquare` icon from `lucide-preact` as
  its neighbours use. The phone's tab bar takes it automatically and becomes three 44 px targets.

**Evidence:** `Ask` appears on a summarised, followed episode and is absent on one you do not follow; the route
resolves; the tab bar is three across at 390 px.

**Done when:** `pnpm check` green.

### Step 2 — `/chats`, the history  (size: M)

**Files:** `apps/web/src/screens/Chats.tsx` (new), `apps/web/src/lib/copy.ts`.

- 2.1 `Chats.tsx`: the 760 px list column under the standard frame, a 27 px serif screen title, and rows grouped by
  recency — `Today`, `Yesterday`, then by date — as the artboard draws them. A row is the chat's name (its first
  question, 16 px serif 600) over a meta line.
- 2.2 The meta line names where the chat began: `Began at <episode title> · <channel> · <n> messages · <when>`, or
  `Across everything you follow · …` when it has no origin. **Origin comes from the first message's
  `aboutEpisodeId`**, so the screen fetches each chat's first page of messages — **plan decision:** fetch lazily per
  visible row rather than eagerly for all, and if that reads as too many requests in review, the alternative is an
  origin field on `GET /chats`, which is an API change this chunk deliberately does not make.
- 2.3 `copy.ts`: the two phrases above, beside the existing status copy — user-facing wording lives in one place
  (PRD §7).
- 2.4 **Nothing that creates, searches or deletes a chat.** The artboard's panel naming those absences is
  documentation, not UI: do not build it.
- 2.5 Empty state: one serif sentence — "Chats begin on a summary. Open something from your queue and ask about
  it." — and no button.

**Evidence:** the list renders grouped, an origin-less chat reads "Across everything you follow", and the screen
offers no way to make a chat.

**Done when:** `pnpm check` green.

### Step 3 — `/chats/:chatId`, the conversation  (size: L)

**Files:** `apps/web/src/screens/Chat.tsx` (new), `apps/web/src/components/ChatMessage.tsx` (new),
`apps/web/src/components/SourceCards.tsx` (new), `apps/web/src/lib/copy.ts`.

- 3.1 `Chat.tsx`: the 232 px rail beside the 680 px column, as the artboard draws. On a phone the rail is not a
  rail — **plan decision:** it collapses entirely and the screen is the transcript, reachable back through
  `/chats`; a drawer would be a second navigation model for one screen.
- 3.2 `ChatMessage.tsx`: the role in a 64 px left gutter as a 12 px uppercase label — `You` / `Answer` — with the
  message beside it. **On a phone the gutter becomes a line above the message** (spec decision 3); roles stay
  words, and no message is ever a bubble or right-aligned.
- 3.3 A question renders its scope: `Asked about <title>` in 12.5 px meta above the text, or nothing when
  `aboutEpisodeId` is null. An answer renders 17 px serif with newlines preserved (`white-space: pre-wrap`), and
  only `youtube.com` URLs linkified — nothing else becomes a link.
- 3.4 `SourceCards.tsx`: **group by `episodeId`, preserving first appearance for card order; sort each group's
  `startSec` ascending** (spec §3.3). One card per episode: title 16 px serif 600, channel 12.5 px meta, then the
  timestamps as a wrapped row of `youtu.be/<episodeId>?t=<startSec>` links, formatted `m:ss` or `h:mm:ss`.
- 3.5 A `truncated` reply gets one meta line beneath it — "Answer shortened." — above its sources, and **no
  `Try again`**. A `failed` reply gets `Try again`, which re-sends the same question with the same
  `aboutEpisodeId` and leaves the failed reply above it. A `pending` reply shows the existing skeleton.
- 3.6 `copy.ts`: "Answer shortened.", "Try again", and the failure phrasing — one home for wording.

**Evidence:** a scoped answer shows one card with several ascending timestamps; an unscoped one shows a card per
episode in score order; the phone layout keeps roles as words.

**Done when:** `pnpm check` green.

### Step 4 — The chip, the composer, and Account  (size: M)

**Files:** `apps/web/src/screens/Chat.tsx`, `apps/web/src/components/ScopeChip.tsx` (new),
`apps/web/src/screens/Settings.tsx`, `apps/web/src/api.ts`.

- 4.1 `ScopeChip.tsx`: the chip above the composer — an `About` label, the episode title, and a `✕` in a 44 px
  target (owner decision 2026-09-16: the `✕` stays; no labelled control). Dismissing is `setScope(null)` — no
  navigation at all, so the draft cannot be lost, which the URL version had left unverified.
- 4.2 Beneath the composer, one line: "Searches this episode only." with a chip, "Searches every channel you
  follow." without. **This line is the only thing telling a reader that widening exists** — it is not decoration.
- 4.3 The composer: on `/chats/new`, the first send calls `createChat()` then `sendMessage(...)` and **replaces**
  the URL with `/chats/:chatId` (replace, not push, so Back returns to the summary rather than to an empty
  composer); the scope rides across in state. On an existing chat it sends and appends.
- 4.4 The chip's episode title needs a title for an id the screen may not hold on `/chats/new` — fetch it with the
  existing `api.getEpisodeById`.
- 4.5 `Settings.tsx`: the `system_rules` field returns against `GET`/`PUT /preferences` (registered since
  2026-09-15, called by nothing until now), labelled as applying to chat answers alone. Add `getPreferences` and
  `setPreferences` to `api.ts`. At most 4000 characters, empty clears.

**Evidence:** the chip survives a reload, a second `Ask` replaces it, dismissal leaves a working URL, and a rule
saved in Account comes back after a reload.

**Done when:** `pnpm check` green.

### Step 5 — The walkthrough  (size: M, no new features)

The web has no tests, so this is where M4.3 is actually verified. Run `pnpm dev` against the dev environment, which
has one followed channel and five scoped-searchable episodes.

- 5.1 Every criterion of spec §4, in a browser, at desktop and at 390 px.
- 5.2 The three themes — light, sepia, dark — on both chat screens. Every colour must resolve through a token; a
  hardcoded hex shows up here as a light card in a dark page.
- 5.3 The accessibility floor (§4.10): tab to every control, 44 px targets, nothing meaningful under 12 px, and no
  state carried by colour alone.
- 5.4 **Two known defects to fix in this step, both found by reading the code on 2026-09-16:**
  - `titleFor` in `Chat.tsx` resolves a question's episode title from whichever reply cited it, and degrades to
    "Asked about one episode" when none did — which is exactly the refusal, nothing-found and failed cases, so the
    mark is least informative where the reader most needs it. `Chats.tsx` already falls back to
    `api.getEpisodeById` for the same problem; carry that fallback across. The alternative — naming the episode in
    the refusal text — is wrong: those sentences are stored content a reader sees again next week.
  - ~~Dismissing the chip is a `route(…, true)`~~ — **resolved 2026-09-16** by moving scope out of the URL:
    dismissal is now `setScope(null)` with no navigation, so a draft cannot be lost. Nothing to check.
- 5.5 Report what the click-through found. The Design phase's produced thirty-three commits; expect to find things.

**Done when:** the owner has walked through it and M4 is declared complete.

## After M4.3

Two things close M4 rather than this chunk: the `CHECK` on `chat_messages.failure_code`
(`m4-2-chat-answering.md` decision 6 — its precondition has been met since 2026-09-16), and a final pass over
PRD §10.

## Walkthrough record

**2026-09-16/17, first owner session.** Chat `04dbc61a`, four messages, in a browser against the dev environment.

**Confirmed working.** `Ask` opened a scoped chat from a summary; the first send minted the chat and replaced the
URL; the reader dismissed the chip and asked a cross-source follow-up in the same conversation. The stored data
matches the contract exactly: scope on both questions and null on both replies, **8 chunks kept when scoped and 6
when not** — `SCOPED_KEEP` and `UNSCOPED_KEEP` chosen correctly without being told — `promptVersion` on the replies
and null on the questions, `truncated` false.

**The ascending sort earned its keep, with evidence.** Sources for the scoped reply were stored
`2730, 5636, 56, 3070, 735, 905, 3299, 4893` — real score order, genuinely scrambled across a 94-minute episode.
Rendered unsorted, a reader's timestamps would jump backwards and forwards; the card shows
`0:56 · 12:15 · 15:05 · 45:30 · 51:10 · 54:59 · 81:33 · 93:56`.

**Fixed during the step, both invisible to typecheck, lint and the API tests:**

- Every chat rendered "Untitled chat". The screens read `chats.title`, which nothing sets — §4.9 says a chat is
  named by its first question, and it was already there. Loader moved to `lib/chat-rows.ts` so the two lists cannot
  diverge again (`8381cdf`).
- `titleFor` named no episode exactly where it mattered most — the refusal, nothing-found and failed cases, none of
  which cite anything. Unresolved scopes are now fetched by id.

**Fixed 2026-09-17, from a screenshot of `/chats/new`.** The empty composer sat adrift in a mostly blank page,
listing right of centre. Five causes, one of them a real bug:

- **The column was the wrong width.** `Page` wraps a rail layout in `lg:w-fit` so column and rail centre as a group,
  and the column's `w-full` inside a fit-to-content parent resolves to its *content's* width — so a column holding
  something narrow shrink-wraps and the page lists sideways. Beside a rail the column now takes a definite
  `lg:w-reading` / `lg:w-list`. Every rail screen is affected, so History wants an eye.
- **The empty state had never been designed.** §4.9 lists "the first run" among its states; the composer had been
  built as a tail appended to a transcript, so with no transcript it floated under a stray rule. There is now a
  serif heading naming what the chat will search — the episode, or everything followed — with the channel beneath.
- The rule above the composer renders only when there are messages to rule off.
- The input is full width with `resize-none` (the browser's grabber was showing), `Send` moved beneath it beside the
  scope line, and **Enter sends with Shift+Enter for a newline** — there had been no keyboard path to asking at all,
  which was an accessibility failure as much as a comfort one.
- The rail's "CHATS" header is gone: the nav item directly above it already says so.

**Still unverified, and it needs a person:** criteria 4–6 and 12–14 — the chip across interactions, 390 px, the three
themes, and the accessibility floor. Also unexercised: a reply with **more than one source card** (every question so
far retrieved from a single episode), a truncated answer, and a failed reply with `Try again`.

**One quality observation, not a defect.** An unscoped question across five episodes returned all six chunks from one
of them, and the model answered that the excerpts did not mention others. Either the other four do not discuss the
topic, or retrieval skews toward the episode holding the most chunks. This is what the click-through measure of
`docs/specs/chat-origin-scope.md` §2.4 exists to settle.
