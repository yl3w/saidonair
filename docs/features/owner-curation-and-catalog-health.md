# Owner curation and catalog health

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and actors

The owner decides which requested channels enter the active catalog and manages
ingestion exceptions. `/curate` and `/curate/:id` require the owner role and use a
desktop-only presentation. A smaller viewport gets a wider-screen notice; this
presentation restriction is separate from API authorization.

## Current workflows

Curate has Needs you and Catalog sections. Needs you collects requested channels,
failed publications requiring attention, and approved channels with no discovery
run. Empty categories are not rendered. Catalog combines health information with
a sortable table shown in 25-row increments. There is no separate Reviewed section
in the rendered screen.

Channel review shows channel facts, completed discovery runs, and episode rows.
Each episode can expose additional processing diagnostics. Followers' addresses
are fetched there only while the channel is requested; other states show counts.
The episode table requests at most 200 episodes.

| Owner operation | Result |
|---|---|
| Approve | Requested/declined → approved; may change title, initial import count, and review note. First approval starts discovery; reapproval does not repeat that initial trigger. |
| Decline | Requested/approved → declined; clears pause and removes personalized eligibility. Existing content and follows remain. |
| Pause/resume | Approved channels only; changes future scheduled discovery. |
| Check feed | Discovers an approved channel immediately, including one that is paused. |
| Retry episode | Requests a fresh publication/replacement attempt when allowed by the running-attempt and provider checks. |
| Skip episode | Failed → skipped with owner reason and actor recorded. |

Source detail offers the reversible pause/resume and feed-check controls; review
decisions live in Curate. Declining an approved channel opens confirmation that
names the effect on followers. Retry can target any episode state and any channel
state; skip applies only to a failed episode. The processing rules are documented
in [Processing and recovery](episode-processing-and-recovery.md).

## Refresh, health, and errors

Actions reload data after both success and failure because a response can be lost
after a successful write. Curate retains channel rows during refresh and disables
actions while refreshing or after a failed refresh. The channel-review screen
retains its loaded sections. Its episode table polls every 10 seconds while a
loaded episode has a running attempt and stops when none does.

`GET /catalog` combines Registry aggregates with transcript-provider health:
channel/episode counts, attention, running work, last successful ingestion, and
credit/key status. The provider status wrapper caches answers for five minutes
per isolate and uses a two-second timeout. Missing credentials and failed probes
report `unreachable`; they do not fail the aggregate route.

## Implementation map

- [Curate](../../apps/web/src/screens/Curate.tsx),
  [CurateChannel](../../apps/web/src/screens/CurateChannel.tsx),
  [RequestQueue](../../apps/web/src/components/RequestQueue.tsx), and
  [AttentionList](../../apps/web/src/components/AttentionList.tsx) implement management flows.
- [ChannelStatusActions](../../apps/web/src/components/ChannelStatusActions.tsx)
  centralizes available channel actions.
- [Channel routes](../../apps/api/src/routes/channels.ts) and
  [owner middleware](../../apps/api/src/middleware/owner.ts) enforce writes and follower access.
- [Catalog route](../../apps/api/src/routes/catalog.ts),
  [catalog store](../../apps/api/src/do/registry/catalog.ts), and
  [provider status](../../apps/api/src/lib/transcripts/status.ts) supply health.

Review actors and notes are shared catalog records. This feature does not expose
other users' private receipts or chats.

## Tests, limitations, and PRD differences

[Authorization tests](../../apps/api/test/authorization.test.ts) cover the seven
owner mutations and two owner reads.
[Management tests](../../apps/api/test/registry-management.test.ts),
[provider-status tests](../../apps/api/test/transcripts-status.test.ts), and
[action rendering tests](../../apps/web/test/channel-actions.test.tsx) cover
projections, health mapping, and control selection. They do not prove browser
dialog interaction or the live provider balance.

[PRD §7](../../docs/PRD.md) retains text saying the API accepts every operation
from any identity; current owner middleware refuses these operations. The
200-episode review limit also means “every episode” is not an unbounded archive.
Decline does not revoke public direct summary access. Source comments naming a
Reviewed section are stale relative to the rendered two-section Curate screen.
