# Implementation plan — Summary prompt v2 and Workers AI JSON mode

**Implements:** `docs/specs/summary-json-mode.md` under `AGENTS.md`; follows `docs/specs/m3-3-ai-vectorize.md` and
the summarise step of `docs/specs/m3-5-episode-workflow.md`.
**Written:** 2026-09-13, against `main` at `1c58a47`.
**Status:** IMPLEMENTED 2026-09-14, Steps 0 to 3.1, `pnpm check` green at 304 tests. Step 3.2, the real-episode
walkthrough, is still owed and is the owner's to run. No new dependencies.
**Shape:** one probe step, two code steps, one docs-and-walkthrough step; one commit when the owner asks with
`pnpm check` green. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §4, all six criteria.

### Step 0 — JSON-mode probe  (size: S)

**Files:** none kept; a temporary route or script under `wrangler dev --env dev`, deleted afterwards, as M3.3's probe
was.

- 0.1 Call `SUMMARY_MODEL` with the ten-minute English fixture transcript, the new `MAP_PROMPT`, and
  `response_format: { type: "json_schema", json_schema: SUMMARY_RESPONSE_SCHEMA }`. Record: the type of `response`
  (object or string), latency, takeaway count, whether markers came back as `[h:mm:ss]` strings.
- 0.2 Call once with a schema the model cannot satisfy (say `takeaways` with `minItems: 40`) and record what the
  platform does: a "JSON Mode couldn't be met" error, an empty answer, or a best effort.
- 0.3 Call once without `response_format` but with the new prompt, to see the raw text shape the fallback would store.

No DownSub call is made: the fixture is local text. **Plan decision:** if 0.1 answers a string rather than an object,
§3.3's branch order still holds and the record says so.

**Done when:** the three observations are written under Walkthrough record.

### Step 1 — Prompts and validator  (size: S)

**Files:** `apps/api/src/prompts/summary.ts`, `apps/api/src/lib/summary.ts`, `apps/api/test/summary.test.ts`,
`apps/api/test/ai.test.ts`.

- 1.1 The three texts of spec §3.1; `PROMPT_VERSION` to the edit date (`2026-09-13.2` if the same day). The owner
  rewrote both persona lines on the prompts directly while this step was in flight — a transcript of an episode for a
  reader who has not consumed it, naming neither podcast nor YouTube — and spec §2 and §3.1 were corrected to match
  what shipped rather than the other way round.
- 1.2 `MAX_TAKEAWAYS` 8, `SUMMARY_RESPONSE_SCHEMA`, and `formatSectionSummary` per spec §3.2.
- 1.3 Tests: eight takeaways accepted, nine rejected (the "six takeaways" case becomes nine); the schema's `minItems`
  and `maxItems` read back equal to the constants; `formatSectionSummary` renders markers and nulls; the prompt
  assertions in `ai.test.ts` follow the new wording.

**Done when:** `pnpm check` green.

### Step 2 — JSON mode in the wrapper and the reduce input  (size: S)

**Files:** `apps/api/src/lib/ai.ts`, `apps/api/src/workflows/ingest.ts`, `apps/api/test/ai.test.ts`,
`apps/api/test/workflow-ingest.test.ts`.

- 2.1 `realClient` passes `response_format` on both calls and accepts an object `response` per spec §3.3; the error
  message reads "the model returned no response".
- 2.2 Stub-binding tests: the recorded inputs carry the schema on both calls; an object answer is returned as its JSON
  text and parses; a string answer passes through; `{ usage: {} }` throws `SUMMARY_FAILED`.
- 2.3 The Workflow's reduce prompt is built from `formatSectionSummary` for structured sections (spec §3.2). The
  multi-section case in `test/workflow-ingest.test.ts` gains the assertion that the published takeaways carry non-null
  `startSec`, which the fake now yields because the reduce input carries markers. The fake itself is untouched.

**Done when:** `pnpm check` green.

### Step 3 — Docs and the real-episode walkthrough  (size: S)

**Files:** `docs/PRD.md` §4.4, `docs/specs/m3-3-ai-vectorize.md` §3.4, `AGENTS.md` (AI code bullet, layout comment),
this file.

