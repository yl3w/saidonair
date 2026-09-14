# Feature spec — Long-form discovery feed

**Written:** 2026-09-14, against `main` at `c0c745d`. Not an M3 child spec: M3 closed on 2026-09-13. This revises
discovery and the transcript classifier after M3, before M4.
**Parent:** PRD §4.1 (channel verification), §4.2 rules 1–5 (discovery runs), 11 (waiting), 12 (skipping), §5.4
(enumerations). Supersedes the live-or-upcoming half of `docs/specs/m3-ingestion.md` §2 "Shorts, live streams,
premieres" and `docs/specs/m3-1-transcripts-chunking.md` §3.3.
**Status:** APPROVED and IMPLEMENTED 2026-09-14 (`fcf482a`…`37cfba1`), `pnpm check` green at 297 tests. It edits an
applied migration; the owner ran the local wipe the same day. The Step 5 walkthrough is **SKIPPED — owner decision,
2026-09-14**. Nothing here is outstanding. No new dependencies.

## 1. Summary

Discovery stops reading a channel's own RSS feed and reads YouTube's auto-generated **long-form uploads playlist**
feed instead, so Shorts and live streams never become episodes at all. Channel verification at add time keeps reading
the channel feed, because that is the feed that answers "does this channel exist" and carries its name.

Because live streams are no longer discovered, `LIVE_OR_UPCOMING` is retired: from the shared enums, from the
`outcome_code` CHECK, from `classify()`, and from the web copy. A video the provider reports as live or upcoming is
now `skipped UNPLAYABLE`.

The change is small in code and large in what lands in the catalog. Shorts are a third to four fifths of a busy
channel's newest fifteen feed entries, and because the feed is capped at fifteen they **crowd out real episodes**:
`initial_import_count: 5` against All-In Podcast today imports four Shorts and one episode.

## 2. Evidence

Probed live on 2026-09-14 against `https://www.youtube.com/feeds/videos.xml` for thirteen channels. The three
auto-playlist prefixes replace `UC` in the channel id and are read with `playlist_id=` instead of `channel_id=`:

| Prefix | Holds |
|---|---|
| `UULF` | long-form uploads |
| `UUSH` | Shorts |
| `UULV` | anything broadcast live, **including finished VODs, permanently** |

- The three **partition the channel feed exactly**: every entry of `channel_id=` fell in exactly one prefix feed, no
  overlap, nothing unclassified, on all thirteen channels.
- Entry shape is **identical** to the channel feed — same `<yt:videoId>`, `<title>`, `<published>`, `<link>`. Only
  the feed head differs (§3.2).
- Composition of the newest fifteen channel-feed entries: All-In 4 long-form / 11 Shorts; CNN 3 / 12; PBS NewsHour
  1 / 10 / 4 live; Lofi Girl 3 / 11; BBC 9 / 6; MKBHD 11 / 4; Fireship 15 / 0.
- `UULV` is a provenance bucket, not a live flag: Fireship's newest `UULV` entry is from 2018, MKBHD's span
  2013–2019, and all fifteen of Linus Tech Tips' are WAN Show episodes. A stream never migrates to `UULF` after it
  ends.
- A prefix feed **404s when its bucket is empty** (Lex Fridman and Andrew Huberman have no `UULV`).
- Scheduled content appears in RSS before it airs: NASA's "Crew-12 Pre-Departure News Conference (Sept. 16, 2026)"
  was in the feed on 2026-09-14, published 2026-09-09.

