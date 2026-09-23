# Episode discovery

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and triggers

Discovery turns a channel's RSS entries into shared pending episodes. A discovery
run records a completed feed check and its newly created episodes; it does not
report whether their subsequent transcripts or summaries succeeded.

Three entry points use `startDiscovery`:

- First approval triggers an immediate check, even if approval system-pauses the
  channel because it has no followers.
- Owner `POST /channels/:id/runs` checks an approved channel now, paused or not.
- The production discovery cron, `0 */6 * * *`, checks approved, unpaused channels
  every six hours in UTC.

Reapproval alone does not repeat the first-approval trigger. The scheduled tick
handles channels sequentially and catches per-channel failures so later channels
can still be checked. Cron triggers are configured only in production.

## Selection and flow

1. Read the long-form RSS feed using the channel-derived `UULF…` playlist ID at
   YouTube's public feed endpoint. There is no fallback to the ordinary channel
   feed when long-form discovery is unavailable.
2. The Registry validates that the channel is approved and that any returned feed
   belongs to it. It decides whether this is `initial` or `scheduled` based on
   whether the channel already has an episode, not on the trigger or run count.
3. Sort feed entries newest publication first, remove duplicate IDs, and exclude
   episode IDs already present anywhere in the catalog.
4. For an initial run, take up to `initialImportCount` fresh entries, regardless
   of publication date. Later runs take fresh entries published strictly after
   the channel's first `approvedAt`.
5. In one Registry transaction, record the completed run and insert its pending
   episodes with publication-intent recovery windows. A successful feed read
   updates `lastCheckedAt`, including a read that discovers nothing.
6. Pass created episodes to `startEpisodeAttempts`, which performs provider
   preflight and launches their processing workflows.

Entries outside the selection are not stored as skipped episodes. An initial run
that creates no episodes leaves the next check eligible to be initial again.
The feed is a recent slice, so this mechanism is not a complete historical import
or guaranteed recovery of every upload missed during a long outage.

## Failures and separation from processing

An unavailable feed produces a run with `feedStatus: unavailable`, zero new
episodes, and no successful-check timestamp advancement. An explicit owner check
returns 502 after that run is recorded. The approval handler catches discovery
failure so the approval itself can remain successful.

Discovery selection reads RSS, but the complete `startDiscovery` call also starts
attempts. Therefore an owner feed check that creates episodes can lead to a
transcript-provider status request and later paid processing. It is not accurate
to describe the whole call as never touching the transcript provider.

Recovery does not read feeds; it works on episodes already discovered and is not
stopped by later channel pause or decline. See
[Processing and recovery](episode-processing-and-recovery.md).

## Implementation and evidence

| Responsibility | Source |
|---|---|
| Entry points, tick, and attempt handoff | [ingestion.ts](../../../apps/api/src/lib/ingestion.ts): `startDiscovery`, `runDiscoveryTick`, `runScheduled` |
| Selection and run persistence | [runs store](../../../apps/api/src/do/registry/runs.ts): `recordDiscovery`, `selectEntries` |
| New episode/window records | [episodes store](../../../apps/api/src/do/registry/episodes.ts) |
| Feed URLs and parsing | [rss.ts](../../../apps/api/src/lib/youtube/rss.ts) |
| Manual and approval triggers | [channel routes](../../../apps/api/src/routes/channels.ts) |
| Actual cron configuration | [wrangler.jsonc](../../../apps/api/wrangler.jsonc) |

[Discovery integration tests](../../../apps/api/test/ingestion-discovery.test.ts)
cover approval, reapproval, manual checks, unavailable feeds, and cron selection.
[Registry discovery tests](../../../apps/api/test/registry-discovery.test.ts) cover
selection/persistence. Tests use feed and processing fakes; they do not establish
live RSS availability.

## Implementation notes

Preserve the distinction between a feed-only discovery record and the orchestration
that immediately starts attempts. “Initial” means the channel has no stored episode,
not necessarily its first recorded check; “scheduled” is the persisted kind even
for a later manual check.
