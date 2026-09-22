# Implementation plan — M6 Hardening

**Implements:** `docs/specs/m6-hardening.md`, under `AGENTS.md`.
**Written:** 2026-09-22. **Status:** awaiting owner approval.

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

### Step 1 — The vector half of the first line  (size: S) — closes G1

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

### Step 2 — The two seams  (size: S) — closes G2 and G3

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

### Step 3 — The shapes, enumerated  (size: M) — closes G4

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

### Step 4 — The documents  (size: S)

The four edits of spec §5:

- **E1** — §8 bullet 13: "an owner skip with no email" → wording that names a user, the column being
  `skipped_by_user_id` since the Auth rekey.
- **E2** — §10's M6 paragraph: strike the claim that §8's first line has no test, record that `isolation.test.ts`
  closed it during the Auth phase, and keep the argument behind it, which is still why Step 1 exists.
- **E3** — §9: the sweep's record. The four counts, the four gaps closed, the three accepted and why, the date.
- **E4** — §10: M6 complete, with what the sweep found rather than only that it ran.

Then this plan gains a Record section, the way the other plans carry theirs.

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