## 3. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Which feed discovery reads | `…/feeds/videos.xml?playlist_id=UULF<channel id without UC>` | Shorts stop consuming the fifteen-entry cap and stop costing a DownSub call each. The same public RSS endpoint, a different query parameter — within hard rule 2 (§6). |
| Live streams | Out of scope for discovery entirely (**owner decision 2026-09-14**, taken against the evidence in §2 that `UULV` holds finished, transcribable VODs such as every WAN Show episode). | The owner does not want live content in the catalog. Recorded as a decision, not a derivation: it permanently drops a content class that today ingests correctly. |
| The add flow's feed | Unchanged: `channel_id=`. | It is the feed that distinguishes "no such channel" from "no long-form videos", and its `<title>` is the channel name. A `UULF` 404 cannot tell those apart. |
| Where the feed title comes from | `<author><name>`, falling back to `<title>`. | `<author><name>` is the channel name in **both** feed shapes; the playlist feed's `<title>` is literally `"Videos"`. One rule, correct for both, so the parser needs no mode flag. |
| A `UULF` feed that 404s | Recorded `unavailable`, exactly as an unreadable channel feed is today. **No fallback** to `channel_id=`. | A silent fallback would re-import Shorts and live streams and defeat the decision. "Feed unavailable" is already visible in run history. The undocumented prefix dying is the risk this accepts. |
| `LIVE_OR_UPCOMING` | Retired from `AttemptWaitCode`, `AttemptOutcomeCode`, the `0001` CHECK, `classify()`, `WAITING_CODES`, and the web copy. The closed set drops from fifteen codes to fourteen. | Nothing can reach it once live streams are never discovered, and a dead value in a closed enum is a lie about what the system can produce. |
| Where the classifier's two live branches land | **Both** `skipped UNPLAYABLE` (**owner decision 2026-09-14**). The branches stay textually separate so their `failure_detail` differs and either can be split back out. | The owner chose terminal over cautious. §5 records the consequence. |
| `SHORT` | Stays, unchanged, at 180 seconds. | It is a duration rule, not a Shorts detector: a two-minute ordinary landscape upload sits in `UULF` and still is not worth summarising. DownSub returns the duration in the call already made, so the check is free. |
| `isLive` on `TranscriptResult` | Removed. `DownloadBody.isLiveContent` and `.liveThumbnail` stay, used only to choose the detail string. | No successful transcript result can be live any more; keeping the field would imply a state that cannot occur. |
| The test seam | `YOUTUBE_FEEDS_FAKE` keys may be a `UC…` id (serving both URL shapes) or a full `UULF…` playlist id (overriding just the long-form read). | Every existing fixture keeps working untouched, and "this channel's long-form feed 404s" is expressible as `"UULF…": null` with no new flag. |

## 4. Contract

### 4.1 `lib/youtube/rss.ts`

```ts
export function channelFeedUrl(channelId: string): string;    // ?channel_id=UC…      existence + title
export function longFormFeedUrl(channelId: string): string;   // ?playlist_id=UULF…   discovery
export async function fetchChannelFeed(channelId, fetchImpl?): Promise<ChannelFeed | null>;
export async function fetchLongFormFeed(channelId, fetchImpl?): Promise<ChannelFeed | null>;
```

Both fetchers share one `parseFeed`, one 404-means-null rule, and one `UPSTREAM_UNAVAILABLE` for anything else.
`feedUrl` is renamed to `channelFeedUrl`; every existing caller of `fetchChannelFeed` keeps its behaviour.

### 4.2 Parsing both feed heads

`parseFeed` already reads the channel id correctly for both shapes and keeps doing so; only the title rule changes.
The heads differ as follows (verified 2026-09-14):

| | `channel_id=` | `playlist_id=UULF…` |
|---|---|---|
| `<title>` | the channel name | `"Videos"` |
| `<author><name>` | the channel name | the channel name |
| `<link rel="alternate">` | `/channel/UC…` | **absent** |
| `<yt:channelId>` | **without** the `UC` prefix | **with** the `UC` prefix |

`channelIdOf` takes the alternate link when present and otherwise the `UC`-tolerant `<yt:channelId>` — which is why
it already handles the playlist head. The file's comment documenting the prefix-less id is corrected to say it is
the channel feed that strips it, and that the playlist feed does not.

`fakeFeedXml` renders `<author><name>` so the fake exercises the production title path.

### 4.3 The DownSub classifier (`lib/transcripts/downsub.ts`)

The `error` case becomes four throws, no returns:

```ts
case "error":
  if (body.isLiveContent || body.liveThumbnail)
    throw new TranscriptError("UNPLAYABLE", "live or upcoming");
  if (body.playabilityReason)
    throw new TranscriptError("UNPLAYABLE", body.playabilityReason);
  if (!body.describesVideo)
    throw new TranscriptError("UNPLAYABLE", "provider reported an error and no video metadata");
  throw new TranscriptError("UNPLAYABLE", "provider reported an error with no reason");
```

`UNPLAYABLE` is already in `DETERMINISTIC_FAILURES`, so the transcript step spends no retries on any of them — a live
video now costs one DownSub call instead of eight over 48 hours.

`classify()` in `workflows/ingest.ts` loses its `if (result.isLive)` branch; duration is then the first check.

### 4.4 Everything the retirement touches

`packages/shared/src/index.ts` (`EpisodeWaitReasonSchema`, `AttemptOutcomeCodeSchema` and its description),
`apps/api/src/do/registry/types.ts` (`WAITING_CODES`), `apps/api/migrations/registry/0001_init.sql` (the
`outcome_code` CHECK), `apps/web/src/lib/copy.ts` (`WAIT_REASON_COPY`, `OUTCOME_CODE_COPY`; `UNPLAYABLE` reads
"video unavailable or live" in both `OUTCOME_CODE_COPY` and `SKIP_REASON_COPY`).

## 5. The consequence the owner accepted

The fourth branch above — a provider error carrying plausible metadata but no reason — is a **catch-all, not a live
detector**. It is where a transient DownSub error lands when the body happens to describe a video.

