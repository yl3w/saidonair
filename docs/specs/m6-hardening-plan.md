# Implementation plan — M6 Hardening

**Implements:** `docs/specs/m6-hardening.md`, under `AGENTS.md`.
**Written:** 2026-09-22. **Status:** complete 2026-09-22 — all four steps landed, and a fifth appeared
when the owner reversed §8's rule against component tests, turning two accepted gaps into closures.

The sweep itself is done and lives in the spec's §3 — 91 claims, each with a verdict. This plan is only what the
sweep *owes*: four tests and four document edits. It is deliberately small. M6 is a read, and the read is the part
that took the work.

## What the owner settled on 2026-09-22

- The verdicts live in a **spec and plan pair**, the ledger in the spec, like every other phase.
- An unverified criterion is **closed with a test where closing is cheap**; accepted where a test would be theatre,
  and the reason recorded rather than the gap merely listed.
- The three uncommitted web files of that morning were committed first (`912fd08`), so M6 starts from a clean tree.

## Definition of complete

- The four tests of Steps 1–3 exist, name the criterion they close, and fail when it stops holding.
- `pnpm check` passes.
- The four PRD edits of spec §5 are applied, including striking the sentence that made §8's first line M6's emblem.
- §10 marks M6 complete and says what the sweep found.
- Nothing about the product's behaviour changed.

## Owner actions

None. M6 touches no binding, no secret, no deployed resource, and no dependency. Nothing here needs `wrangler dev`
either: every step is an offline test or a document edit, and the seams they exercise are the fakes the suite
already selects.

---

### Step 1 — The vector half of the first line  (size: S) — closes G1 — **done**

`isolation.test.ts` already carries §8's first two criteria and says so in its header. The first is covered for the
episode and the summary and not for the vector set, which is the third noun in a sentence of three.

Add a third case to the existing `describe("two readers, one catalog")`:

- Seed one approved channel, one available episode with a summary, and an active vector generation the fake store
  holds; follow it as both `ALICE` and `BOB`.
- Each asks a question through `POST /chats/:id/messages`.
- Assert both replies cite the same episode, and that the sources they receive came from the **same** active
  generation — the episode carries one `active_vector_generation` and both readers retrieved against it.
- Assert the store was queried under `shared-catalog` both times, with a filter naming channels and no user.

The assertion to aim at is not "both got an answer" but "there was one set of vectors and neither reader's identity
reached it". Extend the file's header comment to say the third noun is now covered too.

**Watch for:** the fake vector store is per-test, so seed the generation through the same helper the chat tests use
rather than by hand — `helpers.ts` already has the seam. And assert the *generation id*, not merely that both
answers mention the episode, which would pass with two separate generations.

### Step 2 — The two seams  (size: S) — closes G2 and G3 — **done**

Two small absences, in two files that already set up everything needed.

**G2, in `registry-channels.test.ts`.** A case that seeds an approved channel with a discovery run and two episodes
in different statuses, snapshots those rows, declines the channel, and asserts the runs and episodes are byte-for-
byte what they were. The criterion claims an absence, so the test must assert the absence rather than that decline
worked. Name it for what it protects: declining is a catalog decision and not an ingestion one.

**G3, in `routes-follows-digest.test.ts`.** The existing round-trip test already reads Alice's three summaries to
zero unread, declines the channel, checks Bob's count falls to zero, approves, and checks Bob's returns to three.
Add the one assertion that never got written: Alice's `unreadCount` is **still zero** after the approve. Her
receipts live in her own DO, keyed by episode; the channel's status has no business touching them, and that is the
claim.

**Watch for:** G3 is one line in a test that is already long. Resist rewriting the test around it — the setup is
correct and the assertion belongs where the round trip ends.

### Step 3 — The shapes, enumerated  (size: M) — closes G4 — **done, and the plan's shape for it was wrong**

`expectShape` is called 34 times across seven files, and nothing says which routes that leaves uncovered. The fix is
the one `openapi.test.ts` already uses for routes: enumerate, don't list.

In `openapi.test.ts`, beside the operations check:

- Walk every operation in the generated document.
- For each, take the success response's schema and assert it resolves to a component the shared package declares —
  so a route answering an ad-hoc inline shape is visible rather than silent.
- Skip the two session routes that answer only 302, as the existing success-response check already does.

This reads the document rather than re-listing the routes, so it stays true as routes are added. It is the step
most likely to find something, which is why it is its own step: **if it finds a route answering a shape the shared
package does not declare, stop and report it.** That is a defect, and spec §8 puts defects out of M6's scope — it
gets its own decision, not a quiet fix inside a hardening milestone.

