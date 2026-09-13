# Implementation plan — M3.4 Discovery

**Implements:** `docs/specs/m3-4-discovery.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries the discovery half of Step 7 and the discovery cron of Step 8 of the
2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** complete 2026-09-13 in the working tree on `main` (uncommitted until the owner asks): the three code
steps landed together, `pnpm check` green with 32 test files and 250 tests (31 and 242 before), the walkthrough
below run. No new dependencies.
**Shape:** three code steps and a walkthrough, each code step one commit when the owner asks with `pnpm check` green.
Decisions this plan makes are marked **plan decision** and stand unless vetoed.

## Definition of complete

Spec §4, all eight criteria.

### Step 1 — Fake feed entries and channel selection  (size: S)

**Files:** `apps/api/src/lib/youtube/rss.ts`, `apps/api/vitest.config.ts`, `apps/api/src/bindings.d.ts`,
`apps/api/src/do/registry/channels.ts`, `apps/api/src/do/registry.ts`, `apps/api/test/youtube-rss.test.ts`,
`apps/api/test/registry-channels.test.ts`.

- 1.1 `feedFetcher`: an object value renders an Atom document with the given title and entries, so the parser path is
  the same as production; a string keeps today's behaviour.
- 1.2 `vitest.config.ts`: the feeds move to `test/fixtures/feeds.ts`, where a new `CHANNEL_F` carries fifteen
  entries spanning two months for the selection tests; A–E stay as they were (**plan decision**, replacing "A and B
  gain entries": approval now discovers inline, so giving A or B entries would have changed what every existing
  route test sees after an approval).
- 1.3 `channels.ts` `listDiscoverable(sql)` and the facade's `listDiscoveryChannels()`.

**Done when:** `pnpm check` green.

### Step 2 — `startDiscovery`, approval, and the Start route  (size: M)

**Files:** `apps/api/src/lib/ingestion.ts`, `apps/api/src/routes/channels.ts`,
`apps/api/test/ingestion-discovery.test.ts`, `apps/api/test/routes-channels.test.ts`,
`apps/api/test/openapi.test.ts`.

- 2.1 `ingestion.ts`: `startDiscovery` and the logging `startEpisodeAttempts` per spec §3; delete
  `requestIngestion`. **Plan decision:** the log line carries `{ event, channelId, videoId, trigger }` and nothing
  else.
- 2.2 Approve handler: await `startDiscovery` inside try/catch when `importStarts`. Retry handler: drop the
  `requestIngestion` call (M3.5 gives it the starter).
- 2.3 `POST /:id/runs` per spec §3, with `describeRoute` and `validate("param", ChannelParamsSchema)`; the route
  reads the channel first for the 404 and 409, then calls `startDiscovery`, and maps an `unavailable` run to 502.
  `openapi.test.ts` adds the operation to its literal list.

**Tests:** spec §4.1–4.4, 4.6, 4.7.

**Done when:** `pnpm check` green.

### Step 3 — The scheduled handler and the discovery cron  (size: S)

**Files:** `apps/api/src/index.ts`, `apps/api/src/lib/ingestion.ts`, `apps/api/wrangler.jsonc`,
`apps/api/test/scheduled.test.ts`.

- 3.1 `runDiscoveryTick(env, now)` per spec §3; `index.ts` exports `default { fetch: app.fetch, scheduled }`
  dispatching `DISCOVERY_CRON`. **Plan decision:** the default export becomes an object so `scheduled` can join
  `fetch`; the Hono app itself is unchanged.
- 3.2 `wrangler.jsonc` `triggers.crons` with the discovery string.

**Tests:** spec §4.5; an unknown cron string logs and returns.

**Done when:** `pnpm check` green.

### Step 4 — Walkthrough  (size: S)

Under `wrangler dev --test-scheduled` on a scratch `--persist-to` directory: add and approve a real channel with
`initialImportCount: 3`; read `GET /channels/:id` for `latestRun` and `episodes.pending: 3`; `GET
/channels/:id/runs`; `POST /channels/:id/runs` again for "nothing new"; pause the channel and Start again (200);
`GET /__scheduled?cron=0+*/6+*+*+*` and confirm the paused channel is skipped; add a channel with a bogus but
well-formed `UC…` id through the Registry seed path and Start it for the 502. Record the legs below.

## Walkthrough record

Run on 2026-09-13 under `wrangler dev --env dev --test-scheduled --port 8793 --persist-to <scratch directory outside
the repo>` on empty state, so the owner's local state stayed untouched. Identities `alice@example.com` and
`owner@example.com`; the channel Veritasium, `UCHnyfMqiRRG1u-2MsSQLbXA`, fetched from YouTube's live feed. No
transcript call is made anywhere in this chunk.

| Leg | Request | Result |
|---|---|---|
| add | `POST /channels` as alice, `initialImportCount: 3` | 201, `requested`, title "Veritasium" from the feed, alice following |
| approve (§4.1) | `POST /channels/{id}/approve` as owner | 200 in one round trip: `approved`, `paused: false` (alice follows), `episodes.pending: 3`, `management.latestRun` `{ kind: initial, feedStatus: read, discoveredCount: 3, episodeLimit: 3 }`, `lastCheckedAt` set, `neverStarted: false` |
| episodes | `GET /channels/{id}/episodes` as alice | three `pending` episodes, intent `publish`, all naming the run above; the log shows `discovery.recorded` then three `ingestion.attempt_start_requested` lines |
| Start, nothing new (§4.3) | `POST /channels/{id}/runs` as owner | 200 `{ run: { kind: scheduled, feedStatus: read, discoveredCount: 0, episodeLimit: null } }` |
| Start while paused (§4.3) | `POST …/pause`, then `POST …/runs` | 200 with another scheduled run: pause never blocks Start |
| cron with the channel paused (§4.5) | `GET /__scheduled?cron=0+*/6+*+*+*` | "Ran scheduled event"; the channel's run count stayed at 3: the paused channel was skipped; the log shows `discovery.tick` with `channels: 0` |
| cron after resume (§4.5) | `POST …/resume`, then the same `GET` | run count 4, the newest `scheduled · read · 0`; `discovery.tick` with `channels: 1, read: 1` |
| unknown cron | `GET /__scheduled?cron=*+*+*+*+*` | 200, `scheduled.unknown_cron` logged, no run recorded |
| 502 (§4.3) | not exercised here: a feed that YouTube cannot serve needs a channel the API refuses to create, so the leg lives in `ingestion-discovery.test.ts` (fixture channel E, the fake's 404) | |

Decisions made while implementing (plan decisions, stand unless vetoed):

- `startDiscovery` maps both an unreachable feed (`UPSTREAM_UNAVAILABLE`) and YouTube's 404 to an unavailable run;
  any other error propagates. The Start route re-raises `UPSTREAM_UNAVAILABLE` after the run is recorded, which the
  error middleware already maps to 502.
- The scheduled dispatch is `runScheduled(cron, env)` in `lib/ingestion.ts`; `index.ts` exports a typed
  `ExportedHandler<Env>` with `fetch: app.fetch` and `scheduled`, and the Hono app is a named export for the OpenAPI
  test.
- The tick counts `{ channels, read, unavailable, failed }` and logs one `discovery.tick` line; a channel whose
  discovery throws is counted as `failed` and the tick continues.
- Tests fire the cron through the exported handler with the pool's `createScheduledController` and
  `createExecutionContext`; `SELF.scheduled` fails in the pinned pool with a `DataCloneError`.
- The `Channel` representation is unchanged: `latestRun` and `lastCheckedAt` were already in `management`.
