# Implementation plan — M3.4 Discovery

**Implements:** `docs/specs/m3-4-discovery.md` under `AGENTS.md`; parent `docs/specs/m3-ingestion.md`; roadmap
`docs/specs/m3-ingestion-plan.md`. Carries the discovery half of Step 7 and the discovery cron of Step 8 of the
2026-09-12 plan.
**Written:** 2026-09-13, against `main` at `e37181c`.
**Status:** approved; not started. Requires M3.2 on `main`. No new dependencies.
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
- 1.2 `vitest.config.ts`: `CHANNEL_A` and `CHANNEL_B` gain entry lists (fifteen entries spanning two months for the
  selection tests; three for a small channel); the others stay strings.
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

_Filled in during Step 4._
