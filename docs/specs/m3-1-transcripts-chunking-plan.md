# Implementation plan — M3.1 Transcripts and chunking

**Implements:** `docs/specs/m3-1-transcripts-chunking.md` under `AGENTS.md`; parent decisions in
`docs/specs/m3-ingestion.md` §2; roadmap `docs/specs/m3-ingestion-plan.md`.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 in the working tree on `main` (uncommitted until the owner asks): Steps 0, 1, and 2
done, `pnpm check` green with 25 test files, the probe route removed, the scratch files deleted. The one open item is
the owner's: the `media-rag` index does not exist yet (Step 0.4). No new dependencies.
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

Run on 2026-09-13 against `main` at `e37181c` with `@cloudflare/vitest-pool-workers` 0.22.0, `wrangler` 4.129.0,
`miniflare` 5.20260815.0-alpha, the owner's DownSub key (plan `pro`) in `.dev.vars`. Scratch files lived under
`apps/api/scratch/` and were deleted; nothing of them is in the tree.

### Step 0 answers

| Check | Answer |
|---|---|
| 0.1 Workflows in the pool | **Yes.** A scratch `WorkflowEntrypoint` with a `workflows` binding: `create()` answered `status: "running"`, then `"complete"` within a few 250 ms polls; the status object has `status`, `output`, `error`, and `__LOCAL_DEV_STEP_OUTPUTS`; `get("does-not-exist").status()` throws `Error: instance.not_found`. `cloudflare:test` also exports `introspectWorkflowInstance(workflow, id)` and `introspectWorkflow(workflow)` with `modify(m => m.disableSleeps() / mockStepResult / forceStepTimeout)`, `waitForStatus`, `waitForStepResult`, `getOutput`, `getError`, and `dispose`. Noise: miniflare logs `Error: Engine was never started` and a "code had hung" cancellation after the test ends; the test passes. M3.5 can test the real class through the binding, with `disableSleeps()` for the stagger. |
| 0.2 `remote: true` beside local Durable Objects | **Yes, with a switch.** Any `remote: true` binding makes the pool open a remote proxy session at start (`⎔ Establishing remote connection...`), which needs login and the resource: with Vectorize `media-rag` declared the pool failed to start (`Failed to start the remote proxy session … edge-preview … vectorize/get-started`) because the index does not exist. With AI alone remote, the local DO worked and one real `@cf/baai/bge-base-en-v1.5` call returned shape `[1, 768]`. With `remoteBindings: false` in `cloudflarePool({ wrangler, … })` the pool starts offline, the DO works, and touching AI throws `Error: Binding AI needs to be run remotely`. **M3.3 sets `remoteBindings: false` in `vitest.config.ts`** and keeps `remote: true` in `wrangler.jsonc` for `wrangler dev`; the fakes cover tests. |
| 0.3 `env` assignment under `SELF` | **Visible.** `env.WEB_ORIGINS = "http://other.test"` from `cloudflare:test`, then a `SELF` preflight from that origin answered `access-control-allow-origin: http://other.test` (null before the assignment). A route-level test can therefore reassign `env.TRANSCRIPTS_FAKE` for one case; the value persists for the file's isolate, so such a test restores it (M3.5 decides whether `test/setup.ts` does that for everyone). |
| 0.4 `media-rag` | **Does not exist.** `wrangler vectorize list` (read-only): "You haven't created any indexes on this account." Later the same day the owner chose three environments (`AGENTS.md` → Environments), so the indexes are `media-rag-dev` (needed before M3.3 Step 4 and M3.5 Step 5, both local), `media-rag-staging`, and `media-rag` (before each tier's first deploy). M3.1, M3.2, and M3.4 need nothing from them. **`media-rag-dev` created by the owner at 17:44 UTC on 2026-09-13**: 768 dimensions, cosine, metadata indexes `channelId` and `videoId` (String), confirmed read-only with `wrangler vectorize get` and `list-metadata-index`. |

### Probe observations (Step 1.6)

Two `subtitles_found` calls cost one credit each (one direct, one through the Worker); every error call and `/status`
cost nothing. `/status` read `{ status: "success", data: { remainingCredits: 2142, monthlyCredits: 1999, bonusCredits:
143, expiresAt, plan: "pro" } }` before the probes.

| Video | Direct `curl` | Through the Worker (`transcriptSource(env).fetch`) |
|---|---|---|
| `dQw4w9WgXcQ` (captioned) | `state: subtitles_found`, `duration: 213`, tracks by `code`: `en`, `en_auto`, `de-DE` (label `undefined`), more; `formats: [{ format: srt\|vtt\|txt, url }]`; `metadata.isLiveContent: false`, `metadata.availability: { isAvailable, reason, status: "OK", isLiveContent }`; 2.3 s | `english`, 61 segments (the count the InnerTube parse gave on 2026-09-08), first cue 1.36 s, last end 211.32 s, `durationSec: 213`; 2.0 s |
| `jfKfPfyJRdk` (24/7 live radio) | `state: error`, `duration: 36712`, `title` set, `metadata` with `author`, `channelId`, `publishDate`, `keywords`, `thumbnail` (`…maxresdefault_live.jpg`), **no playability field**, `subtitles: []`; 25.5 s | `isLive: true`, `captionStatus: none`, `durationSec: 36712`; 16.5 s and 29.0 s |
| `zzzzzzzzzzz` (bogus) | First call: `state: error`, `duration: 0`, `title: ""`, `metadata.playabilityStatus: "ERROR"`, `playabilityReason: "This video is unavailable"`, `isLiveContent: false`. Second and third calls minutes later (and `aaaaaaaaaaa`): `metadata: {}`. 6.7–8.7 s | With the first classifier ("no reason → live") it read `isLive: true`, wrong. With the final rule (§ below) `UNPLAYABLE: This video is unavailable`; 8.5 s |
| captionless upload | not probed: no fresh captionless video was at hand; `no_subtitles` is known from the 2026-09-08 probe and covered by the fixture and adapter tests. M3.5's walkthrough needs one. | |

The body shape, confirmed: `{ status: "success", data: { state, title, thumbnail, duration (seconds), metadata,
source, subtitles: [{ language, code, formats }], translatedSubtitles, url? } }`. Live and upcoming carry no explicit
flag in the error body; duration and title are what distinguish them from a video YouTube does not have.

### Decisions made while implementing (plan decisions, stand unless vetoed)

- **Error classification** (spec §3.3 rows rewritten): live metadata (`isLiveContent`, a `_live.jpg` thumbnail) →
  waiting; else a `playabilityReason` → `UNPLAYABLE`; else a body that still describes a video (title, positive
  duration, or `channelId`) → waiting, since that is how a live or upcoming video reads; else `UNPLAYABLE` ("no video
  metadata"). The provider's inconsistency about the reason made the planned "reason or live" rule unsafe: a bogus id
  would have waited 48 hours and timed out as `LIVE_OR_UPCOMING`.
- A network failure on the download request is `PROVIDER_HTTP` with the message (the table had no row for it).
- The fake's content and its eleven-character video ids live in `test/fixtures/transcripts.ts`, imported by
  `vitest.config.ts` (Node) and the tests (Workers), so one object defines both.
- `vtt.ts` also exports `parseTimestamp`; `downsub.ts` exports `chooseTrack`, `watchUrl`, and `DOWNSUB_DOWNLOAD_URL`
  for their tests.
- Chunking overlap: one segment when the previous chunk's last segment is longer than 20 s, two otherwise, and the
  overlap shrinks to whatever still lets the next chunk make progress (never a chunk that adds no new segment).
