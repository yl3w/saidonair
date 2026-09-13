# Feature spec — M3.1 Transcripts and chunking

**Written:** 2026-09-13, against `main` at `e37181c`. The first of seven M3 child specs; the roadmap and order are
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` is the decision record for all of M3. This spec adds nothing to its §2 and
carries only the contract, acceptance criteria, and scope lines this chunk needs. Implements PRD §4.2 rules 19–23 and
the chunking contract of PRD §6.
**Status:** implemented 2026-09-13 on `main`, committed as `5a73f18`; `pnpm check` green; the Step 0 answers
and the DownSub probe are recorded in `docs/specs/m3-1-transcripts-chunking-plan.md`. §3.3's error rows were rewritten
from what the probe showed (the plan's walkthrough record explains). No new dependencies.

## 1. Summary

Two pure building blocks and one adapter, nothing product-visible. `lib/transcripts/` gains the `TranscriptSource`
contract from `AGENTS.md`, a WebVTT cue parser, the DownSub adapter, and the `TRANSCRIPTS_FAKE` seam every later
chunk tests through. `lib/chunk.ts` turns segments into retrieval chunks deterministically. Both are proven by unit
tests alone, plus one removable `wrangler dev` probe against the real provider so the adapter's shape is verified once
before the Workflow (M3.5) depends on it. The chunk also runs the platform checks the 2026-09-12 plan called Step 0,
because their answers decide how the ledger (M3.2) and Workflow (M3.5) chunks are tested.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| What the fake binding carries | `TRANSCRIPTS_FAKE` is JSON `{ status?: TranscriptProviderHealth, videos: Record<videoId, TranscriptResult \| { failure: TranscriptFailure }> }`. `transcriptSource(env)` serves `videos`; `lib/transcripts/status.ts` answers `status` (default `unreachable`) when the fake is set, so pre-flight can be driven to `auth_failed` and zero credits without a network. An unknown video id is `PROVIDER_HTTP`. | The pinned pool has no `fetchMock` (AGENTS.md → Testing); a binding is the one seam that reaches the Worker under `SELF`. One binding for download and status keeps the provider a single fake. |
| Missing key outside tests | With neither `TRANSCRIPTS_FAKE` nor `DOWNSUB_API_KEY`, `fetch` throws `TranscriptError("PROVIDER_AUTH")` without calling out; status already reads `unreachable`. | The attempt records a real reason and recovers on the six-hour schedule instead of failing opaquely. |
| Step 0 lives here | The platform checks of the 2026-09-12 plan's Step 0 run first in this chunk and are recorded in this plan's walkthrough, plus one more: whether a value assigned to `env.X` from `cloudflare:test` is visible to `SELF` requests in the pinned pool. | They cost an hour and decide how M3.2 and M3.5 drive provider status and Workflow states at the route level. |
| Token estimate | `Math.ceil(chars / 4)`, as PRD §6 approximates. | No tokenizer dependency (hard rule 1). |

## 3. Contract

### 3.1 `lib/transcripts/types.ts`

The block in `AGENTS.md` → Transcript seam, verbatim: `TranscriptSegment`, `TranscriptResult`, `TranscriptSource`,
`TranscriptError` with `TranscriptFailure = UNPLAYABLE | PROVIDER_AUTH | PROVIDER_LIMIT | PROVIDER_RATE_LIMIT |
PROVIDER_HTTP | PROVIDER_PARSE`, and `transcriptFailure(error): TranscriptFailure | null`, which recovers the reason
from the message prefix the way `domainErrorCode` does, so it survives a Workflow step boundary.

### 3.2 `lib/transcripts/vtt.ts`

`parseVtt(text): TranscriptSegment[]`. WebVTT only. Accepts `.` or `,` milliseconds; strips `<c>`, `<v>`, `<b>`,
`<i>`, and inline timestamp tags; joins multi-line cue text with one space; drops cues whose text is empty after
stripping; skips a cue with a malformed timing line or a start not before its end and keeps the rest; never throws on
an empty or header-only file (returns `[]`). `durationSec` is `end − start`.

### 3.3 `lib/transcripts/downsub.ts`

`downsubSource(apiKey, fetchImpl = fetch): TranscriptSource`. One call per video:
`GET https://api.downsub.com/download?url=https://www.youtube.com/watch?v=<id>` with `Authorization: Bearer <key>`.
Mapping (parent §2 "DownSub specifics", PRD rule 22):