**Watch for:** `hono-openapi` may emit a `$ref` or an inlined schema depending on how the route declared it. Assert
on what the document actually contains before writing the matcher, and if inlining turns out to be the norm rather
than the exception, say so and narrow the test to what it can honestly check.

### Step 4 — The two the rule was hiding  (size: M) — closes G5 and G6 — **done, unplanned**

Not in the plan as written. §6 had accepted A1 and A2 because §8 bullet 14 forbade component
tests, and writing the reason down made it plain that the reason was the rule rather than the risk.
The owner reversed the rule (PRD §9, 2026-09-22) and chose **render tests with no DOM**: 
`preact-render-to-string` is already a dependency, so this cost no install; `happy-dom` and a
testing library were offered and declined.

- `apps/web/test/channel-actions.test.tsx` — `ChannelStatusActions` across status and scope.
- `apps/web/test/scope-chip.test.tsx` — `ScopeChip` and `ScopeLine` across scoped and not.

The boundary that makes these worth having: **test what a component decides, never how it looks.**
An assertion on a Tailwind class is a test of daisyUI. Clicks and focus still have no DOM and stay
hand-verified under `pnpm dev`.

### Step 5 — The documents  (size: S) — **done**

The four edits of spec §5:

- **E1** — §8 bullet 13: "an owner skip with no email" → wording that names a user, the column being
  `skipped_by_user_id` since the Auth rekey.
- **E2** — §10's M6 paragraph: strike the claim that §8's first line has no test, record that `isolation.test.ts`
  closed it during the Auth phase, and keep the argument behind it, which is still why Step 1 exists.
- **E3** — §9: the sweep's record. The four counts, the four gaps closed, the three accepted and why, the date.
- **E4** — §10: M6 complete, with what the sweep found rather than only that it ran.

Then this plan gains a Record section, the way the other plans carry theirs.

---

## Record

**Five steps, 2026-09-22, on `main`.** The sweep itself (spec §3) was the work; these were its debts.

| Step | What landed | Tests |
|---|---|---|
| 1 | `isolation.test.ts` gains the vector case | +1 |
| 2 | `registry-channels.test.ts` gains the decline snapshot; `routes-follows-digest.test.ts` gains one assertion | +1 |
| 3 | `openapi.test.ts` gains the enumerated success-shape check | +1 |
| 4 | `channel-actions.test.tsx`, `scope-chip.test.tsx` — the first component tests in the repo | +9 |
| 5 | PRD §3, §7, §8, §9, §10; `AGENTS.md`; `wrangler.jsonc`; `index.ts`; `ScopeChip.tsx`; `app.tsx` | — |

420 API tests and 60 web tests pass. **What the steps found that the plan did not predict:**

- **Step 3's premise was wrong.** The document inlines each route's wrapper object and `$ref`s the
  entities inside it, so "the success response is a shared component" is not true of anything. The
  step was written with a `Watch for` anticipating exactly this, and the test became "every success
  body is *built from* the shared schemas", with the two flat exceptions and the two redirect-only
  routes listed rather than counted. Nothing was broken — the check is new coverage, not a fix.
- **Step 4 existed because Step 5 was being written.** Recording *why* a gap was accepted is what
  exposed that the reason was a rule nobody had re-examined. That is the whole method of this
  milestone applied to the milestone itself.
- **A flake, and some unread warnings.** One `pnpm check` run failed with `no such table:
  global_users`; separately, `biome` was reporting unused imports in `app.tsx`, `History.tsx` and
  `Sources.tsx` that predate M6. Both were left out of M6 on purpose — neither is §8's, and a
  hardening milestone that quietly repairs what it audits is one nobody can read afterwards — and
  **both were then fixed on the owner's instruction, in a commit of their own.** See the
  postscript, which also corrects what was first written here about the second one.

## Postscript — the two findings, fixed 2026-09-22

Not M6's work; recorded here because M6 is where they were found.

**The unused imports, and a claim about `pnpm check` that was wrong.** This plan first recorded
them as a case of `pnpm check` "replaying a cached success" while lint was broken. **It was not.**
`noUnusedImports` is a *warning* under biome's `recommended: true`, and biome exits `0` on
warnings — checked by restoring one of the imports and running both `biome check` and `pnpm lint`,
which report `Found 1 warning` and exit `0`. So the gate was never green while failing; it was
green because it is configured to tolerate warnings. Turbo's `9 cached, 9 total` was an ordinary,
honest cache hit and hid nothing. The `pnpm check` failure that prompted the theory was caused by
formatting errors in the two component test files written minutes earlier — my own, and
misattributed.

What survives of the finding is smaller and still worth having: **warnings accumulate here and
nobody reads them**, because the gate does not stop for them.