Under this spec such an episode is **permanently skipped**: a skip closes the processing window immediately, so the
48-hour recovery rule never retries it, and a skip is not a failure, so it never appears in Needs attention. The only
route back is an owner Retry on an episode nothing will draw attention to.

`docs/specs/m3-1-transcripts-chunking-plan.md` records the mirror-image misclassification caught during the M3.1
spike ("With the first classifier ('no reason → live') it read `isLive: true`, wrong"). The branches are kept
textually separate, with distinct `failure_detail` strings, so that if this bites, the fix is to give the fourth
branch its own outcome again rather than to unpick one condition.

## 6. Hard rule 2

`playlist_id=` is the **same endpoint** as `channel_id=` — `https://www.youtube.com/feeds/videos.xml`, public,
unauthenticated, one query parameter different. This is not a new YouTube endpoint, not InnerTube, not watch-page
scraping, and not the Data API. Hard rule 2 and PRD §1 are unchanged in substance; both gain the parameter so the
allowance is unambiguous.

## 7. Acceptance criteria

1. `longFormFeedUrl("UC" + rest)` is `…/feeds/videos.xml?playlist_id=UULF<rest>`; `channelFeedUrl` is unchanged.
2. `parseFeed` over a playlist-shaped head (no alternate link, `UC`-prefixed `<yt:channelId>`, `<title>Videos</title>`,
   `<author><name>` the channel name) returns the channel id from `<yt:channelId>` and the title from the author name.
   Over a channel-shaped head it returns what it returns today.
3. `recordDiscovery`'s "the feed belongs to another channel" guard passes for a long-form feed of the same channel
   and still rejects one of a different channel.
4. Discovery reads the long-form feed: a channel whose `UC…` fixture has entries discovers them through
   `playlist_id=`; a `"UULF…": null` fixture records an `unavailable` run, leaves `lastCheckedAt` unchanged, and
   `POST /channels/:id/runs` answers 502. No fallback request to `channel_id=` is made.
5. Adding a channel still reads `channel_id=`, still rejects a 404 with `INVALID_INPUT` "no YouTube channel has that
   id", and still takes the title from the feed.
6. A DownSub `error` body with `isLiveContent: true` finishes the attempt `skipped UNPLAYABLE` with
   `failureDetail: "live or upcoming"`; the episode becomes `skipped`, its window closes, and no second attempt is
   scheduled. Same for a `_live.jpg` thumbnail, for a `playabilityReason`, and for a reason-less body that describes
   a video — each with its own detail string.
7. The transcript step makes exactly one provider call for a live video (no step retries).
8. `LIVE_OR_UPCOMING` appears nowhere: not in the shared enums, `WAITING_CODES`, the `0001` CHECK, `classify()`, the
   web copy, or `GET /openapi.json`. `AttemptOutcomeCode` has fourteen members, and the openapi coverage test agrees.
9. Writing `outcome_code = 'LIVE_OR_UPCOMING'` is rejected by the CHECK.
10. `pnpm check` green. Under `wrangler dev` after `/clean-local-do`: approve a real channel that posts both Shorts
    and long-form, and confirm the discovered episodes contain no Short.

## 8. Out of scope

Backfilling or re-classifying episodes discovered from the channel feed before this change (nothing is deployed;
local state is wiped by `/clean-local-do`). Reading `UULV` at all. Merging feeds. Any change to `SHORT`, to the
48-hour rule, to recovery, or to the crons' schedules. M4.

## 9. `AGENTS.md` and PRD alignment

**PRD:** §1 external services gains the parameter note; §4.1 keeps `channel_id=` for verification and points at §4.2
for discovery; §4.2 rule 1 names the long-form feed and states that Shorts and live streams are never discovered;
rule 11's table loses its `LIVE_OR_UPCOMING` row and the wait codes become two; rule 12's `UNPLAYABLE` row absorbs
live and upcoming; §5.4 drops the value from the `outcome_code` prose and the count becomes fourteen.

**AGENTS.md:** the `lib/youtube/` layout line names both feeds; the ingestion bullet says discovery reads the
long-form playlist feed; the Transcript seam block drops `isLive` from `TranscriptResult` and rewrites the `error`
classification to four `UNPLAYABLE` throws.

**Subordinate specs**, updated by the plan's last step: `api-reference.md` §3 enum tables and the drift checklist;
`m3-ingestion.md` rows for the transcript contract, DownSub specifics, and "Shorts, live streams, premieres";
`m3-5-episode-workflow.md` §3.2; `m3-2-attempt-ledger.md` `transcript_checked_at` and `finishAttempt`;
`m3-1-transcripts-chunking.md` §3.3. Completed plan documents and `channel-simplification*.md` are historical
records and are left alone.
