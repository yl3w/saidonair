# Personal digest, Queue, and History

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and eligibility

The digest selects shared available summaries from the caller's active follows
on approved channels. Queue presents unread summaries one day at a time. History
presents eligible read and unread summaries across the archive or on a selected
day. Both screens require a session.

The grouping date is first summary availability (`summaryAvailableAt`), not the
video's publication date. A replacement summary preserves that first availability.
Rows can display the video's publication date while belonging to a different
availability day.

## Current user flows

`/queue` finds the newest day with unread content and holds that day when the
reader finishes it. `/queue/:day` addresses a particular local day. Finishing a
day offers another day rather than advancing automatically. A calendar and channel
filter let the reader change scope. There is no all-days Queue view.

Rows have an explicit mark-done action, which removes a successfully marked row
from Queue. Opening a row alone records nothing. Fifty-row pages accumulate within
the selected day via Show more. Empty-state logic distinguishes a loaded empty
page from an exhausted range and a completed day from a completed backlog.

`/history` loads all eligible days, newest first; `/history/:day` narrows to one.
The calendar uses a five-week window of counts. History labels read state and
offers mark read on unread rows and Undo on read rows. This is the UI location for
removing a receipt. An invalid History date gets an explanatory state rather than
silently posing as that date's history.

## API and persistence

`GET /digest` is a pure read. Its parameters are:

| Parameter | Meaning |
|---|---|
| `from`, `to` | Inclusive/exclusive timestamp strings; either can be omitted for an open bound. The web sends ISO strings. |
| `unread=true` | Keep episodes without the caller's receipt. |
| repeated `channelId` | Intersect requested channels with eligibility. |
| `cursor`, `limit` | Stable availability/episode-ID pagination; default 50, maximum 200. |
| `compact=true` | Return episode ID, channel ID, availability, and read state for counts/indexing. |

Registry queries select shared summaries; the route overlays User DO receipts and
pages through candidates when unread filtering removes rows. The browser computes
local-day boundaries; the API receives instants and no timezone.

`POST /channels/:id/episodes/:episodeId/read` records a receipt, preserving its
original timestamp on repetition. `DELETE` on that path removes it idempotently.
Both require an eligible channel and an existing summary. An ineligible caller
gets 404; an episode with no summary cannot be marked read. Receipts remain private
and survive unfollow, decline, and summary replacement.

## Implementation map

- [Queue](../../../apps/web/src/screens/Queue.tsx) owns day selection, unread indexing,
  row paging, and mark-done behavior.
- [History](../../../apps/web/src/screens/History.tsx),
  [day boundaries](../../../apps/web/src/lib/day.ts), and
  [day counts](../../../apps/web/src/lib/day-counts.ts) own archive/calendar behavior.
- [Digest route](../../../apps/api/src/routes/digest.ts) owns cursor/range validation,
  eligibility, and receipt overlay.
- [Episode store](../../../apps/api/src/do/registry/episodes.ts) owns shared selection;
  [read store](../../../apps/api/src/do/user/reads.ts) owns `summary_reads`.
- [Channel routes](../../../apps/api/src/routes/channels.ts) validate receipt writes.

## Tests and limitations

[Follow/digest tests](../../../apps/api/test/routes-follows-digest.test.ts) cover
range bounds, unread/channel filtering, cursors, compact rows, and receipt retention.
[Read-store tests](../../../apps/api/test/user-reads.test.ts) cover idempotency,
isolation, and large ID lists. These do not establish calendar keyboard behavior
or Queue interaction in a browser.

The Queue day index scans at most 25 compact pages of 200 rows: 5,000 unread
summaries. Older days beyond that scan may be absent from day navigation even
though an explicit day query can still retrieve them. Calendar counts also have
a bounded scan in `useDayCounts`; the database/API archive is not limited to that
UI index. Calendar scans stop after five pages of 200 rows (1,000 summaries in
the window) and return no counts on a request failure. Channel filters live in
component state and are not persisted. Timestamp validation uses `Date.parse`,
so the server accepts parseable strings beyond a strictly enforced ISO format.

Queue is day-scoped. History heads the list with a date when content exists
rather than always displaying a visible “History” heading.