The imports themselves were three files, not the five warnings first reported: `app.tsx` (the call
to `applyReaderSettings` had moved to `main.tsx`, where it still runs, and only the import stayed
behind), `Sources.tsx` (`channelStateCopy`, `summaryCountCopy`, `relativeTime`), and `History.tsx`
(`dayKeyOf`, `weekWindow`). Each was checked for the thing an unused import can be hiding — a
dropped call — before removal; `applyReaderSettings` was the one worth checking, and it is still
invoked at `main.tsx:9`.

**The flake's diagnosis above was wrong**, and the correction is the useful part. It was not "an
aborted instance touching storage mid-wipe". A Durable Object applies its migrations — and the
Registry seeds the owner — exactly once, in a constructor, under `blockConcurrencyWhile`.
`afterEach` called `deleteAll()`, which takes the tables away but **cannot make a live instance
forget that it already ran**: the object goes on believing it is migrated while its storage is
empty, and anything reaching it in that state fails with `no such table: global_users`.
`abortAllDurableObjects()` was what prevented it, and it is a race to rely on — it settles after
the wipe, and nothing stops a surviving stub from routing to the old instance first.

The fix is for the wipe to leave storage exactly as a fresh constructor would: `deleteAll()`, then
re-apply the migrations and re-seed the owner, inside the same `runInDurableObject` call. The abort
stays, as an optimisation rather than as the thing correctness rests on.

**Both halves of that were proved before the fix was believed**, with a throwaway test that built
the race by hand: a live instance whose storage is wiped throws `no such table` on its next call,
and the same instance with the rebuild in place keeps serving with no abort at all.

### A second flake, still open

Reproduction runs turned up a different failure that this fix does **not** address, and it was
first written up here as the same cause wearing a different face. **That was wrong, and the
evidence that corrected it is that it happened again after the fix.**

`routes-follows-digest.test.ts` → `bounds the range, filters unread and by channel, pages by
cursor, and answers compact rows` fails roughly **twice in twenty-four full-suite runs**, once
before this fix and once after. It is always that test, and always at about **5,126 ms**.

That number is the finding. The test takes **394 ms** when it passes, so the failure is not slow
machinery under load — 5,000 ms is Vitest's default `testTimeout`, and the test is **hanging into
it**, not overrunning a budget. A thirteen-fold jump is a stall, and the obvious place to look is
the Durable Object input gate: a call that never settles blocks every later caller, and this is the
heaviest test in the file, running immediately after another that exercises the same object.

What is *not* yet known is the error the runner prints when it happens, because ten consecutive
runs after the fix were clean and the capture never fired. Left open deliberately rather than
papered over: raising the timeout would turn a 394 ms test into a 10 s one and throw away the only
signal there is.

---

## Risks

- **Step 3 finds a defect.** Plausible: it is the first enumeration of response shapes. The plan's answer is to
  stop and report rather than to fix inside M6 — a hardening milestone that quietly repairs what it audits is a
  milestone nobody can read afterwards.
- **The ledger rots.** Spec §3 names 75 tests by their `it(...)` strings, and a rename breaks the link silently.
  Accepted in spec §8 with the reason; the alternative was a half-prose test file. Worth revisiting only if a test
  named there is renamed and the drift goes unnoticed.
- **A verdict is wrong.** The sweep was one reader's pass. The structural verdicts are the ones to doubt first —
  eight claims rest on an argument rather than an assertion, and §2 sets the bar deliberately high for exactly that
  reason. Any of the eight can be promoted to a test later without disturbing anything.

## What this leaves open

- `chat-origin-scope.md` §5 criterion 19's second half — `Try again` sends a new attempt and keeps the failed reply
  above it — stays open, as §10 already records. It is a UI control, so it falls under the same standing rule that
  accepts A1 and A2.
- The three accepted gaps stay accepted. If the no-UI-component-tests rule is ever reversed, A1 and A2 are the two
  that come back.
- Whether §8 should be enumerated in code at all — a machine-checked ledger — is declined here with a reason, not
  dismissed. It becomes attractive the first time a renamed test is found to have broken a link in §3.

## Plan decisions

- **Four steps, not one.** Steps 1–3 are independent and could be one commit; they are three because Step 3 might
  find a defect and should be separable from the two that certainly will not.
- **No `wrangler dev` walkthrough.** Every step is offline. Saying so explicitly matters because `AGENTS.md`
  requires the walkthrough for anything touching Workers runtime behaviour, and a reader should see that the
  exemption was considered rather than forgotten.
- **The sweep shipped before the tests.** The spec's ledger is complete as written, so the owner approves the work
  knowing what it found — rather than approving a method and learning the findings afterwards.