| Response | Result |
|---|---|
| request throws (network) | throw `PROVIDER_HTTP` with the message |
| 401 | throw `PROVIDER_AUTH` |
| 403 | throw `PROVIDER_LIMIT` |
| 429 | throw `PROVIDER_RATE_LIMIT` |
| other non-2xx | throw `PROVIDER_HTTP` |
| body not JSON, or JSON without `data.state` | throw `PROVIDER_PARSE` |
| `state: error`, live metadata (`metadata.isLiveContent`, a `_live.jpg` thumbnail) | `{ segments: null, durationSec, isLive: true, captionStatus: "none" }` |
| `state: error` with `metadata.playabilityReason` | throw `UNPLAYABLE` with the reason as detail |
| `state: error`, no reason, body still describes a video (title, positive `duration`, or `channelId`) | `isLive: true` as above: a live or upcoming video reads this way (verified 2026-09-13) |
| `state: error`, no reason, no video described | throw `UNPLAYABLE` ("no video metadata"): the provider answers a bogus id this way, sometimes with a reason and sometimes with an empty `metadata` |
| `state: no_subtitles` | `captionStatus: "none"`, `isLive: false` |
| `state: subtitles_found`, no English track by `code` | `captionStatus: "non_english"`, nothing downloaded |
| English track whose VTT parses to one cue or more | `captionStatus: "english"`, the segments |
| English track whose VTT parses to zero cues | `captionStatus: "none"` (decided 2026-09-11) |
| VTT download non-2xx or unparsable | throw `PROVIDER_PARSE` |

Track choice is by `code` only: a manual `en` or `en-*` track first, then `en_auto` or `en-*_auto`; labels are never
read. `translatedSubtitles` is discarded unread. The adapter never retries and sets no timeout: the Workflow step owns
both. Nothing but the public watch URL and the key leaves the Worker; transcript text is never logged.

### 3.4 `lib/transcripts/index.ts` and `status.ts`

`transcriptSource(env): TranscriptSource` is the fake when `TRANSCRIPTS_FAKE` is set, else
`downsubSource(env.DOWNSUB_API_KEY)`. `status.ts` gains the same check in front of its cached reader: with the fake
set, `transcriptProviderHealth` answers the fake's `status` and fetches nothing.

### 3.5 `lib/chunk.ts`

`chunkTranscript(segments): TranscriptChunk[]` with `TranscriptChunk = { index, text, startSec, endSec }`, exactly
PRD §6: consecutive segments grouped to about 60 s; a group over about 400 tokens splits on segment boundaries;
consecutive chunks overlap by one or two segments; no chunk exceeds 480 tokens; a single segment over the cap splits
on sentence, then word boundaries. Indices run `0..n−1` in order. Pure and deterministic: the Workflow calls it inline,
not in a step, so a replay recomputes the same chunks. The constants (`TARGET_SEC`, `SOFT_TOKENS`, `HARD_TOKENS`,
`OVERLAP_SEGMENTS`) are exported for the tests.

## 4. Acceptance criteria

1. `parseVtt` handles dot and comma milliseconds, tags, multi-line cues, empty cues, header-only input, and a cue
   with a malformed timing line (skipped, the rest kept).
2. `downsubSource` maps every row of §3.3; chooses tracks by code and never by label (a fixture labelled
   "undefined (auto-generated)" with code `en_auto` is chosen; one with an English label and code `fr` is not); and
   sends exactly one download request plus at most one VTT request per call.
3. `transcriptFailure` recovers every `TranscriptFailure` from an `Error` carrying the prefix and `null` from any
   other error.
4. `chunkTranscript`: empty input gives `[]`; one short segment gives one chunk; a 40-minute fixture gives chunks
   with overlapping boundaries, monotonic `startSec`, `endSec ≥ startSec`, and none over 480 tokens; an oversized
   single segment splits without exceeding the cap; a 480-token text stays whole and a 481-token one splits; the same
   input twice gives identical output.
5. With `TRANSCRIPTS_FAKE` set, `transcriptSource(env).fetch(id)` returns the canned result or throws the canned
   failure and `status.ts` answers the canned health; with neither fake nor key, `fetch` throws `PROVIDER_AUTH` and no
   request is made.
6. The Step 0 answers are recorded in the plan: Workflow instances in the pool, `remote: true` bindings beside local
   Durable Objects, `env` assignment visibility under `SELF`, and the owner's confirmation that `media-rag` is 768
   dimensions, cosine, with the `channelId` and `videoId` metadata indexes.
7. `pnpm check` green; the probe against the real provider ran once under `wrangler dev` and left no trace in the
   tree.

## 5. Out of scope

Pre-flight itself, step timeouts and retries (M3.5); section splitting for summaries (M3.3); any Registry or route
change; `YOUTUBE_FEEDS_FAKE` growth (M3.4).

## 6. `AGENTS.md` and PRD alignment

No PRD change. `AGENTS.md` → Testing already names `TRANSCRIPTS_FAKE` and the Transcript seam section already carries
the contract; when this lands, the `lib/transcripts/` layout line describes existing files, and the Testing section
notes that the fake also carries provider status.
