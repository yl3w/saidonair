# Implementation plan — Long-form discovery feed

**Implements:** `docs/specs/discovery-long-form-feed.md` under `AGENTS.md`.
**Written:** 2026-09-14, against `main` at `c0c745d`.
**Status:** written 2026-09-14, awaiting owner approval. Nothing implemented. No new dependencies.
**Shape:** four code steps and a walkthrough, each code step one commit when the owner asks, with `pnpm check` green
before the next begins. Decisions this plan makes are marked **plan decision** and stand unless vetoed.

**Before Step 3 lands, the owner runs `/clean-local-do`.** Step 3 edits an applied migration
(`0001_init.sql`), so local Durable Object state must be wiped for the new CHECK to take. One wipe already stood
pending from M3.7's `outcome_code` CHECK; this is the same wipe, not a second one.

**PRD §1, §4.1, §4.2 and §5.4, and `AGENTS.md`, were updated with the spec on 2026-09-14** and are not steps here.
Step 4 carries the subordinate specs.

## Definition of complete

Spec §7, all ten criteria.

### Step 1 — Two feeds in `rss.ts`  (size: M)

**Files:** `apps/api/src/lib/youtube/rss.ts`, `apps/api/test/youtube-rss.test.ts`,
`apps/api/test/fixtures/feeds.ts`.

- 1.1 Rename `feedUrl` → `channelFeedUrl`; add `longFormFeedUrl(channelId)` returning
  `…/feeds/videos.xml?playlist_id=UULF${channelId.slice(2)}`, built through `requireChannelId` so a malformed id
  still throws before any fetch.
- 1.2 Split the fetcher: `fetchChannelFeed` and `fetchLongFormFeed` differ only in the URL they build. **Plan
  decision:** both delegate to one private `fetchFeed(url, expectedChannelId, fetchImpl)` holding the 404, the
  `UPSTREAM_UNAVAILABLE` mapping, the parse, and the channel-id match, so the two exported names cannot drift.
- 1.3 `parseFeed`: the title comes from `<author><name>` and falls back to `<title>`. The "feed has no title" error
  fires only when both are absent. `channelIdOf` is unchanged; its comment is corrected to say the **channel** feed
  strips the `UC` prefix and the playlist feed does not, and that the playlist head has no alternate link.
- 1.4 `fakeFeedXml` renders `<author><name>` alongside `<title>` so the fake exercises the production title path.
- 1.5 `feedFetcher`: resolve the requested channel from `channel_id`, else from `playlist_id` by swapping the
  `UULF` prefix back to `UC`. Look up the full `playlist_id` in the canned map **first** and fall back to the `UC`
  key, so a fixture may override just the long-form read. An id in neither form still answers 500.

**Tests:** spec §7.1, §7.2. Both head shapes parsed; a `UULF…`-keyed fixture overriding a `UC…` one; an
unregistered playlist id answering 500.

**Done when:** `pnpm check` green.

### Step 2 — Discovery reads the long-form feed  (size: S)

**Files:** `apps/api/src/lib/ingestion.ts`, `apps/api/test/fixtures/feeds.ts`,
`apps/api/test/ingestion-discovery.test.ts`, `apps/api/test/registry-discovery.test.ts`,
`apps/api/test/routes-channels.test.ts`.

- 2.1 `readFeed` calls `fetchLongFormFeed`. Nothing else in `ingestion.ts` changes: the `unavailable` mapping, the
  run recording, and the attempt start are all untouched.
- 2.2 `routes/channels.ts` is **deliberately not edited** — the add flow keeps `fetchChannelFeed`. The step's diff
  proving that is the point.
- 2.3 Fixtures: a channel keyed `"UULF…": null` for the unavailable path, alongside its `UC…` entry so the channel
  itself still verifies at add time. **Plan decision:** reuse `CHANNEL_F` (the fifteen-entry discovery fixture)
  rather than adding a seventh channel; a new `CHANNEL_G` carries the `UULF…: null` case only.

**Tests:** spec §7.3, §7.4, §7.5. Assert no `channel_id=` request is made during a discovery run (the fake records
the URLs it served).

**Done when:** `pnpm check` green.

### Step 3 — Retire `LIVE_OR_UPCOMING`  (size: M)

**Owner runs `/clean-local-do` before this step is exercised under `wrangler dev`.**