- 3.1 The doc edits of spec §3.4 and §6.
- 3.2 Under `wrangler dev --env dev` on a fresh scratch `--persist-to` directory: approve one real channel with
  `initialImportCount: 1` whose newest upload is a captioned talk longer than 45 minutes, so the reduce runs (one
  DownSub credit; a long interview or lecture channel), and read the episode until `available`; record the summary's
  format, takeaway count and order, how many timestamps are non-null, and the attempt's duration. If no such upload is
  at hand, a second channel with a shorter talk covers the map path and the record says the reduce was not exercised.
  **Plan decision:** the owner's local catalog is not touched; if the owner wants the CBC clip regenerated, they press
  Retry on it themselves (one credit).

**Done when:** `pnpm check` green, `git diff --check` clean, the record below filled in.

## Walkthrough record

### Step 0 — the JSON-mode probe, 2026-09-14

A temporary `GET /_probe` mounted on the Hono app under `wrangler dev --env dev`, deleted afterwards with its route
file. One call per observation over the ten-minute English fixture (`englishSegments()` chunked and formatted: a
13,029-character prompt), `SUMMARY_MAX_TOKENS` 1024, each run twice.

- **0.1, the new `MAP_PROMPT` with `SUMMARY_RESPONSE_SCHEMA`.** `response` came back as a **parsed object**, so
  §3.3's object branch is the live path, not the fallback one. 8.0 s and 8.3 s. Valid against `parseSummary` both
  times, with **6 takeaways** each — the map prompt's "lean toward 6" is answered — and 5 and 7 tags. Every `at` was
  `"0:00:00"` in both runs: the model attributed no distinct markers. The fixture is 120 segments of ten generic
  sentences cycling, so there is no moment to point at, but timestamps are the reader's jump targets and Step 3.2 on a
  real transcript is what will actually settle this. **TODO(owner):** if a real episode also comes back with one
  repeated marker, the map prompt's rule 2 is the thing to revisit, not the schema.
- **0.2, a schema the model cannot satisfy** (`takeaways.minItems` 40, `maxItems` 60). **No "JSON Mode couldn't be
  met" error.** The platform made a best effort: 28 s, and `response` came back as a **string** of JSON truncated
  mid-object at 4,167 characters, the `max_tokens` ceiling. An unmeetable schema therefore reaches us as an invalid
  answer, not as a thrown call: `parseSummary` rejects it, the stricter retry runs, and the raw fallback stores the
  truncated text. The spec §2 row on "JSON Mode couldn't be met" describes an error this probe did not see; the
  wrapper still throws on a missing response, which is the row's real subject.
- **0.3, the new prompt with no `response_format`.** Also a **parsed object**, 5.5 s and 6.6 s, valid, 6 takeaways.
  The platform parses a JSON-shaped answer whether or not the schema is sent, so §3.3's object branch is not
  JSON-mode-specific and the branch order holds either way.

### Step 3 — docs and the real-episode walkthrough

- 3.1 done: PRD §4.4 (the 3–8 bound, the map's 3–6 and the reduce's 5–8, JSON mode and why the hand validation stays),
  `docs/specs/m3-3-ai-vectorize.md` §3.4 (its texts marked superseded, pointing here), `AGENTS.md` → AI code (the
  schema beside the validator's bounds; the version names texts and schema together) and the `docs/specs/` layout
  comment.
- 3.2 **done 2026-09-14**, by the owner and on a real episode rather than the scratch channel this step imagined: CBC
  News, "The House: Why separatists still think they can win Alberta's referendum", 49 minutes, two sections, the
  reduce ran. Structured through the reduce; seven takeaways, inside the 5–8 band; chronological; exactly three
  sentences. Four takeaways come from the second section, 44:16 to 49:02, **carrying correct timestamps** — the
  observable proof of the fix, since every reduced takeaway was null before `formatSectionSummary`. Criterion 5 is
  satisfied and this spec is complete.
- The same episode showed two faults that belong to the pipeline rather than to JSON mode: the greedy 45-minute
  section split left a five-minute tail speaking as loudly as the body before it, and a section containing no
  introduction can only call its subject "the speaker". Both are `docs/specs/summary-quality.md`; the split is already
  fixed.
