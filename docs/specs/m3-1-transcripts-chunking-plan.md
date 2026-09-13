# Implementation plan — M3.1 Transcripts and chunking

**Implements:** `docs/specs/m3-1-transcripts-chunking.md` under `AGENTS.md`; parent decisions in
`docs/specs/m3-ingestion.md` §2; roadmap `docs/specs/m3-ingestion-plan.md`.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. No new dependencies.
**Shape:** one verification step and two code steps, each ending with `pnpm check` green and one commit when the owner
asks. Steps 1 and 2 are independent of each other. Nothing here touches the Registry, routes, or web. Decisions this
plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §4, all seven criteria.

### Step 0 — Platform checks  (size: S)

**Files:** this file's walkthrough record only; scratch files are never committed.

- 0.1 In a scratch test under the pool, declare a trivial Workflow class and binding in a scratch wrangler config,
  `create()` one instance, and read its `status()`. Record whether the pinned `@cloudflare/vitest-pool-workers` runs
  Workflows at all, and the status strings it reports.
- 0.2 Add `ai` and `vectorize` bindings with `remote: true` to the scratch config beside the Durable Objects and run
  the existing suite once. Record whether the pool accepts `remote: true` while no test calls the bindings.
- 0.3 In a scratch test, assign `env.WEB_ORIGINS = "http://other.test"` from `cloudflare:test` and send a CORS
  preflight through `SELF`. Record whether the assignment reaches the Worker. This decides how M3.2 and M3.5 drive
  provider status and Workflow states at the route level: through `env` when it does, through injected readers on
  in-process calls when it does not.
- 0.4 Ask the owner to confirm `media-rag` is 768-dimensional, cosine, with `channelId` and `videoId` metadata
  indexes (AGENTS.md → One-time setup). Do not run the commands.

**Done when:** the four answers are in the walkthrough record and the scratch files are gone.

### Step 1 — Transcript contract, VTT parser, DownSub adapter, fake  (size: M)

**Files:** `apps/api/src/lib/transcripts/types.ts`, `vtt.ts`, `downsub.ts`, `index.ts`, `status.ts`,
`apps/api/src/bindings.d.ts`, `apps/api/vitest.config.ts`, `apps/api/test/transcripts-vtt.test.ts`,
`apps/api/test/transcripts-downsub.test.ts`, `apps/api/test/transcripts-status.test.ts`,
`apps/api/test/routes-channels.test.ts` (the catalog health assertion).

- 1.1 `types.ts`: the AGENTS.md block. `TranscriptError` sets `message` to `${reason}: ${detail}`;
  `transcriptFailure(error)` parses the prefix.
- 1.2 `vtt.ts`: `parseVtt` per spec §3.2.
- 1.3 `downsub.ts`: `downsubSource(apiKey, fetchImpl)`; the mapping table of spec §3.3; `chooseTrack(tracks)`
  exported for its test. The response is parsed into a minimal typed shape (`data.state`, `data.subtitles[].{code,
  url}`, `data.metadata.{playabilityReason, …}`) and everything else, `translatedSubtitles` included, is ignored.
  **Plan decision:** the exact metadata field names for live, upcoming, and duration are confirmed against one real
  response in the probe of 1.6 before the mapping is finalised; the 2026-09-08 probe notes name `playabilityReason`
  only.
- 1.4 `index.ts`: `transcriptSource(env)`. The fake parses `TRANSCRIPTS_FAKE` once per isolate and serves `videos`.
  `status.ts`: when the fake is set, `transcriptProviderHealth` answers `status ?? UNREACHABLE` without fetching.
  `bindings.d.ts` documents `TRANSCRIPTS_FAKE` as test-only, the `YOUTUBE_FEEDS_FAKE` way.
- 1.5 `vitest.config.ts`: pin `TRANSCRIPTS_FAKE` with `status: { remainingCredits: 1000, status: "ok" }` and a small
  `videos` set the later chunks reuse: one English video of about ten minutes, one captionless, one non-English, one
  live, one under 180 seconds, and one per failure reason. The catalog route assertion and `transcripts-status.test.ts`
  read the canned `ok` and `1000` instead of `unreachable`; the `unreachable` case moves to a direct
  `providerHealthReader` test with a failing `fetch`.
- 1.6 Probe. **Plan decision:** a temporary `GET /__probe/transcript/:videoId` route, exercised under `wrangler dev`
  with the owner's key against one captioned, one captionless, and one live or upcoming video, its observations
  recorded below, and deleted before the commit. Nothing of it is committed.

**Tests:** spec §4.1–4.3 and 4.5; every HTTP mapping; malformed JSON; an empty VTT reported as `none`; the
`en_auto`-over-label choice; a manual `en-GB` preferred over `en_auto`.

**Done when:** `pnpm check` green and the probe observations are recorded.

### Step 2 — Deterministic chunking  (size: S)

**Files:** `apps/api/src/lib/chunk.ts`, `apps/api/test/chunk.test.ts`.

- 2.1 `chunkTranscript(segments)` per spec §3.5 with exported constants. **Plan decision:** the overlap is one
  segment when the previous chunk's last segment is longer than 20 s, two otherwise, so the overlap stays under about
  30 s of speech.
- 2.2 Oversized segment: split on `.`, `!`, or `?` followed by whitespace, then on whitespace when a sentence still
  exceeds the cap; each piece keeps a proportional share of the segment's duration from its `startSec`.

**Tests:** spec §4.4.

**Done when:** `pnpm check` green.

## Walkthrough record

_Filled in during implementation: the four Step 0 answers; then the probe observations (state values seen, the live
and duration field names, the credit balance from `/status` before and after)._