**Files:** `packages/shared/src/index.ts`, `apps/api/src/do/registry/types.ts`,
`apps/api/migrations/registry/0001_init.sql`, `apps/api/src/lib/transcripts/downsub.ts`,
`apps/api/src/lib/transcripts/types.ts`, `apps/api/src/workflows/ingest.ts`, `apps/web/src/lib/copy.ts`,
`apps/api/test/transcripts-downsub.test.ts`, `apps/api/test/transcripts-fake.test.ts`,
`apps/api/test/fixtures/transcripts.ts`, `apps/api/test/workflow-ingest.test.ts`,
`apps/api/test/registry-attempts.test.ts`, `apps/api/test/routes-channels.test.ts`,
`apps/api/test/openapi.test.ts`.

- 3.1 `downsub.ts`: the `error` case becomes the four throws of spec §4.3, in that order, each with its own detail
  string. `isLiveContent` and `liveThumbnail` stay on `DownloadBody` and are read only here.
- 3.2 `transcripts/types.ts`: drop `isLive` from `TranscriptResult`. `workflows/ingest.ts` `classify()` drops its
  `if (result.isLive)` branch, making duration the first check; the doc comment above it loses the live sentence.
- 3.3 Enums: `EpisodeWaitReasonSchema` and `AttemptOutcomeCodeSchema` lose the value and their descriptions are
  reworded; `WAITING_CODES` drops to two.
- 3.4 `0001_init.sql`: the value leaves the `outcome_code` CHECK list.
- 3.5 `copy.ts`: `WAIT_REASON_COPY` loses its entry; `OUTCOME_CODE_COPY` loses its entry and its `UNPLAYABLE` reads
  "video unavailable or live"; `SKIP_REASON_COPY.UNPLAYABLE` matches. Both records are exhaustive over their enum,
  so a missed edit is a typecheck failure, not a runtime surprise.
- 3.6 Fixtures: `test/fixtures/transcripts.ts` drops `isLive` from its shape; `VIDEO_LIVE` becomes a
  `{ failure: "UNPLAYABLE" }` entry.

**Tests:** spec §7.6–§7.9. `workflow-ingest.test.ts`'s table row for `VIDEO_LIVE` becomes
`["skipped", "UNPLAYABLE", "skipped", 1]`; `registry-attempts.test.ts` and `routes-channels.test.ts` swap their
`LIVE_OR_UPCOMING` waiting cases for `CAPTIONS` (the remaining transcript-step wait); a new case asserts the CHECK
rejects the retired value.

**Done when:** `pnpm check` green, and `grep -r LIVE_OR_UPCOMING apps packages` returns nothing outside
`docs/specs/` history.

### Step 4 — Subordinate specs  (size: S)

**Files:** `docs/specs/api-reference.md`, `docs/specs/m3-ingestion.md`,
`docs/specs/m3-5-episode-workflow.md`, `docs/specs/m3-2-attempt-ledger.md`,
`docs/specs/m3-1-transcripts-chunking.md`.

- 4.1 `api-reference.md`: `EpisodeWaitReason` and `AttemptOutcomeCode` rows (fifteen → fourteen), the prose listing
  the codes by status, and the drift checklist entry that names `LIVE_OR_UPCOMING`.
- 4.2 `m3-ingestion.md`: the `TranscriptResult` row loses `isLive`; the DownSub row's `error` sentence becomes the
  four throws; the "Shorts, live streams, premieres" row is rewritten for discovery-level exclusion plus
  `UNPLAYABLE`; the §3 pipeline comment and the attempt-code sentence drop the value.
- 4.3 `m3-5-episode-workflow.md` §3.2 classification order; `m3-2-attempt-ledger.md` `transcript_checked_at` code
  list and the `finishAttempt` outcome union; `m3-1-transcripts-chunking.md` §3.3 table rows.
- 4.4 Each edited spec gets a dated line pointing at `discovery-long-form-feed.md` as what superseded it.

**Plan decision:** completed plan documents (`m3-*-plan.md`) and `channel-simplification*.md` are historical
records of what was decided then and are **not** edited; only living specs are.

**Done when:** `pnpm check` green and no living spec still describes a wait for live content.

### Step 5 — Walkthrough  (size: S)

Under `wrangler dev` on a scratch `--persist-to`, after `/clean-local-do`:

1. Add and approve a real channel that posts both Shorts and long-form with `initialImportCount: 5` — MKBHD
   (`UCBJycsmduvYEL83R_U4JriQ`) had 11 long-form and 4 Shorts in its newest fifteen on 2026-09-14.
2. `GET /channels/:id` for `latestRun` and `episodes.pending: 5`; open each discovered episode and confirm **none**
   is a Short by checking its id against the channel's `UUSH…` feed.
3. Confirm the channel's title on the row is the channel name, not "Videos".
4. `POST /channels/:id/runs` again for "nothing new".
5. Add a channel whose `UULF` feed 404s and Start it for the 502 and the `unavailable` run.

Record the legs below.

## Walkthrough record

_(to be filled in when Step 5 runs)_
