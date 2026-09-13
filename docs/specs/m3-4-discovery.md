# Feature spec — M3.4 Discovery

**Written:** 2026-09-13, against `main` at `e37181c`. The fourth of seven M3 child specs; roadmap
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` §2 (Which channels discovery touches, Which episodes discovery creates,
On-demand start, Latest run on catalog rows, Crons), §3 "channel discovery"; PRD §4.2 rules 1–5 and 27. Acceptance
1, 7 (discovery half), 8, and 9 of the parent.
**Status:** implemented 2026-09-13 on `main`, committed as `6d6b422`; `pnpm check` green; the `wrangler
dev` walkthrough on a real channel is recorded in `docs/specs/m3-4-discovery-plan.md`. No new dependencies.

## 1. Summary

The first product-visible chunk. First approval, the owner's Start, and the discovery cron each read one channel's RSS
feed and record a completed run through the Registry's `recordDiscovery`; the episodes it creates sit `pending` with
their 48-hour window open and appear on the Owner screens with "N episodes discovered", "nothing new", or "feed
unavailable" on the row. `lib/ingestion.ts` replaces its log-only stub with `startDiscovery`; the attempt start point
becomes `startEpisodeAttempts`, which in this chunk still only logs one line per episode, so PRD rule 5's "starts
processing immediately" is deferred to M3.5 by one chunk while nothing is deployed. `POST /channels/:id/runs` is
registered, and the Worker gains its `scheduled` handler with the discovery cron alone.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Approval runs discovery inline | The approve route awaits `startDiscovery` after the channel transition. A feed failure is recorded as an `unavailable` run and logged; approval still answers 200 with the channel. | YouTube's feed answers in well under a second; awaiting means the approve response's `management.latestRun` already tells the owner what the first check found, and RSS can never fail an approval. |
| The attempt start seam | `startEpisodeAttempts(env, episodes, trigger)` exists from this chunk and logs `ingestion.attempt_start_requested` per episode; M3.5 replaces its body. | M3.5 then changes one function and no call site. |
| Cron selection | New Registry read `listDiscoveryChannels()`: `status = 'approved' AND paused_by IS NULL` on the `channels(status, paused_by)` index. | One query, on the index PRD §5.3 reserves for it. |
| Feed override for tests | `startDiscovery(env, channelId, { feed? })` accepts a `ChannelFeed \| null` in place of the fetch. | Static fixtures cannot change between two runs; "a new upload after approval" needs two feeds for one channel. |
| Fake feed shape | `YOUTUBE_FEEDS_FAKE` values become `string \| null \| { title, entries: FeedEntry[] }`; the string form stays. The content lives in `test/fixtures/feeds.ts`; a sixth channel, `CHANNEL_F`, carries the fifteen entries, so the existing fixtures A–E and the tests over them are untouched (built this way rather than adding entries to A and B as the plan first said). | Existing tests keep their fixtures; discovery tests get entries. |
| A feed that answers 404 | Recorded `unavailable`; Start answers 502. | The history says the feed could not be read; the row shows it. |
| The tick is sequential | The discovery tick awaits one channel at a time; a channel's error is caught, logged, and does not stop the others. | Tens of channels at most; sequential keeps logs readable and avoids a burst against YouTube. |

## 3. Contract

`lib/ingestion.ts`:

```ts
export const DISCOVERY_CRON = "0 */6 * * *";
export async function startDiscovery(env, channelId, options?: { feed?: ChannelFeed | null }): Promise<{ run: IngestionRun; created: EpisodeRecord[] }>;
export async function startEpisodeAttempts(env, episodes: EpisodeRecord[], trigger: AttemptTrigger): Promise<void>;   // logs only until M3.5
export async function runDiscoveryTick(env, now): Promise<{ channels: number; read: number; unavailable: number }>;
```

`startDiscovery` fetches through `feedFetcher(env)` unless `feed` is given, maps a thrown `UPSTREAM_UNAVAILABLE` or a
`null` feed to `recordDiscovery(channelId, null)`, otherwise passes the feed, then calls `startEpisodeAttempts` with
the created episodes. It never reads the transcript provider. `requestIngestion` and `IngestionReason` are deleted.

Routes (`routes/channels.ts`): `POST /:id/runs`, tag `runs`, summary "Check the feed now", 200 `IngestionRunResponse`
(`{ run }`), 400, 404, 409 `INVALID_STATE` unless `approved` (pause ignored), 502 `UPSTREAM_UNAVAILABLE` after the
`unavailable` run is recorded. The approve handler awaits `startDiscovery` when `importStarts`, inside a try/catch
that logs.

`index.ts`: a `scheduled(controller, env, ctx)` export dispatching on `controller.cron`, logging an unknown string.
`wrangler.jsonc`: `"triggers": { "crons": ["0 */6 * * *"] }` in `env.production` only (`AGENTS.md` → Environments);
M3.6 adds the second. Staging and dev fire the tick by hand with `wrangler dev --test-scheduled`.

## 4. Acceptance criteria

1. Approving a requested channel whose fake feed has N entries records an `initial` run with `discoveredCount =
   min(N, initialImportCount)`, `episodeLimit`, `feedStatus: read`; the approve response's `management.latestRun`
   carries it and `episodes.pending` equals the count; each episode's `processing.discoveredByRunId` is that run.
2. Approving while system-paused (no followers) still discovers; re-approving a declined channel records nothing.
3. `POST /channels/:id/runs`: approved → 200 with the completed run, zero discovered when nothing is new; a paused
   approved channel → 200 too; requested or declined → 409; unknown → 404; a channel whose fake feed is null → 502,
   `GET /channels/:id/runs` lists the `unavailable` run first, and `lastCheckedAt` is unchanged.
4. A second Start over the same feed creates nothing; with a feed override carrying one entry newer than
   `approvedAt` it creates exactly that entry as `scheduled`; an entry older than `approvedAt` is not created.
5. `SELF.scheduled({ cron: "0 */6 * * *" })` runs discovery for approved unpaused channels only (requested, declined,
   and paused channels keep their `latestRun`), and a channel whose feed fails does not stop the next.
6. Every created episode leaves an `ingestion.attempt_start_requested` log line and no attempt row.
7. `GET /openapi.json` lists the new operation under `runs`; the coverage test passes.
8. `pnpm check` green. Under `wrangler dev` with a real `UC…` channel: approve, see the run and pending episodes on
   the Owner detail; Start again reads "nothing new"; with `wrangler dev --test-scheduled`, `GET
   /__scheduled?cron=0+*/6+*+*+*` runs the tick.

## 5. Out of scope

Attempts, pre-flight, the Workflow (M3.5); the recovery cron (M3.6); the Start button and copy in the web (M3.7);
PRD rule 5's immediate start, true from M3.5.

## 6. `AGENTS.md` and PRD alignment

No PRD change. `AGENTS.md`: the `lib/ingestion.ts` layout line and the Ingestion implementation bullet say discovery
is live and attempt start logs until M3.5; Testing describes the `YOUTUBE_FEEDS_FAKE` shape. `api-reference.md` §3.3:
the `POST /channels/{id}/runs` row is registered.
