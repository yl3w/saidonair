# Channel State Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the channel state model with `requested | approved | declined` plus a pause flag, a Registry follower record, and a four-status episode machine, on a rewritten initial schema, end to end through the API and the web app.

**Architecture:** One deletion task first removes the request entity, the automatic follow, and channel retry against the current schema, so the cutover that follows is smaller. The cutover task rewrites both `0001_init.sql` files and the Registry channel store together, because the status values change under running code. Followers, routes, episodes, and owner actions then land one task each, and the web app is rebuilt screen by screen against the finished API. Every task ends with `pnpm check` green and one commit.

**Tech Stack:** Cloudflare Workers, Hono, Zod 4 in `packages/shared`, Durable Objects with SQLite, Vitest with `@cloudflare/vitest-pool-workers`, Vite + Preact. No new dependencies.

**Spec:** `docs/specs/channel-simplification.md` (written and revised 2026-09-10). Read it in full before any task; section numbers below refer to it.

**Implements:** the spec above under the rules in `AGENTS.md`. **Written:** 2026-09-10, against `feat/channel-simplification` at `5cb8b1d`. **Status:** proposed; starts on the owner's go. Plan decisions are marked **plan decision** and can be vetoed before their task starts.

**Prerequisites (owner):** wipe local Durable Object state once with the `clean-local-do` skill before Task 2 is exercised under `wrangler dev`, so the rewritten `0001` files run from empty (spec §6). Tests need nothing: `test/setup.ts` starts every test from empty objects.

## Global Constraints

- `pnpm`, never `npm`; `pnpm dlx`, never `npx`. Run tasks from the repo root: `pnpm check` (typecheck, lint, test) must pass before each commit; `pnpm lint -- --write` fixes formatting.
- No new dependencies (AGENTS.md hard rule 1). No network in tests: feeds come from `YOUTUBE_FEEDS_FAKE` in `apps/api/vitest.config.ts` (`CHANNEL_A`…`D` have titles "Feed A"…"Feed D"; `CHANNEL_E` has no feed).
- Hard rule 3 becomes "filter to the user's current followed, approved channels" (spec §11). Never an unfiltered Vectorize query; not exercised here because chat is M4.
- Hard rule 4: no destructive commands. The one sanctioned wipe is the owner running `clean-local-do` on local `wrangler dev` state.
- Migrations: `0001_init.sql` in both DOs is rewritten during this plan (spec §6, one-time owner-approved exception). After Task 5 the files were frozen again at the time; both the additive-only and frozen-file rules were withdrawn on 2026-09-12 (PRD §5.4).
- Shared shapes: every request and response shape is a Zod schema in `packages/shared/src/index.ts` with its type beside it; `apps/api` validates with `validate(target, schema)` and documents with `describeRoute`; `apps/web` imports types only (`import type`). Optional text uses the `optionalText` helper (blank is `INVALID_INPUT`).
- API on entities, not roles: no `/owner/*`, no role-named types; owner-only operations carry `requireOwner` and the Registry re-checks the role.
- Typed errors: throw `DomainError(code, detail)` in `do/` and `lib/`; `middleware/errors.ts` maps `INVALID_INPUT` 400, `NOT_OWNER` 403, `NOT_FOUND` 404, `INVALID_STATE` 409.
- Named exports only; no `any`; `snake_case` tables and columns; every table carries `created_at`; ids are `TEXT`; DO SQLite takes at most 100 bound parameters, so `IN (...)` lists go through `chunk()` from `lib/sql.ts`.
- Copy: "Declined" for a declined channel never approved, "Withdrawn" for one that was; "awaiting owner approval"; "paused"; "nobody is waiting"; skip reasons humanised in `apps/web/src/lib/copy.ts` only.
- Tests: Vitest in `apps/api`; `expectShape(schema, body)` on one response per shared schema; owner is `owner@example.com` (`OWNER` in `test/helpers.ts`), users `ALICE` and `BOB`; ids `CHANNEL_A`…`E`, `EPISODE_A`…`C`. `apps/web` has typecheck and lint only.
- Commits: conventional (`feat(api): …`, `feat(web): …`, `test(api): …`, `docs: …`), one logical change each, ending with the attribution lines the session provides.

## Not in this plan

Everything ingestion does at run time is M3 work and stays in the M3 plan, revised against spec §12: the system moving an episode to `available`, `failed`, or `skipped`; the wait reasons; the three-attempt rule; cron selection of approved, unpaused channels; and starting a Workflow at all. This plan leaves `lib/ingestion.ts` log-only, so after Task 12 a channel can be approved and its episodes can be retried or skipped by the owner, but nothing becomes `available` except by the SQL seeding the tests and the walkthrough use.

---

## File structure

Files created, deleted, or reshaped by this plan, with their one responsibility afterwards.

| Path | After this plan |
|---|---|
| `apps/api/migrations/registry/0001_init.sql` | The rewritten Registry schema, exactly spec §6.1 |
| `apps/api/migrations/registry/0002_channel_request_title.sql` | Deleted |
| `apps/api/migrations/registry/index.ts` | Lists `0001_init` only |
| `apps/api/migrations/user/0001_init.sql` | `channel_follows` reduced to spec §6.2; other tables unchanged |
| `apps/api/src/do/registry/channels.ts` | Channel rows: create, approve, decline, request again, pause, resume, lists |
| `apps/api/src/do/registry/followers.ts` | New. `channel_followers`: record follow and unfollow, counts, list, automatic pause |
| `apps/api/src/do/registry/episodes.ts` | Episode reads plus owner skip and retry writes |
| `apps/api/src/do/registry/catalog.ts` | Aggregate summary and management join, new shape |
| `apps/api/src/do/registry/requests.ts` | Deleted |
| `apps/api/src/do/registry/types.ts` | Registry record types for the new model |
| `apps/api/src/do/registry.ts` | RPC facade: the methods routes call |
| `apps/api/src/do/user/follows.ts` | Follow rows without `origin`; no `autoFollow` |
| `apps/api/src/lib/channel-view.ts` | The one projection onto the shared `Channel`; `isApproved` |
| `apps/api/src/lib/eligibility.ts` | Active follows ∩ approved |
| `apps/api/src/lib/outcome.ts` | Deleted |
| `apps/api/src/lib/ingestion.ts` | Start points, still log-only; reasons `channel_approved`, `episode_retry` |
| `apps/api/src/routes/channels.ts` | Channel routes: list, create, get, approve, decline, request, pause, resume, episodes, episode retry and skip, ingestion-runs, followers |
| `apps/api/src/routes/channel-requests.ts` | Deleted |
| `apps/api/src/routes/follows.ts` | Follow routes writing the User DO and the Registry |
| `apps/api/src/routes/catalog.ts` | Unchanged handler; new response shape from the Registry |
| `packages/shared/src/index.ts` | Schemas for the new model; request schemas gone |
| `apps/web/src/api.ts` | Typed client for the routes above |
| `apps/web/src/lib/copy.ts` | Phrases for statuses, pause, skip reasons, wait reasons |
| `apps/web/src/components/AddChannel.tsx` | The one add-or-follow box for everyone, with the declined confirmation |
| `apps/web/src/components/ChannelList.tsx` | Followed and Catalog lists by status |
| `apps/web/src/components/RequestQueue.tsx` | The owner queue of requested channels (rewritten) |
| `apps/web/src/components/Requests.tsx` | Deleted |
| `apps/web/src/components/CatalogTable.tsx` | Needs attention (failed episodes, never started) and All channels |
| `apps/web/src/components/CatalogHealth.tsx` | Health strip, new counts |
| `apps/web/src/screens/*.tsx` | Home, Channel, Owner, OwnerChannel against the new API |

---

## Phase 1 — API

### Task 1: Remove the request entity, the automatic follow, and channel retry

Pure deletion against the current schema, so Task 2's cutover is smaller. Delete and restore stay until Task 2 replaces them with decline.

**Files:**
- Delete: `apps/api/src/routes/channel-requests.ts`, `apps/api/src/do/registry/requests.ts`, `apps/api/src/lib/outcome.ts`, `apps/api/test/routes-channel-requests.test.ts`, `apps/api/test/registry-requests.test.ts`, `apps/api/test/outcome.test.ts`, `apps/web/src/components/Requests.tsx`, `apps/web/src/components/RequestQueue.tsx`
- Modify: `apps/api/src/index.ts`, `apps/api/src/do/registry.ts`, `apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry/channels.ts`, `apps/api/src/do/registry/catalog.ts`, `apps/api/src/do/user.ts`, `apps/api/src/do/user/follows.ts`, `apps/api/src/lib/channel-view.ts`, `apps/api/src/lib/openapi.ts`, `apps/api/src/lib/ingestion.ts`, `apps/api/src/routes/channels.ts`, `packages/shared/src/index.ts`, `apps/web/src/api.ts`, `apps/web/src/lib/copy.ts`, `apps/web/src/screens/Home.tsx`, `apps/web/src/screens/Owner.tsx`, `apps/web/src/screens/OwnerChannel.tsx`, `apps/web/src/components/CatalogTable.tsx`, `apps/web/src/components/OwnerCard.tsx`, `apps/web/src/components/Nav.tsx`
- Test: `apps/api/test/registry-catalog.test.ts`, `apps/api/test/registry-management.test.ts`, `apps/api/test/routes-channels.test.ts`, `apps/api/test/user-follows.test.ts`, `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `RegistryDO` without `submitRequest`, `listOwnRequests`, `listAllRequests`, `listRequestsForChannel`, `approveRequest`, `rejectRequest`, `retryChannel`; a `UserDO` without `autoFollow`; shared schemas without `ChannelRequest*`, `CatalogState`, `RequestOutcome`, `ChannelAlreadyAvailableResponse`, `ApproveChannelRequest*`, `RejectChannelRequestBody`, `Catalog.requests`, `ChannelManagement.requesterCount`, `ChannelFailureCode` stays for now.

- [ ] **Step 1: Delete the files**

```bash
git rm apps/api/src/routes/channel-requests.ts apps/api/src/do/registry/requests.ts apps/api/src/lib/outcome.ts \
  apps/api/test/routes-channel-requests.test.ts apps/api/test/registry-requests.test.ts apps/api/test/outcome.test.ts \
  apps/web/src/components/Requests.tsx apps/web/src/components/RequestQueue.tsx
```

- [ ] **Step 2: Remove the routes and facade methods**

In `apps/api/src/index.ts` drop the `channelRequestRoutes` import and `app.route("/channel-requests", channelRequestRoutes);`.

In `apps/api/src/do/registry.ts` delete the whole `// --- channel requests` section, the `retryChannel` method, the `import * as requests` line, and the `ApproveRequestInput`, `ChannelRequest`, `RejectRequestInput`, `SubmitRequestInput` type imports. In `apps/api/src/do/registry/types.ts` delete `ChannelRequest`, `SubmitRequestInput`, `ApproveRequestInput`, `RejectRequestInput`, and the `requesterCount` field of `ChannelManagementRecord`. In `apps/api/src/do/registry/channels.ts` delete `retryChannel`. In `apps/api/src/do/registry/catalog.ts` delete the `countRequestersByChannel` import and use, the `pendingRequests` query, `requests: { pending: pendingRequests }`, and `requesterCount` in `withManagement`.

In `apps/api/src/routes/channels.ts` delete the `.post("/:id/retry", …)` and `.get("/:id/requests", …)` handlers and the now-unused imports (`ChannelRequestsResponse`, `ChannelRequestsResponseSchema`, `toChannelRequest`). In `apps/api/src/lib/channel-view.ts` drop `requesterCount` from `toManagement`. In `apps/api/src/lib/openapi.ts` delete the `channel-requests` tag entry. In `apps/api/src/lib/ingestion.ts` set `IngestionReason` to `"channel_created" | "owner_retry"` for now (Task 2 renames the first, Task 6 replaces the second).

In `apps/api/src/do/user.ts` delete `autoFollow`; in `apps/api/src/do/user/follows.ts` delete the `autoFollow` function. Leave `origin` in place until Task 2.

- [ ] **Step 3: Remove the shared schemas**

In `packages/shared/src/index.ts` delete: `ChannelRequestStatusSchema`, `CatalogStateSchema`, `RequestOutcomeSchema`, the whole `// --- channel requests` section (`ChannelRequestSchema` through `RejectChannelRequestBodySchema`), `ChannelRequestParamsSchema`, `requests: z.object({ pending: Count })` inside `CatalogSchema`, and `requesterCount` inside `ChannelManagementSchema`. Change the `ChannelResponseSchema` description to `` "`GET /channels/:id`, `POST /channels`, `DELETE /channels/:id`, `POST /channels/:id/restore`" ``.

- [ ] **Step 4: Make the web compile**

`apps/web/src/api.ts`: delete `retryChannel`, `listChannelRequestsFor`, and the whole `// channel requests` block with their type imports. `apps/web/src/lib/copy.ts`: delete `outcomeCopy` and `CATALOG_STATE_COPY` and their type imports. `apps/web/src/screens/Home.tsx`: delete the `Requests` import, the `requests` `useLoad`, and the `<Requests … />` element. `apps/web/src/screens/Owner.tsx`: delete the `RequestQueue` import, the `requests` `useLoad` and its three render branches, and `reloadRequests()` inside `reloadAll`. `apps/web/src/screens/OwnerChannel.tsx`: delete the `requests` `useLoad`, `reloadRequests()`, the `<h2>Requests</h2>` section, the `CATALOG_STATE_COPY` import, the Retry button, and the `requesterCount` text. `apps/web/src/components/CatalogTable.tsx`: delete `retryButton` and its two uses and the `Requesters` column. `apps/web/src/components/OwnerCard.tsx` and `Nav.tsx`: delete the `catalog.requests.pending` terms.

- [ ] **Step 5: Fix the tests that named removed things**

`apps/api/test/registry-catalog.test.ts`: delete `it("retry only applies to failed channels and fences stale runs", …)` and any `retryChannel` line inside `it("rejects every catalog mutation …")`. `apps/api/test/registry-management.test.ts`: delete every `requesterCount` expectation. `apps/api/test/routes-channels.test.ts`: remove the `retry` and `/requests` entries from the `ownerOnly` table and any test that calls them. `apps/api/test/user-follows.test.ts`: delete the two `autoFollow` tests and the `autoFollow` line in `it("validates input", …)`; rewrite `it("an explicit refollow clears the tombstone and becomes manual", …)` to use `follow`, `unfollow`, `follow`. `apps/api/test/openapi.test.ts`: remove `"ChannelRequest"` from the component list and lower `expect(registered.size).toBeGreaterThan(15)` to `12`.

- [ ] **Step 6: Run the check and commit**

Run: `pnpm check`
Expected: typecheck, lint, and every remaining test file pass. If a test still references a removed method, the failure names it; delete that assertion, not the method.

```bash
git add -A
git commit -m "refactor: remove channel requests, automatic follow, and channel retry"
```

### Task 2: Schema reset and the channel model in the Registry

The cutover. Both `0001_init.sql` files are rewritten, and everything that reads channel status moves to `requested | approved | declined` in the same commit, because the CHECK constraints reject the old values the moment the migration changes. Followers (Task 3), the new routes (Task 4), and episode statuses (Task 5) build on this.

**Files:**
- Modify: `apps/api/migrations/registry/0001_init.sql` (replace with spec §6.1 verbatim), `apps/api/migrations/registry/index.ts`, `apps/api/migrations/user/0001_init.sql` (replace the `channel_follows` block with spec §6.2)
- Delete: `apps/api/migrations/registry/0002_channel_request_title.sql`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry/channels.ts` (rewrite), `apps/api/src/do/registry/catalog.ts`, `apps/api/src/do/registry.ts`, `apps/api/src/do/user/follows.ts`, `apps/api/src/do/user/types.ts`, `apps/api/src/lib/channel-view.ts`, `apps/api/src/lib/eligibility.ts`, `apps/api/src/routes/channels.ts`, `apps/api/src/routes/follows.ts`, `apps/api/src/lib/ingestion.ts`
- Modify (compile only, rebuilt in Phase 2): `apps/web/src/lib/copy.ts`, `apps/web/src/components/ChannelList.tsx`, `CatalogTable.tsx`, `CatalogHealth.tsx`, `OwnerCard.tsx`, `Nav.tsx`, `apps/web/src/screens/OwnerChannel.tsx`, `Channel.tsx`
- Test: `apps/api/test/helpers.ts`, `registry-migrations.test.ts`, `user-migrations.test.ts`, `registry-catalog.test.ts` → renamed `registry-channels.test.ts`, `registry-management.test.ts`, `routes-channels.test.ts`, `routes-follows-digest.test.ts`, `user-follows.test.ts`

**Interfaces:**
- Consumes: Task 1's trimmed facade and schemas.
- Produces (Registry store, `do/registry/channels.ts`): `createChannel(sql, input: CreateChannelInput, now): CatalogChannel`, `approveChannel(sql, channelId, reviewer: string, input: ReviewInput, now): CatalogChannel`, `declineChannel(sql, channelId, reviewer, input: ReviewInput, now): CatalogChannel`, `requestChannel(sql, channelId, now): CatalogChannel`, `setPause(sql, channelId, pausedBy: PausedBy | null, now): CatalogChannel`, `listCatalogChannels(sql): CatalogChannel[]` (requested and approved, title order), `listChannels(sql)`, `listChannelsByIds(sql, ids)`, `getChannel(sql, id)`, `requireChannel(sql, id)`.
- Produces (facade `RegistryDO`): `createChannel(email, input)`, `approveChannel(actor, id, input?)`, `declineChannel(actor, id, input?)`, `requestChannel(email, id)`, `pauseChannel(actor, id)`, `resumeChannel(actor, id)`, `listCatalogChannels()`, `listChannels(actor)`, `listChannelsByIds(ids)`, `getChannel(id)`, `getCatalogSummary(actor)`, `listChannelManagement(actor, ids?)`.
- Produces (shared): `ChannelStatus = "requested" | "approved" | "declined"`, `PausedBy = "owner" | "system"`, `Channel` with `status, paused, pausedBy, approvedAt, reviewedAt, reviewNote, lastIngestedAt, processedCount, following, management?`, `ChannelManagement` with `initialImportCount, reviewedByEmail, pausedAt, lastCheckedAt, lifecycleVersion, createdAt, updatedAt, episodes, latestRun, neverStarted`, `Catalog.channels = { requested, approved, paused, declined }`.
- Produces (lib): `isApproved(channel): boolean` in `lib/channel-view.ts`.

- [ ] **Step 1: Replace the migrations**

Copy spec §6.1 into `apps/api/migrations/registry/0001_init.sql`, replacing the whole file, **except** the `episodes` and `ingestion_run_episodes` tables: keep today's definitions of those two (old status values) for now, because the episode store and the test fixtures still write `processed`. Task 5 replaces them with the §6.1 versions; only then is the file frozen. Delete `0002_channel_request_title.sql` with `git rm`. Make `apps/api/migrations/registry/index.ts`:

```ts
import type { Migration } from "../../src/do/migrations";
import init from "./0001_init.sql";

/**
 * Ordered list of Registry DO migrations. 0001 was rewritten once, on 2026-09-10 before first
 * deployment (docs/specs/channel-simplification.md §6); from here on a committed `.sql` file is
 * frozen and changes are appended (AGENTS.md → Data & schema conventions). [Rule withdrawn 2026-09-12.]
 */
export const registryMigrations: readonly Migration[] = [
  { version: "0001_init", sql: init },
];
```

In `apps/api/migrations/user/0001_init.sql` replace the `channel_follows` table and its comment with spec §6.2 (no `origin`, no `origin_request_id`, no check). Update the header comment's "never edit this file" line to the same wording as the Registry file.

- [ ] **Step 2: Write the failing migration tests**

Replace the first two tests in `apps/api/test/registry-migrations.test.ts`:

```ts
it("creates every Registry table on first access and records the one version", async () => {
  const stub = registry();
  await stub.ensureUser(ALICE);
  const { tables, versions } = await runInDurableObject(stub, (_, state) => ({
    tables: state.storage.sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' ORDER BY name`,
      )
      .toArray()
      .map((row) => row.name),
    versions: state.storage.sql
      .exec<{ version: string }>("SELECT version FROM _migrations ORDER BY version")
      .toArray()
      .map((row) => row.version),
  }));
  expect(tables).toEqual([
    "_migrations", "channel_followers", "channels", "episode_summaries", "episodes",
    "global_users", "ingestion_run_episodes", "ingestion_runs",
  ]);
  expect(versions).toEqual(["0001_init"]);
});

it("ties channel columns to status", async () => {
  const stub = registry();
  await stub.ensureUser(ALICE);
  await runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const insert = (cols: string, vals: string) =>
      sql.exec(`INSERT INTO channels (channel_id, title, canonical_url, ${cols}, updated_at, created_at) VALUES ('UCx', 't', 'u', ${vals}, 1, 1)`);
    expect(() => insert("status", "'approved'")).toThrow(/CHECK/i);
    expect(() => insert("status", "'declined'")).toThrow(/CHECK/i);
    expect(() => insert("status, paused_by, paused_at", "'requested', 'system', 1")).toThrow(/CHECK/i);
    expect(() => insert("status", "'pending'")).toThrow(/CHECK/i);
    insert("status", "'requested'");
    expect(() => sql.exec("UPDATE channels SET paused_by = 'owner' WHERE channel_id = 'UCx'")).toThrow(/CHECK/i);
  });
});
```

Leave the episode constraint test (`requires a positive chunk count only when an episode is processed`) alone; Task 5 rewrites it. Replace the FOREIGN KEY case in the last test with an insert into `channel_followers` for `'ghost@example.com'`.

In `apps/api/test/user-migrations.test.ts` change the first test's expected `channel_follows` columns (if asserted) to `channel_id, followed_at, unfollowed_at, updated_at, created_at`, and delete any `origin` assertion.

Run: `pnpm --filter api test -- registry-migrations user-migrations`
Expected: FAIL until Step 1 is applied (the table list still contains `channel_requests`); PASS after it.

- [ ] **Step 3: Shared schemas**

In `packages/shared/src/index.ts`:

```ts
export const ChannelStatusSchema = z
  .enum(["requested", "approved", "declined"])
  .meta({
    id: "ChannelStatus",
    description:
      "The owner's answer. `requested` awaits review; `approved` is ingested and readable; `declined` is hidden from the catalog list, keeps everything, and can be approved or requested again.",
  });
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const PausedBySchema = z.enum(["owner", "system"]).meta({
  id: "PausedBy",
  description: "`system` when no one follows the channel; `owner` when the owner paused it.",
});
export type PausedBy = z.infer<typeof PausedBySchema>;
```

Delete `ChannelFailureCodeSchema` and `FollowOriginSchema`. Replace `ChannelManagementSchema` and `ChannelSchema`:

```ts
export const ChannelManagementSchema = z
  .object({
    initialImportCount: z.number().int(),
    reviewedByEmail: z.string().nullable(),
    pausedAt: UnixMs.nullable(),
    lastCheckedAt: UnixMs.nullable(),
    lifecycleVersion: z.number().int(),
    createdAt: UnixMs,
    updatedAt: UnixMs,
    episodes: EpisodeCountsSchema,
    latestRun: IngestionRunSummarySchema.nullable(),
    neverStarted: z
      .boolean()
      .describe("Approved, yet no ingestion run has ever been recorded."),
  })
  .meta({ id: "ChannelManagement", description: "Owner-only fields of a channel." });

export const ChannelSchema = z
  .object({
    channelId: z.string().describe("Canonical `UC…` id."),
    title: z.string(),
    canonicalUrl: z.string(),
    status: ChannelStatusSchema,
    paused: z.boolean().describe("No new ingestion runs while true. Approved channels only."),
    pausedBy: PausedBySchema.nullable(),
    approvedAt: UnixMs.nullable().describe("First approval; never reset."),
    reviewedAt: UnixMs.nullable(),
    reviewNote: z.string().nullable().describe("The owner's latest note, shown to followers of a declined channel."),
    lastIngestedAt: UnixMs.nullable(),
    processedCount: Count,
    following: z.boolean().describe("Whether the caller follows this channel."),
    management: ChannelManagementSchema.optional(),
  })
  .meta({ id: "Channel", description: "A catalog channel as any caller sees it. `following` is about the caller; `management` is present only for the owner." });
```

In `CatalogSchema` replace the `channels` object with `{ requested: Count, approved: Count, paused: Count, declined: Count }`. In `FollowSchema` delete `origin`. Update the `ChannelsResponseSchema` description to `` "`GET /channels` — requested and approved channels; `?scope=all` (owner) adds declined ones, each with `management`." `` and `ChannelResponseSchema` to `` "`GET /channels/:id`, `POST /channels`, and the channel actions." ``.

- [ ] **Step 4: Registry types and the channel store**

`apps/api/src/do/registry/types.ts`, replacing `CatalogChannel`, `CreateChannelInput`, and `ChannelManagementRecord`:

```ts
export type CatalogChannel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: ChannelStatus;
  initialImportCount: number;
  approvedAt: number | null;
  reviewedAt: number | null;
  reviewedByEmail: string | null;
  reviewNote: string | null;
  pausedBy: PausedBy | null;
  pausedAt: number | null;
  lastCheckedAt: number | null;
  lastIngestedAt: number | null;
  lifecycleVersion: number;
  createdAt: number;
  updatedAt: number;
};

/** Callers resolve URLs to a canonical `UC…` id and fetch the title before calling the DO. */
export type CreateChannelInput = {
  channelId: string;
  title: string;
  initialImportCount?: number;
  /** `approved` only for the owner's add; the facade checks the role. */
  status: "requested" | "approved";
  /** Required with `approved`: the owner, recorded as reviewer. */
  reviewer?: string;
};

export type ReviewInput = {
  title?: string;
  initialImportCount?: number;
  explanation?: string;
};

export type ChannelManagementRecord = {
  channel: CatalogChannel;
  episodes: EpisodeCounts;
  latestRun: IngestionRunSummary | null;
  /** Approved and no run row exists at all. */
  neverStarted: boolean;
};
```

Rewrite `apps/api/src/do/registry/channels.ts`. Keep `canonicalChannelUrl`, `getChannel`, `listChannelsByIds`, `listChannels`, `requireChannel`, `requireTitle`, `optionalImportCount`; replace the rest:

```ts
const CHANNEL_COLUMNS = `channel_id, title, canonical_url, status, initial_import_count, approved_at,
  reviewed_at, reviewed_by_email, review_note, paused_by, paused_at, last_checked_at,
  last_ingested_at, lifecycle_version, created_at, updated_at`;

/** The browsable catalog: requested and approved, title order. Declined channels are reachable by id only. */
export function listCatalogChannels(sql: SqlStorage): CatalogChannel[] {
  return sql
    .exec<ChannelRow>(
      `SELECT ${CHANNEL_COLUMNS} FROM channels
       WHERE status IN ('requested', 'approved')
       ORDER BY title COLLATE NOCASE, channel_id`,
    )
    .toArray()
    .map(toChannel);
}

/**
 * Creates a channel; `INVALID_STATE` when the id exists in any status. Create-only on purpose
 * (db26c74): the route treats that refusal as "exists" and follows or reopens instead.
 */
export function createChannel(sql: SqlStorage, input: CreateChannelInput, now: number): CatalogChannel {
  const channelId = requireChannelId(input.channelId);
  if (getChannel(sql, channelId)) {
    throw new DomainError("INVALID_STATE", "channel is already in the catalog");
  }
  const approved = input.status === "approved";
  if (approved && !input.reviewer) {
    throw new DomainError("INVALID_INPUT", "an approved channel needs a reviewer");
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `INSERT INTO channels (channel_id, title, canonical_url, status, initial_import_count,
           approved_at, reviewed_at, reviewed_by_email, lifecycle_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, COALESCE(?, 5), ?, ?, ?, 1, ?, ?)
         RETURNING ${CHANNEL_COLUMNS}`,
        channelId, requireTitle(input.title), canonicalChannelUrl(channelId), input.status,
        optionalImportCount(input.initialImportCount),
        approved ? now : null, approved ? now : null, approved ? input.reviewer : null, now, now,
      )
      .one(),
  );
}

/** `requested | declined → approved`. Sets approved_at once; the caller starts the import only when it was null. */
export function approveChannel(sql: SqlStorage, channelId: string, reviewer: string, input: ReviewInput, now: number): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status === "approved") {
    throw new DomainError("INVALID_STATE", "channel is already approved");
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET status = 'approved', title = COALESCE(?, title),
             initial_import_count = COALESCE(?, initial_import_count),
             approved_at = COALESCE(approved_at, ?), reviewed_at = ?, reviewed_by_email = ?,
             review_note = ?, paused_by = NULL, paused_at = NULL, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        optionalTitle(input.title), optionalImportCount(input.initialImportCount), now, now, reviewer,
        optionalNote(input.explanation), now, channel.channelId,
      )
      .one(),
  );
}

/** `requested | approved → declined`. From approved, bumps the fence so a run in flight publishes nothing. */
export function declineChannel(sql: SqlStorage, channelId: string, reviewer: string, input: ReviewInput, now: number): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status === "declined") {
    throw new DomainError("INVALID_STATE", "channel is already declined");
  }
  const bump = channel.status === "approved" ? 1 : 0;
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels
         SET status = 'declined', reviewed_at = ?, reviewed_by_email = ?, review_note = ?,
             paused_by = NULL, paused_at = NULL, lifecycle_version = lifecycle_version + ?, updated_at = ?
         WHERE channel_id = ?
         RETURNING ${CHANNEL_COLUMNS}`,
        now, reviewer, optionalNote(input.explanation), bump, now, channel.channelId,
      )
      .one(),
  );
}

/** `declined → requested`, keeping the review fields so the queue can show them. */
export function requestChannel(sql: SqlStorage, channelId: string, now: number): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status !== "declined") {
    throw new DomainError("INVALID_STATE", `only a declined channel can be requested again (status: ${channel.status})`);
  }
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels SET status = 'requested', updated_at = ? WHERE channel_id = ? RETURNING ${CHANNEL_COLUMNS}`,
        now, channel.channelId,
      )
      .one(),
  );
}

/** Sets or clears the pause on an approved channel. Idempotent. */
export function setPause(sql: SqlStorage, channelId: string, pausedBy: PausedBy | null, now: number): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  if (channel.status !== "approved") {
    throw new DomainError("INVALID_STATE", "only approved channels can be paused or resumed");
  }
  if (channel.pausedBy === pausedBy) return channel;
  return toChannel(
    sql
      .exec<ChannelRow>(
        `UPDATE channels SET paused_by = ?, paused_at = ?, updated_at = ? WHERE channel_id = ? RETURNING ${CHANNEL_COLUMNS}`,
        pausedBy, pausedBy === null ? null : now, now, channel.channelId,
      )
      .one(),
  );
}

function optionalTitle(value: string | undefined): string | null {
  const title = value?.trim();
  return title ? title : null;
}

function optionalNote(value: string | undefined): string | null {
  const note = value?.trim();
  return note ? note : null;
}

function toStatus(value: string): ChannelStatus {
  if (value === "requested" || value === "approved" || value === "declined") return value;
  throw new Error(`unexpected channels.status: ${value}`);
}

function toPausedBy(value: string | null): PausedBy | null {
  if (value === null || value === "owner" || value === "system") return value;
  throw new Error(`unexpected channels.paused_by: ${value}`);
}
```

`ChannelRow` and `toChannel` map the new columns one to one (`approved_at → approvedAt`, `review_note → reviewNote`, `paused_by → pausedBy` via `toPausedBy`, and so on). Delete `deleteChannel`, `restoreChannel`, `listAvailableChannels`, `toFailureCode`.

- [ ] **Step 5: Catalog summary, facade, projections**

`apps/api/src/do/registry/catalog.ts`, `summarize`: replace the channel counting with

```ts
const channels = { requested: 0, approved: 0, paused: 0, declined: 0 };
for (const row of sql.exec<{ status: string; paused: number; n: number }>(
  `SELECT status, (paused_by IS NOT NULL) AS paused, COUNT(*) AS n FROM channels GROUP BY status, paused`,
)) {
  if (row.status === "requested") channels.requested += row.n;
  else if (row.status === "declined") channels.declined += row.n;
  else if (row.paused) channels.paused += row.n;
  else channels.approved += row.n;
}
```

and delete the `stuckPending` query and field. In `withManagement` replace `stuckPending` with `neverStarted: channel.status === "approved" && !(channel.channelId in latest)`; the `active` set is no longer needed there.

`apps/api/src/do/registry.ts`: replace the catalog section with

```ts
/** The browsable catalog: requested and approved channels. */
listCatalogChannels(): CatalogChannel[] {
  return channels.listCatalogChannels(this.#sql);
}

/** Any status, including declined; used for follows and channel views. */
listChannelsByIds(channelIds: string[]): CatalogChannel[] {
  return channels.listChannelsByIds(this.#sql, requireChannelIds(channelIds));
}

getChannel(channelId: string): CatalogChannel | null {
  return channels.getChannel(this.#sql, requireChannelId(channelId));
}

/** Owner: every channel in every status. */
listChannels(actorEmail: string): CatalogChannel[] {
  this.#assertOwner(actorEmail);
  return channels.listChannels(this.#sql);
}

/**
 * Anyone creates a `requested` channel; only the owner creates an `approved` one. Create-only:
 * `INVALID_STATE` when the id exists, which the route turns into follow or request-again.
 */
createChannel(email: string, input: CreateChannelInput): CatalogChannel {
  const actor = users.requireEmail(email);
  if (input.status === "approved") this.#assertOwner(actor);
  return this.#transaction(() =>
    channels.createChannel(this.#sql, { ...input, reviewer: input.status === "approved" ? actor : undefined }, Date.now()),
  );
}

/** Owner: `requested | declined → approved`. `importStarts` is true when approved_at was null before. */
approveChannel(actorEmail: string, channelId: string, input: ReviewInput = {}): { channel: CatalogChannel; importStarts: boolean } {
  const reviewer = this.#assertOwner(actorEmail);
  return this.#transaction(() => {
    const before = channels.requireChannel(this.#sql, requireChannelId(channelId));
    const channel = channels.approveChannel(this.#sql, before.channelId, reviewer, input, Date.now());
    return { channel, importStarts: before.approvedAt === null };
  });
}

/** Owner: `requested | approved → declined`; from approved the fence is bumped. */
declineChannel(actorEmail: string, channelId: string, input: ReviewInput = {}): CatalogChannel {
  const reviewer = this.#assertOwner(actorEmail);
  return channels.declineChannel(this.#sql, channelId, reviewer, input, Date.now());
}

/** Anyone: `declined → requested`. The route follows the caller afterwards. */
requestChannel(email: string, channelId: string): CatalogChannel {
  users.requireEmail(email);
  return channels.requestChannel(this.#sql, channelId, Date.now());
}

pauseChannel(actorEmail: string, channelId: string): CatalogChannel {
  this.#assertOwner(actorEmail);
  return channels.setPause(this.#sql, channelId, "owner", Date.now());
}

/** Owner resume clears either kind of pause. */
resumeChannel(actorEmail: string, channelId: string): CatalogChannel {
  this.#assertOwner(actorEmail);
  return channels.setPause(this.#sql, channelId, null, Date.now());
}
```

Delete `listAvailableChannels`, `deleteChannel`, `restoreChannel`; import `ReviewInput`.

`apps/api/src/lib/channel-view.ts`: rename `isAvailable` to `isApproved` (`channel.status === "approved"`), and make `toChannel` emit `status, paused: channel.pausedBy !== null, pausedBy, approvedAt, reviewedAt, reviewNote, lastIngestedAt, processedCount, following` and `toManagement` emit `initialImportCount, reviewedByEmail, pausedAt, lastCheckedAt, lifecycleVersion, createdAt, updatedAt, episodes, latestRun, neverStarted`. `apps/api/src/lib/eligibility.ts`: `channels.filter(isApproved)`.

- [ ] **Step 6: Routes, minimally, and the User DO**

`apps/api/src/routes/channels.ts`: delete the `.delete("/:id")` and `.post("/:id/restore")` handlers. In `GET /` replace `listAvailableChannels` with `listCatalogChannels`. In `POST /` drop `requireOwner`; build `status: isOwner(c) ? "approved" : "requested"` into the `createChannel` input, keep the existing feed check, and call `requestIngestion(channel.channelId, "channel_approved")` only when the status is approved (rename the reason in `lib/ingestion.ts` from `channel_created`). Return `ownerChannel(c, id)` for the owner and `toChannel(channel, { following: false, processedCount: 0 })` otherwise. Replace `visibleChannel` with a plain `requireChannel` that returns any status (404 only when the id is unknown); `GET /:id/episodes` gets `includeSummary` as before, so a requested or declined channel simply has none. Task 4 adds the action routes and the follow-on-create behaviour.

`apps/api/src/routes/follows.ts`: use `isApproved`; the error text becomes `"only requested or approved channels can be followed"` with the guard `channel.status === "declined"` (Task 3 completes this). Remove `origin` from `toFollow`.

`apps/api/src/do/user/follows.ts` and `do/user/types.ts`: delete `origin`, `origin_request_id`, `originRequestId`, `toOrigin`, and the `FollowOrigin` import; `follow()` inserts `(channel_id, followed_at, created_at, updated_at)` and the refollow `UPDATE` sets only `followed_at`, `unfollowed_at = NULL`, `updated_at`.

- [ ] **Step 7: Web, compile only**

`apps/web/src/lib/copy.ts`: `CHANNEL_STATUS_COPY: Record<ChannelStatus, string> = { requested: "Awaiting owner approval", approved: "Approved", declined: "Declined" }`; delete `FAILURE_COPY`, `failureCopy`, and `UNAVAILABLE_FOLLOW_COPY`. `ChannelList.tsx`: `channel.available` → `channel.status === "approved"`; the unavailable meta text becomes `CHANNEL_STATUS_COPY[channel.status]`. `CatalogTable.tsx`: the state cell shows `CHANNEL_STATUS_COPY[c.status]` plus `" · paused"` when `c.paused`; delete the failed and stuck sections and every `deletedAt` and `failureCode` use; the delete and restore buttons go (Task 10 adds the new actions). `CatalogHealth.tsx`: `CatalogFilter = "all" | "requested" | "approved" | "paused" | "declined"` and four buttons for the new counts. `OwnerCard.tsx` and `Nav.tsx`: the attention count is `0` for now with a `// Task 10` comment. `OwnerChannel.tsx` header: status copy and `paused`, `approved since <Time at={c.approvedAt} />`; drop failure, `availableAt`, delete and restore. `Channel.tsx`: the "not available" branch stays for 404 only.

- [ ] **Step 8: Tests**

`apps/api/test/helpers.ts`: replace `setChannelState` with

```ts
type ChannelState = { status: "requested" | "approved" | "declined"; approvedAt?: number; pausedBy?: "owner" | "system" };

/** Drives channel status directly; the facade methods are exercised in registry-channels.test.ts. */
export async function setChannelState(channelId: string, state: ChannelState): Promise<void> {
  const approved = state.status === "approved" || state.approvedAt !== undefined;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `UPDATE channels SET status = ?, approved_at = ?, reviewed_at = COALESCE(reviewed_at, 1),
         reviewed_by_email = COALESCE(reviewed_by_email, 'owner@example.com'),
         paused_by = ?, paused_at = ? WHERE channel_id = ?`,
      state.status, approved ? (state.approvedAt ?? 1) : null,
      state.pausedBy ?? null, state.pausedBy ? 1 : null, channelId,
    );
  });
}
```

Rename `registry-catalog.test.ts` to `registry-channels.test.ts` and replace its body:

```ts
describe("registry channels", () => {
  it("users create requested channels, the owner creates approved ones, never twice", async () => {
    const stub = registry();
    const requested = await stub.createChannel(ALICE, { channelId: CHANNEL_A, title: "A", status: "requested" });
    expect(requested).toMatchObject({ status: "requested", approvedAt: null, reviewedAt: null, pausedBy: null, lifecycleVersion: 1 });
    await expectDomainError(stub.createChannel(ALICE, { channelId: CHANNEL_B, title: "B", status: "approved" }), "NOT_OWNER");
    const approved = await stub.createChannel(OWNER, { channelId: CHANNEL_B, title: "B", status: "approved" });
    expect(approved).toMatchObject({ status: "approved", reviewedByEmail: OWNER });
    expect(approved.approvedAt).not.toBeNull();
    await expectDomainError(stub.createChannel(ALICE, { channelId: CHANNEL_A, title: "A", status: "requested" }), "INVALID_STATE");
  });

  it("approve sets approved_at once and reports whether the import should start", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, { channelId: CHANNEL_A, title: "A", status: "requested" });
    const first = await stub.approveChannel(OWNER, CHANNEL_A, { title: "Better", explanation: "ok" });
    expect(first.importStarts).toBe(true);
    expect(first.channel).toMatchObject({ status: "approved", title: "Better", reviewNote: "ok", reviewedByEmail: OWNER });
    await expectDomainError(stub.approveChannel(OWNER, CHANNEL_A), "INVALID_STATE");
    await expectDomainError(stub.approveChannel(ALICE, CHANNEL_A), "NOT_OWNER");

    const declined = await stub.declineChannel(OWNER, CHANNEL_A, { explanation: "withdrawn" });
    expect(declined).toMatchObject({ status: "declined", lifecycleVersion: 2, reviewNote: "withdrawn", pausedBy: null });
    const again = await stub.approveChannel(OWNER, CHANNEL_A);
    expect(again.importStarts).toBe(false);
    expect(again.channel.approvedAt).toBe(first.channel.approvedAt);
  });

  it("decline from requested keeps the fence; request again reopens and keeps the note", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, { channelId: CHANNEL_A, title: "A", status: "requested" });
    const declined = await stub.declineChannel(OWNER, CHANNEL_A, { explanation: "no" });
    expect(declined).toMatchObject({ status: "declined", lifecycleVersion: 1, reviewNote: "no" });
    await expectDomainError(stub.declineChannel(OWNER, CHANNEL_A), "INVALID_STATE");
    const reopened = await stub.requestChannel(BOB, CHANNEL_A);
    expect(reopened).toMatchObject({ status: "requested", reviewNote: "no", reviewedByEmail: OWNER });
    await expectDomainError(stub.requestChannel(BOB, CHANNEL_A), "INVALID_STATE");
  });

  it("pause and resume apply to approved channels only, idempotently", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A", status: "approved" });
    await stub.createChannel(ALICE, { channelId: CHANNEL_B, title: "B", status: "requested" });
    const paused = await stub.pauseChannel(OWNER, CHANNEL_A);
    expect(paused.pausedBy).toBe("owner");
    expect(paused.pausedAt).not.toBeNull();
    expect(await stub.pauseChannel(OWNER, CHANNEL_A)).toEqual(paused);
    expect((await stub.resumeChannel(OWNER, CHANNEL_A)).pausedBy).toBeNull();
    await expectDomainError(stub.pauseChannel(OWNER, CHANNEL_B), "INVALID_STATE");
    await expectDomainError(stub.pauseChannel(ALICE, CHANNEL_A), "NOT_OWNER");
  });

  it("lists requested and approved publicly; declined only by id or to the owner", async () => {
    const stub = registry();
    await stub.createChannel(ALICE, { channelId: CHANNEL_A, title: "A", status: "requested" });
    await stub.createChannel(OWNER, { channelId: CHANNEL_B, title: "B", status: "approved" });
    await stub.createChannel(ALICE, { channelId: CHANNEL_C, title: "C", status: "requested" });
    await stub.declineChannel(OWNER, CHANNEL_C);
    expect((await stub.listCatalogChannels()).map((c) => c.channelId)).toEqual([CHANNEL_A, CHANNEL_B]);
    expect((await stub.listChannels(OWNER)).map((c) => c.channelId).sort()).toEqual([CHANNEL_A, CHANNEL_B, CHANNEL_C]);
    expect((await stub.getChannel(CHANNEL_C))?.status).toBe("declined");
    await expectDomainError(stub.listChannels(ALICE), "NOT_OWNER");
  });
});
```

`registry-management.test.ts`: the summary expectation becomes `channels: { requested, approved, paused, declined }` and the management join asserts `neverStarted` (true for an approved channel with no run, false once `seedRun` has run). `routes-channels.test.ts`: `seedCatalog` creates A approved (`OWNER`, `status: "approved"`), B requested (`ALICE`), C approved then `declineChannel(OWNER, CHANNEL_C)`; the reader listing expects A and B, the owner listing all three; the `ownerOnly` table loses `DELETE` and `restore` and gains nothing yet. `routes-follows-digest.test.ts`: "excludes deleted channels" becomes "excludes declined channels" via `declineChannel`. `user-follows.test.ts`: remove every `origin` expectation.

Run: `pnpm check`
Expected: PASS. Anything still mentioning `available`, `deletedAt`, `failureCode`, or `origin` fails typecheck first and names the file.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): channels are requested, approved, or declined on a rewritten initial schema"
```

### Task 3: The follower record and automatic pause

**Files:**
- Create: `apps/api/src/do/registry/followers.ts`, `apps/api/test/registry-followers.test.ts`
- Modify: `apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry.ts`, `apps/api/src/lib/channel-view.ts`, `apps/api/src/routes/follows.ts`, `apps/api/src/routes/channels.ts`, `packages/shared/src/index.ts`
- Test: `apps/api/test/routes-follows-digest.test.ts`, `apps/api/test/routes-channels.test.ts`

**Interfaces:**
- Consumes: `setPause`, `requireChannel`, `CatalogChannel` from Task 2.
- Produces (store `followers.ts`): `recordFollow(sql, channelId, email, now): CatalogChannel`, `recordUnfollow(sql, channelId, email, now): CatalogChannel`, `countActiveByChannel(sql, channelIds): Record<string, number>` (zero-filled), `listActive(sql, channelId): FollowerRecord[]`.
- Produces (facade): `recordFollow(email, channelId): CatalogChannel`, `recordUnfollow(email, channelId): CatalogChannel`, `countFollowers(channelIds): Record<string, number>`, `listFollowers(actor, channelId): FollowerRecord[]`.
- Produces (shared): `Channel.followerCount: number`; `FollowerSchema { email, followedAt }`, `FollowersResponseSchema { followers: Follower[] }`; `ChannelDeclinedResponseSchema { error, code: "INVALID_STATE", channelId, status: "declined", reviewNote, reviewedAt }`.
- Produces (types): `FollowerRecord = { email: string; followedAt: number }`; `ChannelView.followerCount: number`.

- [ ] **Step 1: Write the failing store tests**

`apps/api/test/registry-followers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALICE, BOB, CHANNEL_A, CHANNEL_B, expectDomainError, OWNER, registry } from "./helpers";

describe("registry followers", () => {
  it("records follows and unfollows per channel and email, idempotently", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A", status: "approved" });
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.recordFollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A, CHANNEL_B])).toEqual({ [CHANNEL_A]: 2, [CHANNEL_B]: 0 });
    expect((await stub.listFollowers(OWNER, CHANNEL_A)).map((f) => f.email).sort()).toEqual([ALICE, BOB]);
    await stub.recordUnfollow(BOB, CHANNEL_A);
    expect(await stub.countFollowers([CHANNEL_A])).toEqual({ [CHANNEL_A]: 1 });
    await expectDomainError(stub.listFollowers(ALICE, CHANNEL_A), "NOT_OWNER");
    await expectDomainError(stub.recordFollow(ALICE, CHANNEL_B), "NOT_FOUND");
  });

  it("pauses an approved channel when its last follower leaves and resumes on the next follow", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A", status: "approved" });
    await stub.recordFollow(ALICE, CHANNEL_A);
    const paused = await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect(paused.pausedBy).toBe("system");
    const resumed = await stub.recordFollow(BOB, CHANNEL_A);
    expect(resumed.pausedBy).toBeNull();
  });

  it("never overrides an owner pause and never pauses a requested channel", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A", status: "approved" });
    await stub.createChannel(ALICE, { channelId: CHANNEL_B, title: "B", status: "requested" });
    await stub.recordFollow(ALICE, CHANNEL_A);
    await stub.pauseChannel(OWNER, CHANNEL_A);
    await stub.recordUnfollow(ALICE, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("owner");
    await stub.recordFollow(BOB, CHANNEL_A);
    expect((await stub.getChannel(CHANNEL_A))?.pausedBy).toBe("owner");
    await stub.recordFollow(ALICE, CHANNEL_B);
    const requested = await stub.recordUnfollow(ALICE, CHANNEL_B);
    expect(requested.pausedBy).toBeNull();
  });
});
```

Run: `pnpm --filter api test -- registry-followers`
Expected: FAIL, `recordFollow is not a function`.

- [ ] **Step 2: The store**

`apps/api/src/do/registry/followers.ts`:

```ts
import { chunk, placeholders } from "../../lib/sql";
import { getChannel, requireChannel, setPause } from "./channels";
import type { CatalogChannel, FollowerRecord } from "./types";

/**
 * Who follows what, shared with the Registry so it can list requesters, count followers, and pause a
 * channel nobody follows (docs/specs/channel-simplification.md §3.2). The User DO's channel_follows is
 * the source of truth for the user's own list; the follow routes keep the two in step.
 */
export function recordFollow(sql: SqlStorage, channelId: string, email: string, now: number): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  sql.exec(
    `INSERT INTO channel_followers (channel_id, user_email, followed_at, unfollowed_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)
     ON CONFLICT (channel_id, user_email) DO UPDATE
       SET followed_at = CASE WHEN unfollowed_at IS NULL THEN followed_at ELSE excluded.followed_at END,
           unfollowed_at = NULL, updated_at = excluded.updated_at`,
    channel.channelId, email, now, now, now,
  );
  // A follow lifts a system pause; an owner pause needs the owner.
  if (channel.pausedBy === "system") return setPause(sql, channel.channelId, null, now);
  return channel;
}

export function recordUnfollow(sql: SqlStorage, channelId: string, email: string, now: number): CatalogChannel {
  const channel = requireChannel(sql, channelId);
  sql.exec(
    `UPDATE channel_followers SET unfollowed_at = ?, updated_at = ?
     WHERE channel_id = ? AND user_email = ? AND unfollowed_at IS NULL`,
    now, now, channel.channelId, email,
  );
  // The last follower leaving pauses an approved channel, unless the owner already paused it.
  const active = countActiveByChannel(sql, [channel.channelId])[channel.channelId] ?? 0;
  if (active === 0 && channel.status === "approved" && channel.pausedBy === null) {
    return setPause(sql, channel.channelId, "system", now);
  }
  return getChannel(sql, channel.channelId) ?? channel;
}

/** Active followers per channel, zero-filled for every requested id. */
export function countActiveByChannel(sql: SqlStorage, channelIds: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of channelIds) counts[id] = 0;
  for (const batch of chunk(channelIds)) {
    for (const row of sql.exec<{ channel_id: string; n: number }>(
      `SELECT channel_id, COUNT(*) AS n FROM channel_followers
       WHERE unfollowed_at IS NULL AND channel_id IN (${placeholders(batch.length)}) GROUP BY channel_id`,
      ...batch,
    )) {
      counts[row.channel_id] = row.n;
    }
  }
  return counts;
}

/** Active followers of one channel, oldest first; the owner queue shows these. */
export function listActive(sql: SqlStorage, channelId: string): FollowerRecord[] {
  return sql
    .exec<{ user_email: string; followed_at: number }>(
      `SELECT user_email, followed_at FROM channel_followers
       WHERE channel_id = ? AND unfollowed_at IS NULL ORDER BY followed_at, user_email`,
      channelId,
    )
    .toArray()
    .map((row) => ({ email: row.user_email, followedAt: row.followed_at }));
}
```

Add `export type FollowerRecord = { email: string; followedAt: number };` to `types.ts` and export `requireChannel` from `channels.ts`. Facade methods in `registry.ts`, in a new `// --- followers` section: `recordFollow(email, channelId)` and `recordUnfollow(email, channelId)` run `users.requireEmail`, `users.ensureUser` (so the foreign key holds for direct callers), and the store call inside `#transaction`; `countFollowers(channelIds)` and `listFollowers(actorEmail, channelId)` (owner-checked, `#requireChannel`).

Run: `pnpm --filter api test -- registry-followers`
Expected: PASS.

- [ ] **Step 3: Shared schemas and the projection**

In `packages/shared/src/index.ts` add `followerCount: Count.describe("Active followers, from the Registry's follower record.")` to `ChannelSchema` after `following`, and:

```ts
export const FollowerSchema = z
  .object({ email: z.string(), followedAt: UnixMs })
  .meta({ id: "Follower", description: "One active follower of a channel, as the owner sees it." });
export type Follower = z.infer<typeof FollowerSchema>;

/** `GET /channels/:id/followers` (owner) — active followers, oldest first. */
export const FollowersResponseSchema = z
  .object({ followers: z.array(FollowerSchema) })
  .meta({ id: "FollowersResponse", description: "`GET /channels/:id/followers` (owner) — active followers, oldest first." });
export type FollowersResponse = z.infer<typeof FollowersResponseSchema>;

/** 409 body when the channel is declined: the client shows the note and offers Request again. */
export const ChannelDeclinedResponseSchema = z
  .object({
    error: z.string(),
    code: z.literal("INVALID_STATE"),
    channelId: z.string(),
    status: z.literal("declined"),
    reviewNote: z.string().nullable(),
    reviewedAt: UnixMs.nullable(),
  })
  .meta({ id: "ChannelDeclinedResponse", description: "409 body for `POST /channels` and `PUT /follows/:channelId` when the channel is declined; the client shows the note and offers Request again." });
export type ChannelDeclinedResponse = z.infer<typeof ChannelDeclinedResponseSchema>;
```

`lib/channel-view.ts`: add `followerCount: number` to `ChannelView` and to the `Channel` it builds. Every `toChannel` call site now passes it; in `routes/channels.ts` fetch `countFollowers(ids)` once per list next to `countEpisodesByChannel`, and in `ownerChannel` for the one id.

- [ ] **Step 4: Follow routes write both objects**

`apps/api/src/routes/follows.ts`, `PUT /:channelId`:

```ts
const channel = await c.var.registry.getChannel(channelId);
if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
if (channel.status === "declined") {
  return c.json<ChannelDeclinedResponse>(
    { error: "channel was declined by the owner; request it again", code: "INVALID_STATE",
      channelId: channel.channelId, status: "declined", reviewNote: channel.reviewNote, reviewedAt: channel.reviewedAt },
    409,
  );
}
const follow = await c.var.user.follow(channelId);
const current = await c.var.registry.recordFollow(c.var.identity.email, channelId);
return c.json<FollowResponse>({ follow: await followView(c, follow, current) });
```

`DELETE /:channelId`: `c.var.user.unfollow` first, then `recordUnfollow`, then build the view from the channel it returns. Add the 409 to `describeRoute` with `409: jsonResponse(ChannelDeclinedResponseSchema, "The channel is declined (`INVALID_STATE`).")` in place of the `conflict` option. `GET /` passes `followerCount` from one `countFollowers(ids)` call.

Add to `routes/channels.ts`:

```ts
.get("/:id/followers",
  describeRoute({ tags: ["channels"], summary: "List a channel's active followers (owner)",
    description: "Emails and follow times, oldest first. The web shows emails only in the queue.",
    responses: { 200: jsonResponse(FollowersResponseSchema, "Active followers."), ...errorResponses({ owner: true, notFound: true }) } }),
  requireOwner, validate("param", ChannelParamsSchema),
  async (c) => c.json<FollowersResponse>({ followers: await c.var.registry.listFollowers(c.var.identity.email, c.req.valid("param").id) }),
)
```

- [ ] **Step 5: Route tests, check, commit**

In `routes-follows-digest.test.ts` extend the follow test: after `PUT /follows/A` assert `followerCount: 1` in the response's `follow.channel` and in `GET /channels`; `PUT /follows/C` (declined) is 409 with `expectShape(ChannelDeclinedResponseSchema, json)`; after `DELETE /follows/A` from the only follower the channel reads `paused: true, pausedBy: "system"`. In `routes-channels.test.ts` add `["GET", `/channels/${CHANNEL_A}/followers`]` to `ownerOnly` and one owner call asserting `expectShape(FollowersResponseSchema, json)`. In `openapi.test.ts` add `"Follower"` to the component list.

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): record followers in the Registry and pause a channel nobody follows"
```

### Task 4: Channel action routes: add-or-follow, request again, approve, decline, pause, resume

**Files:**
- Modify: `apps/api/src/routes/channels.ts`, `packages/shared/src/index.ts`, `apps/api/src/lib/ingestion.ts`
- Test: `apps/api/test/routes-channels.test.ts`, `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consumes: facade `createChannel`, `approveChannel`, `declineChannel`, `requestChannel`, `pauseChannel`, `resumeChannel`, `recordFollow`; `ChannelDeclinedResponseSchema`.
- Produces (shared): `ApproveChannelBodySchema { title?, initialImportCount?, explanation? }`, `DeclineChannelBodySchema { explanation? }`.
- Produces (routes): `POST /channels` (201 created and followed; 200 existing and followed; 409 declined), `POST /channels/:id/request`, `POST /channels/:id/approve`, `POST /channels/:id/decline`, `POST /channels/:id/pause`, `POST /channels/:id/resume`.
- **Plan decision:** the owner's add follows the owner too, so "the caller is followed onto the channel" holds for both roles. Veto by skipping the follow writes when `isOwner(c)`.

- [ ] **Step 1: Write the failing route tests**

Add to `routes-channels.test.ts`:

```ts
it("a user's add creates a requested channel and follows them; an existing one is followed; a declined one is 409 with the note", async () => {
  const created = await call(ALICE, "POST", "/channels", { channelId: `https://www.youtube.com/channel/${CHANNEL_A}` });
  expect(created.status).toBe(201);
  expectShape(ChannelResponseSchema, created.json);
  expect(created.json.channel).toMatchObject({ channelId: CHANNEL_A, title: "Feed A", status: "requested", following: true, followerCount: 1 });
  expect(await userDO(ALICE).activeChannelIds()).toEqual([CHANNEL_A]);

  const existing = await call(BOB, "POST", "/channels", { channelId: CHANNEL_A });
  expect(existing.status).toBe(200);
  expect(existing.json.channel).toMatchObject({ following: true, followerCount: 2 });

  await registry().declineChannel(OWNER, CHANNEL_A, { explanation: "not now" });
  const declined = await call(BOB, "POST", "/channels", { channelId: CHANNEL_A });
  expect(declined.status).toBe(409);
  expectShape(ChannelDeclinedResponseSchema, declined.json);
  expect(declined.json).toMatchObject({ status: "declined", reviewNote: "not now" });

  const again = await call(BOB, "POST", `/channels/${CHANNEL_A}/request`);
  expect(again.status).toBe(200);
  expect(again.json.channel).toMatchObject({ status: "requested", reviewNote: "not now", following: true });

  expect((await call(ALICE, "POST", "/channels", { channelId: "@handle" })).status).toBe(400);
  expect((await call(ALICE, "POST", "/channels", { channelId: CHANNEL_E })).status).toBe(400);
});

it("the owner approves, declines, pauses, and resumes; users may not", async () => {
  await call(ALICE, "POST", "/channels", { channelId: CHANNEL_A });
  for (const action of ["approve", "decline", "pause", "resume"]) {
    const { status } = await call(ALICE, "POST", `/channels/${CHANNEL_A}/${action}`, {});
    expect(status, action).toBe(403);
  }
  const approved = await call(OWNER, "POST", `/channels/${CHANNEL_A}/approve`, { title: "Renamed", explanation: "welcome" });
  expect(approved.status).toBe(200);
  expect(approved.json.channel).toMatchObject({ status: "approved", title: "Renamed", reviewNote: "welcome", paused: false });
  expect((await call(OWNER, "POST", `/channels/${CHANNEL_A}/pause`, {})).json.channel).toMatchObject({ paused: true, pausedBy: "owner" });
  expect((await call(OWNER, "POST", `/channels/${CHANNEL_A}/resume`, {})).json.channel).toMatchObject({ paused: false });
  const declined = await call(OWNER, "POST", `/channels/${CHANNEL_A}/decline`, { explanation: "withdrawn" });
  expect(declined.json.channel).toMatchObject({ status: "declined", reviewNote: "withdrawn" });
  expect(declined.json.channel.management).toMatchObject({ lifecycleVersion: 2 });
  expect((await call(OWNER, "POST", `/channels/${CHANNEL_A}/pause`, {})).status).toBe(409);
  const owned = await call(OWNER, "POST", "/channels", { channelId: CHANNEL_B });
  expect(owned.status).toBe(201);
  expect(owned.json.channel).toMatchObject({ status: "approved", following: true });
});
```

Run: `pnpm --filter api test -- routes-channels`
Expected: FAIL with 404s for the new routes and `following: false` on create.

- [ ] **Step 2: Shared bodies**

```ts
/** `POST /channels/:id/approve` — every field optional. */
export const ApproveChannelBodySchema = z
  .object({
    title: optionalText("Overrides the channel's title."),
    initialImportCount: z.number().int().positive().describe("Recent episodes to import first; defaults to five.").optional(),
    explanation: optionalText("Shown to the channel's followers."),
  })
  .meta({ id: "ApproveChannelBody", description: "`POST /channels/:id/approve` — every field optional." });
export type ApproveChannelBody = z.infer<typeof ApproveChannelBodySchema>;

/** `POST /channels/:id/decline` */
export const DeclineChannelBodySchema = z
  .object({ explanation: optionalText("Shown to the channel's followers with the word Declined or Withdrawn.") })
  .meta({ id: "DeclineChannelBody", description: "`POST /channels/:id/decline`" });
export type DeclineChannelBody = z.infer<typeof DeclineChannelBodySchema>;
```

- [ ] **Step 3: The routes**

In `routes/channels.ts` add a helper and rewrite `POST /`:

```ts
/** Follows the caller onto a channel in both objects and returns the channel as they see it. */
async function followAndView(c: Ctx, channelId: string, created: boolean) {
  await c.var.user.follow(channelId);
  const channel = await c.var.registry.recordFollow(c.var.identity.email, channelId);
  const view = isOwner(c) ? await ownerChannel(c, channelId) : await readerChannel(c, channel);
  return c.json<ChannelResponse>({ channel: view }, created ? 201 : 200);
}

async function readerChannel(c: Ctx, channel: CatalogChannel): Promise<Channel> {
  const [counts, followers] = await Promise.all([
    c.var.registry.countEpisodesByChannel([channel.channelId]),
    c.var.registry.countFollowers([channel.channelId]),
  ]);
  return toChannel(channel, { following: true, processedCount: counts[channel.channelId]?.processed ?? 0, followerCount: followers[channel.channelId] ?? 0 });
}

function declinedResponse(c: Ctx, channel: CatalogChannel) {
  return c.json<ChannelDeclinedResponse>(
    { error: "channel was declined by the owner; request it again", code: "INVALID_STATE",
      channelId: channel.channelId, status: "declined", reviewNote: channel.reviewNote, reviewedAt: channel.reviewedAt },
    409,
  );
}
```

`POST /` handler body: `extractChannelId`; `const existing = await registry.getChannel(channelId)`; if `existing?.status === "declined"` return `declinedResponse`; if `existing` return `followAndView(c, channelId, false)`; else fetch the feed (400 when missing), then `try { await registry.createChannel(email, { channelId, title: body.title ?? feed.title, initialImportCount, status }) } catch (error) { if (domainErrorCode(error) !== "INVALID_STATE") throw error; /* created meanwhile */ const raced = await registry.getChannel(channelId); if (!raced) throw error; if (raced.status === "declined") return declinedResponse(c, raced); return followAndView(c, channelId, false); }`; when created with `status === "approved"` call `requestIngestion(channelId, "channel_approved")`; return `followAndView(c, channelId, true)`. Document 201, 200, and the 409 body in `describeRoute`; drop `requireOwner` and the `owner: true` error.

The five action routes follow one shape; approve shown in full, the others differ only in body schema, facade call, and description:

```ts
.post("/:id/approve",
  describeRoute({ tags: ["channels"], summary: "Approve a channel (owner)",
    description: "`requested` or `declined` → `approved`. Sets `approvedAt` the first time and starts the initial import only then; a re-approved channel waits for the next scheduled run.",
    responses: { 200: jsonResponse(ChannelResponseSchema, "The approved channel, with `management`."),
      ...errorResponses({ owner: true, notFound: true, conflict: "The channel is already approved" }) } }),
  requireOwner, validate("param", ChannelParamsSchema), validate("json", ApproveChannelBodySchema),
  async (c) => {
    const { channel, importStarts } = await c.var.registry.approveChannel(c.var.identity.email, c.req.valid("param").id, c.req.valid("json"));
    if (importStarts) requestIngestion(channel.channelId, "channel_approved");
    return c.json<ChannelResponse>({ channel: await ownerChannel(c, channel.channelId) });
  })
```

`decline` (`DeclineChannelBodySchema`, conflict "The channel is already declined"), `pause` and `resume` (no body, conflict "Only approved channels can be paused or resumed"), and `request` (anyone, no body, conflict "Only a declined channel can be requested again"; calls `requestChannel(email, id)` then `followAndView(c, id, false)`).

- [ ] **Step 4: Check and commit**

Run: `pnpm check`
Expected: PASS, including the OpenAPI coverage test, which now sees the six new operations.

```bash
git add -A
git commit -m "feat(api): add-or-follow, request again, approve, decline, pause, and resume channels"
```

### Task 5: Episode statuses `pending | available | failed | skipped`

**Files:**
- Modify: `apps/api/migrations/registry/0001_init.sql` (the `episodes` and `ingestion_run_episodes` tables become spec §6.1; the file is frozen after this task), `packages/shared/src/index.ts`, `apps/api/src/do/registry/types.ts`, `apps/api/src/do/registry/episodes.ts`, `apps/api/src/do/registry/runs.ts`, `apps/api/src/do/registry/catalog.ts`, `apps/api/src/do/registry.ts`, `apps/api/src/lib/channel-view.ts`, `apps/api/src/lib/episode-view.ts`, `apps/api/src/routes/channels.ts`, `apps/api/src/routes/follows.ts`
- Modify (compile only): `apps/web/src/components/EpisodeItem.tsx`, `ChannelList.tsx`, `CatalogTable.tsx`, `CatalogHealth.tsx`, `apps/web/src/screens/Channel.tsx`, `OwnerChannel.tsx`
- Test: `apps/api/test/helpers.ts`, `registry-migrations.test.ts`, `registry-episodes.test.ts`, `registry-runs.test.ts`, `registry-management.test.ts`, `routes-channels.test.ts`, `routes-follows-digest.test.ts`

**Interfaces:**
- Produces (shared): `EpisodeStatus = "pending" | "available" | "failed" | "skipped"`; `EpisodeWaitingCode = "CAPTIONS" | "LIVE_OR_UPCOMING" | "PROVIDER_LIMIT"`; `EpisodeSkipReason = "SHORT" | "NON_ENGLISH" | "NO_CAPTIONS" | "LIVE_OR_UPCOMING" | "UNPLAYABLE" | "OWNER"`; `EpisodeCounts = { tracked, available, pending, waiting, failed, skipped }`; `EpisodeProcessing` gains `waitingCode, skipReason, skippedAt, skippedByEmail`; `IngestionRunEpisodeStatus = "selected" | "available" | "failed" | "skipped" | "waiting" | "not_attempted"`; `Channel.episodes: EpisodeCounts` replaces `processedCount`; `Catalog.episodes = { available, pending, waiting, failed, skipped }`.
- Produces (store): `listAvailableEpisodeIds(sql, channelIds)` replaces `listProcessedEpisodeIds`; `zeroCounts()` returns the six-field shape.
- Produces (lib): `zeroEpisodeCounts(): EpisodeCounts` in `lib/channel-view.ts`; `ChannelView.episodes: EpisodeCounts`.

- [ ] **Step 1: Rewrite the migration's episode tables and the failing tests**

Replace the `episodes` and `ingestion_run_episodes` blocks in `0001_init.sql` with spec §6.1's. In `registry-migrations.test.ts` replace `it("requires a positive chunk count only when an episode is processed", …)` with:

```ts
it("ties episode columns to status", async () => {
  const stub = registry();
  await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A", status: "approved" });
  await runInDurableObject(stub, (_, state) => {
    const sql = state.storage.sql;
    const insert = (cols: string, vals: string) =>
      sql.exec(`INSERT INTO episodes (episode_id, channel_id, title, published_at, ${cols}, updated_at, created_at) VALUES ('v', ?, 't', 1, ${vals}, 1, 1)`, CHANNEL_A);
    expect(() => insert("status", "'processed'")).toThrow(/CHECK/i);
    expect(() => insert("status", "'available'")).toThrow(/CHECK/i);
    expect(() => insert("status, chunk_count, vectorized_at, processed_at", "'available', 0, 1, 1")).toThrow(/CHECK/i);
    expect(() => insert("status", "'skipped'")).toThrow(/CHECK/i);
    expect(() => insert("status, skip_reason, skipped_at", "'skipped', 'OWNER', 1")).toThrow(/CHECK/i);
    expect(() => insert("status, skip_reason", "'pending', 'SHORT'")).toThrow(/CHECK/i);
    expect(() => insert("status", "'failed'")).toThrow(/CHECK/i);
    expect(() => insert("status, waiting_code, chunk_count, vectorized_at, processed_at", "'available', 'CAPTIONS', 1, 1, 1")).toThrow(/CHECK/i);
    insert("status, waiting_code", "'pending', 'CAPTIONS'");
    sql.exec("UPDATE episodes SET status = 'skipped', waiting_code = NULL, skip_reason = 'SHORT', skipped_at = 1 WHERE episode_id = 'v'");
    sql.exec("UPDATE episodes SET status = 'available', skip_reason = NULL, skipped_at = NULL, chunk_count = 2, vectorized_at = 1, processed_at = 1 WHERE episode_id = 'v'");
  });
});
```

Update `apps/api/test/helpers.ts`: `EpisodeSeed.status` becomes `"pending" | "available" | "failed" | "skipped"` with optional `waitingCode`, `skipReason`; the default is `"available"`; `seedEpisode` writes `waiting_code`, `skip_reason`, `skipped_at` (`at` when skipped), `failure_code` defaulting to `"PROVIDER_HTTP"` when the status is `failed`, and `chunk_count`, `vectorized_at`, `processed_at` only when `available`. `RunSeed.episodes[].status` becomes the six run-episode values.

Run: `pnpm --filter api test -- registry-migrations`
Expected: PASS for the migration test; every test that seeds episodes now fails until the store follows.

- [ ] **Step 2: Shared schemas**

```ts
export const EpisodeStatusSchema = z.enum(["pending", "available", "failed", "skipped"]).meta({
  id: "EpisodeStatus",
  description: "`pending` may be waiting; `available` has verified vectors and a summary; `failed` is a technical error after three attempts; `skipped` is deliberate and reversible.",
});
export const EpisodeWaitingCodeSchema = z.enum(["CAPTIONS", "LIVE_OR_UPCOMING", "PROVIDER_LIMIT"]).meta({ id: "EpisodeWaitingCode", description: "Why a pending episode is waiting for a later run." });
export type EpisodeWaitingCode = z.infer<typeof EpisodeWaitingCodeSchema>;
export const EpisodeSkipReasonSchema = z.enum(["SHORT", "NON_ENGLISH", "NO_CAPTIONS", "LIVE_OR_UPCOMING", "UNPLAYABLE", "OWNER"]).meta({ id: "EpisodeSkipReason", description: "Why an episode was skipped; `OWNER` carries the owner's email." });
export type EpisodeSkipReason = z.infer<typeof EpisodeSkipReasonSchema>;
export const IngestionRunEpisodeStatusSchema = z.enum(["selected", "available", "failed", "skipped", "waiting", "not_attempted"]).meta({ id: "IngestionRunEpisodeStatus", description: "Per-run outcome; `selected` until the run reaches the episode, `not_attempted` when it ended early." });
export const EpisodeCountsSchema = z.object({ tracked: Count, available: Count, pending: Count, waiting: Count, failed: Count, skipped: Count })
  .meta({ id: "EpisodeCounts", description: "Episodes of a channel by status; `waiting` is the subset of `pending` with a wait reason." });
```

`EpisodeProcessingSchema` gains `waitingCode: EpisodeWaitingCodeSchema.nullable()`, `skipReason: EpisodeSkipReasonSchema.nullable()`, `skippedAt: UnixMs.nullable()`, `skippedByEmail: z.string().nullable()`. In `ChannelSchema` replace `processedCount: Count` with `episodes: EpisodeCountsSchema`. In `CatalogSchema` the `episodes` object becomes `{ available: Count, pending: Count, waiting: Count, failed: Count, skipped: Count }`. Delete the `EPISODE_STATUSES` constant.

- [ ] **Step 3: Store, projection, routes**

`episodes.ts`: add `e.waiting_code, e.skip_reason, e.skipped_at, e.skipped_by_email` to `EPISODE_SELECT` and `EpisodeRow`; `toStatus` accepts the four values; `toWaitingCode` and `toSkipReason` narrow like `toStatus`; `toRecord.processing` carries the four new fields. Rename `listProcessedEpisodeIds` to `listAvailableEpisodeIds` with `status = 'available'`; `listDigest` and `attachRelated` filter on `'available'`. Counts:

```ts
export function zeroCounts(): EpisodeCounts {
  return { tracked: 0, available: 0, pending: 0, waiting: 0, failed: 0, skipped: 0 };
}
// countByChannel groups by status and (waiting_code IS NOT NULL):
`SELECT channel_id, status, (waiting_code IS NOT NULL) AS waiting, COUNT(*) AS n FROM episodes
 WHERE channel_id IN (${placeholders(batch.length)}) GROUP BY channel_id, status, waiting`
// and per row: entry.tracked += n; entry[status] += n; if (row.waiting) entry.waiting += n;
```

`runs.ts` `toEpisodeStatus`: the six run-episode values. `catalog.ts` `summarize`: `episodes` from one grouped query over `status` and `waiting_code IS NOT NULL` into `{ available, pending, waiting, failed, skipped }`. `registry.ts`: rename `listProcessedEpisodeIds` to `listAvailableEpisodeIds`. `lib/channel-view.ts`: `ChannelView.episodes: EpisodeCounts`, `toChannel` emits `episodes`, and `export function zeroEpisodeCounts(): EpisodeCounts` (same literal as the store's, so routes need not import from `do/`). `routes/channels.ts` and `routes/follows.ts`: pass `counts[id] ?? zeroEpisodeCounts()`; `unreadByChannel` calls `listAvailableEpisodeIds`.

Web compile: `EpisodeItem.tsx` compares to `"available"`; `ChannelList.tsx`, `Channel.tsx`, `CatalogTable.tsx` read `channel.episodes.available` and `channel.episodes.tracked`; `CatalogHealth.tsx` shows `available` and the sum; `OwnerChannel.tsx` episode rows show `e.processing?.skipReason ?? e.processing?.failureCode ?? "—"` in the Failure column.

- [ ] **Step 4: Tests, check, commit**

`registry-episodes.test.ts`: the counts assertion becomes the six-field shape with one `pending` seeded with `waitingCode: "CAPTIONS"` counted in both `pending` and `waiting`; `listProcessedEpisodeIds` → `listAvailableEpisodeIds`. `registry-runs.test.ts`: seeded run-episode statuses become `available`, `failed`, `skipped`. `registry-management.test.ts`, `routes-channels.test.ts`, `routes-follows-digest.test.ts`: `processedCount: n` → `episodes: expect.objectContaining({ available: n })`; the catalog summary expects the five counts. `openapi.test.ts`: nothing.

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): episodes are pending, available, failed, or skipped, with wait and skip reasons"
```

### Task 6: Owner episode retry and skip, and the catalog attention block

**Files:**
- Modify: `apps/api/src/do/registry/episodes.ts`, `apps/api/src/do/registry/runs.ts`, `apps/api/src/do/registry/catalog.ts`, `apps/api/src/do/registry.ts`, `apps/api/src/lib/ingestion.ts`, `apps/api/src/routes/channels.ts`, `packages/shared/src/index.ts`
- Test: `apps/api/test/registry-episodes.test.ts`, `apps/api/test/routes-channels.test.ts`, `apps/api/test/registry-management.test.ts`

**Interfaces:**
- Produces (store `episodes.ts`): `getEpisode(sql, channelId, episodeId): EpisodeRecord | null` (no related titles), `retryEpisode(sql, channelId, episodeId, now): EpisodeRecord`, `skipEpisode(sql, channelId, episodeId, ownerEmail, now): EpisodeRecord`. (store `runs.ts`): `hasActiveRun(sql, channelId): boolean`.
- Produces (facade): `retryEpisode(actor, channelId, episodeId): EpisodeRecord`, `skipEpisode(actor, channelId, episodeId): EpisodeRecord`.
- Produces (shared): `EpisodeParamsSchema { id, episodeId }`, `EpisodeResponseSchema { episode: Episode }`, `Catalog.attention = { failedEpisodes, neverStarted, requested }`.
- Produces (routes): `POST /channels/:id/episodes/:episodeId/retry`, `POST /channels/:id/episodes/:episodeId/skip` (owner). `IngestionReason` gains `"episode_retry"`.

- [ ] **Step 1: Write the failing tests**

Add to `registry-episodes.test.ts`:

```ts
it("owner retry reopens a failed or skipped episode; owner skip closes a failed one; both refuse an active run", async () => {
  const stub = registry();
  await stub.createChannel(OWNER, { channelId: CHANNEL_A, title: "A", status: "approved" });
  await seedEpisode(EPISODE_A, CHANNEL_A, { status: "failed", attemptCount: 3, failureCode: "PROVIDER_HTTP" });
  await seedEpisode(EPISODE_B, CHANNEL_A, { status: "skipped", skipReason: "SHORT" });
  await seedEpisode(EPISODE_C, CHANNEL_A, { status: "available" });

  const skipped = await stub.skipEpisode(OWNER, CHANNEL_A, EPISODE_A);
  expect(skipped.status).toBe("skipped");
  expect(skipped.processing).toMatchObject({ skipReason: "OWNER", skippedByEmail: OWNER });
  const retried = await stub.retryEpisode(OWNER, CHANNEL_A, EPISODE_A);
  expect(retried.status).toBe("pending");
  expect(retried.processing).toMatchObject({ attemptCount: 0, failureCode: null, skipReason: null, skippedAt: null, skippedByEmail: null });
  expect((await stub.retryEpisode(OWNER, CHANNEL_A, EPISODE_B)).status).toBe("pending");
  await expectDomainError(stub.skipEpisode(OWNER, CHANNEL_A, EPISODE_C), "INVALID_STATE");
  await expectDomainError(stub.retryEpisode(OWNER, CHANNEL_A, EPISODE_C), "INVALID_STATE");
  await expectDomainError(stub.retryEpisode(ALICE, CHANNEL_A, EPISODE_A), "NOT_OWNER");
  await expectDomainError(stub.retryEpisode(OWNER, CHANNEL_B, EPISODE_A), "NOT_FOUND");

  await seedEpisode("ddddddddddd", CHANNEL_A, { status: "failed" });
  await seedRun(CHANNEL_A, { status: "running" });
  await expectDomainError(stub.retryEpisode(OWNER, CHANNEL_A, "ddddddddddd"), "INVALID_STATE");
  await stub.declineChannel(OWNER, CHANNEL_A);
  await expectDomainError(stub.skipEpisode(OWNER, CHANNEL_A, "ddddddddddd"), "INVALID_STATE");
});
```

In `registry-management.test.ts` extend the summary test: seed one `failed` episode and one approved channel with no run, and expect `attention: { failedEpisodes: 1, neverStarted: 1, requested: <count of requested channels> }`.

Run: `pnpm --filter api test -- registry-episodes registry-management`
Expected: FAIL, `skipEpisode is not a function` and a missing `attention` key.

- [ ] **Step 2: Store and facade**

`runs.ts`:

```ts
export function hasActiveRun(sql: SqlStorage, channelId: string): boolean {
  return sql.exec<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ingestion_runs WHERE channel_id = ? AND status IN ('queued', 'running')", channelId,
  ).one().n > 0;
}
```

`episodes.ts`:

```ts
export function getEpisode(sql: SqlStorage, channelId: string, episodeId: string): EpisodeRecord | null {
  const row = sql.exec<EpisodeRow>(`${EPISODE_SELECT} WHERE e.channel_id = ? AND e.episode_id = ?`, channelId, episodeId).toArray()[0];
  return row ? toRecord(row, []) : null;
}

/** Owner: `failed | skipped → pending`, attempts and skip fields cleared. The caller starts the one-episode run. */
export function retryEpisode(sql: SqlStorage, channelId: string, episodeId: string, now: number): EpisodeRecord {
  const episode = requireOwnerActionable(sql, channelId, episodeId);
  if (episode.status !== "failed" && episode.status !== "skipped") {
    throw new DomainError("INVALID_STATE", `only failed or skipped episodes can be retried (status: ${episode.status})`);
  }
  sql.exec(
    `UPDATE episodes SET status = 'pending', attempt_count = 0, failure_code = NULL, failure_detail = NULL,
       skip_reason = NULL, skipped_at = NULL, skipped_by_email = NULL, waiting_code = NULL, updated_at = ?
     WHERE episode_id = ?`, now, episodeId,
  );
  return getEpisode(sql, channelId, episodeId) ?? episode;
}

/** Owner: `failed → skipped OWNER`. */
export function skipEpisode(sql: SqlStorage, channelId: string, episodeId: string, ownerEmail: string, now: number): EpisodeRecord {
  const episode = requireOwnerActionable(sql, channelId, episodeId);
  if (episode.status !== "failed") {
    throw new DomainError("INVALID_STATE", `only failed episodes can be skipped (status: ${episode.status})`);
  }
  sql.exec(
    `UPDATE episodes SET status = 'skipped', skip_reason = 'OWNER', skipped_at = ?, skipped_by_email = ?,
       failure_code = NULL, failure_detail = NULL, updated_at = ? WHERE episode_id = ?`, now, ownerEmail, now, episodeId,
  );
  return getEpisode(sql, channelId, episodeId) ?? episode;
}

/** An approved channel, no active run, and an episode that belongs to it. */
function requireOwnerActionable(sql: SqlStorage, channelId: string, episodeId: string): EpisodeRecord {
  const channel = requireChannel(sql, channelId);
  if (channel.status !== "approved") throw new DomainError("INVALID_STATE", "episode actions need an approved channel");
  if (hasActiveRun(sql, channelId)) throw new DomainError("INVALID_STATE", "a run is active on this channel");
  const episode = getEpisode(sql, channelId, episodeId);
  if (!episode) throw new DomainError("NOT_FOUND", "episode not found");
  return episode;
}
```

Facade: `retryEpisode(actorEmail, channelId, episodeId)` and `skipEpisode(actorEmail, channelId, episodeId)` assert the owner, validate ids with `requireChannelId` and `requireEpisodeId`, and run in `#transaction`. `catalog.ts` `summarize` adds

```ts
attention: {
  failedEpisodes: sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM episodes WHERE status = 'failed'").one().n,
  neverStarted: sql.exec<{ n: number }>(
    `SELECT COUNT(*) AS n FROM channels WHERE status = 'approved'
       AND channel_id NOT IN (SELECT channel_id FROM ingestion_runs)`).one().n,
  requested: channels.requested,
},
```

with `CatalogSchema` gaining `attention: z.object({ failedEpisodes: Count, neverStarted: Count, requested: Count })`. `lib/ingestion.ts`: `IngestionReason = "channel_approved" | "episode_retry"`.

- [ ] **Step 3: Routes**

Shared: `EpisodeParamsSchema = z.object({ id: …, episodeId: z.string().min(1).describe("YouTube episode id.") })` and `EpisodeResponseSchema = z.object({ episode: EpisodeSchema }).meta({ id: "EpisodeResponse", description: "`POST /channels/:id/episodes/:episodeId/retry|skip`" })`. In `routes/channels.ts`:

```ts
.post("/:id/episodes/:episodeId/retry",
  describeRoute({ tags: ["episodes"], summary: "Retry a failed or skipped episode (owner)",
    description: "Back to `pending` with attempts reset; starts a one-episode run. Refused while a run is active on the channel or the channel is not approved.",
    responses: { 200: jsonResponse(EpisodeResponseSchema, "The episode, pending again."),
      ...errorResponses({ owner: true, notFound: true, conflict: "The episode is not failed or skipped, the channel is not approved, or a run is active" }) } }),
  requireOwner, validate("param", EpisodeParamsSchema),
  async (c) => {
    const { id, episodeId } = c.req.valid("param");
    const record = await c.var.registry.retryEpisode(c.var.identity.email, id, episodeId);
    requestIngestion(id, "episode_retry");
    return c.json<EpisodeResponse>({ episode: toEpisode(record, { includeSummary: true, includeProcessing: true }) });
  })
```

and `skip` alike (conflict "The episode is not failed, the channel is not approved, or a run is active"), without `requestIngestion`.

- [ ] **Step 4: Route test, check, commit**

Add to `routes-channels.test.ts` `ownerOnly`: `["POST", `/channels/${CHANNEL_A}/episodes/${EPISODE_C}/retry`]` and `…/skip`. Add one owner test: seed a failed episode on the approved channel, `POST …/skip` is 200 with `expectShape(EpisodeResponseSchema, json)` and `episode.status === "skipped"`, then `POST …/retry` is 200 with `status === "pending"`; after `seedRun(CHANNEL_A, { status: "queued" })` the retry is 409. `GET /catalog` asserts `expectShape(CatalogResponseSchema, json)` still.

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): owner retry and skip per episode, and the catalog attention counts"
```

---

## Phase 2 — Web application

`apps/web` has typecheck and lint only, so each task's check is `pnpm check` plus a look in the browser under `pnpm dev` (the API on `wrangler dev`, the web on Vite) with the owner account from `.dev.vars` and one user account. Every screen reads the API through `src/api.ts` and types from `@media-digest/shared` with `import type`.

### Task 7: API client and copy

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/lib/copy.ts`

**Interfaces:**
- Produces (`api`): `listChannels({ scope? })`, `addChannel(body: CreateChannelBody)`, `getChannel(id)`, `requestChannel(id)`, `approveChannel(id, body: ApproveChannelBody)`, `declineChannel(id, body: DeclineChannelBody)`, `pauseChannel(id)`, `resumeChannel(id)`, `listEpisodes(id, limit?)`, `retryEpisode(id, episodeId)`, `skipEpisode(id, episodeId)`, `listIngestionRuns(id)`, `listFollowers(id)`, `listFollows()`, `follow(id)`, `unfollow(id)`, `getDigest(sinceMs?)`, `getCatalog()`, `getMe()`.
- Produces (`copy.ts`): `CHANNEL_STATUS_COPY`, `channelStateCopy(channel: Channel): string` ("Awaiting owner approval", "Approved", "Approved · paused", "Declined", "Withdrawn"), `reviewCopy(channel): string | null` ("Declined on <date>: “note”" or "Withdrawn on <date>: “note”"), `EPISODE_STATUS_COPY`, `SKIP_REASON_COPY`, `WAITING_CODE_COPY`, `episodePhrase(episode: Episode): string | null`, `CHANNEL_ID_HELP`, `isDeclinedResponse(error: unknown): error is ApiError & { body: ChannelDeclinedResponse }`.

- [ ] **Step 1: The client**

In `apps/web/src/api.ts` replace the `// channels` block:

```ts
// channels
listChannels: (options: { scope?: "all" } = {}) =>
  request<ChannelsResponse>("GET", options.scope === "all" ? "/channels?scope=all" : "/channels"),
addChannel: (body: CreateChannelBody) => request<ChannelResponse>("POST", "/channels", body),
getChannel: (channelId: string) => request<ChannelResponse>("GET", `/channels/${enc(channelId)}`),
requestChannel: (channelId: string) => request<ChannelResponse>("POST", `/channels/${enc(channelId)}/request`),
approveChannel: (channelId: string, body: ApproveChannelBody) => request<ChannelResponse>("POST", `/channels/${enc(channelId)}/approve`, body),
declineChannel: (channelId: string, body: DeclineChannelBody) => request<ChannelResponse>("POST", `/channels/${enc(channelId)}/decline`, body),
pauseChannel: (channelId: string) => request<ChannelResponse>("POST", `/channels/${enc(channelId)}/pause`),
resumeChannel: (channelId: string) => request<ChannelResponse>("POST", `/channels/${enc(channelId)}/resume`),
listEpisodes: (channelId: string, limit?: number) =>
  request<EpisodesResponse>("GET", `/channels/${enc(channelId)}/episodes${limit === undefined ? "" : `?limit=${limit}`}`),
retryEpisode: (channelId: string, episodeId: string) =>
  request<EpisodeResponse>("POST", `/channels/${enc(channelId)}/episodes/${enc(episodeId)}/retry`),
skipEpisode: (channelId: string, episodeId: string) =>
  request<EpisodeResponse>("POST", `/channels/${enc(channelId)}/episodes/${enc(episodeId)}/skip`),
listIngestionRuns: (channelId: string) => request<IngestionRunsResponse>("GET", `/channels/${enc(channelId)}/ingestion-runs`),
listFollowers: (channelId: string) => request<FollowersResponse>("GET", `/channels/${enc(channelId)}/followers`),
```

Delete `createChannel`, `deleteChannel`, `restoreChannel`; import the new types. A `POST` with no body sends no `Content-Type`; the routes without a body schema accept that.

- [ ] **Step 2: The copy**

Replace `apps/web/src/lib/copy.ts`:

```ts
// The user-facing phrases from docs/specs/channel-simplification.md §4 and §7, in one place so
// screens never invent their own wording.
import type { Channel, ChannelDeclinedResponse, ChannelStatus, Episode, EpisodeSkipReason, EpisodeStatus, EpisodeWaitingCode } from "@media-digest/shared";
import { ApiError } from "../api";
import { absoluteTime } from "./time";

export const CHANNEL_STATUS_COPY: Record<ChannelStatus, string> = {
  requested: "Awaiting owner approval",
  approved: "Approved",
  declined: "Declined",
};

/** One phrase for a channel row. A declined channel that had been approved reads "Withdrawn". */
export function channelStateCopy(channel: Channel): string {
  if (channel.status === "declined") return channel.approvedAt === null ? "Declined" : "Withdrawn";
  if (channel.status === "approved" && channel.paused) return "Approved · paused";
  return CHANNEL_STATUS_COPY[channel.status];
}

/** The owner's latest decision with its note, for declined channels and re-requests. */
export function reviewCopy(channel: Channel): string | null {
  if (channel.status !== "declined" || channel.reviewedAt === null) return null;
  const verb = channel.approvedAt === null ? "Declined" : "Withdrawn";
  const note = channel.reviewNote ? `: “${channel.reviewNote}”` : "";
  return `${verb} on ${absoluteTime(channel.reviewedAt)}${note}`;
}

export const EPISODE_STATUS_COPY: Record<EpisodeStatus, string> = {
  pending: "Not summarised yet",
  available: "Summarised",
  failed: "Summary failed; the owner has been notified",
  skipped: "No summary",
};

export const SKIP_REASON_COPY: Record<EpisodeSkipReason, string> = {
  SHORT: "under three minutes",
  NON_ENGLISH: "no English captions",
  NO_CAPTIONS: "no captions",
  LIVE_OR_UPCOMING: "live or upcoming",
  UNPLAYABLE: "video unavailable",
  OWNER: "skipped by the owner",
};

export const WAITING_CODE_COPY: Record<EpisodeWaitingCode, string> = {
  CAPTIONS: "waiting for captions",
  LIVE_OR_UPCOMING: "waiting for the stream to end",
  PROVIDER_LIMIT: "waiting for transcript credits",
};

/** The phrase under an episode title when there is no summary to show; null for an available one. */
export function episodePhrase(episode: Episode): string | null {
  if (episode.status === "available") return null;
  const waiting = episode.processing?.waitingCode;
  if (episode.status === "pending" && waiting) return WAITING_CODE_COPY[waiting];
  const reason = episode.processing?.skipReason;
  if (episode.status === "skipped" && reason) return `No summary: ${SKIP_REASON_COPY[reason]}`;
  return EPISODE_STATUS_COPY[episode.status];
}

export const CHANNEL_ID_HELP = "On the channel's page open About, then Share channel, then Copy channel ID.";

/** The 409 body for a declined channel, from `POST /channels` or `PUT /follows/:id`. */
export function isDeclinedResponse(error: unknown): error is ApiError & { body: ChannelDeclinedResponse } {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const body = error.body as Partial<ChannelDeclinedResponse> | null;
  return body?.status === "declined" && typeof body.channelId === "string";
}
```

Readers only receive `processing` when they are the owner, so `episodePhrase` falls back to the status phrase for them; that matches spec §4.

- [ ] **Step 3: Check and commit**

Run: `pnpm check`
Expected: PASS (the screens still compile against the members that remain; any that used `createChannel`, `deleteChannel`, or `restoreChannel` were emptied in Task 2).

```bash
git add -A
git commit -m "feat(web): API client and copy for the requested, approved, declined model"
```

### Task 8: Home: Followed, Catalog, and the one Add-a-channel box

**Files:**
- Modify: `apps/web/src/components/ChannelList.tsx`, `apps/web/src/components/AddChannel.tsx` (rewrite), `apps/web/src/components/Digest.tsx`, `apps/web/src/screens/Home.tsx`

**Interfaces:**
- Consumes: `api.addChannel`, `api.requestChannel`, `api.follow`, `api.unfollow`, `channelStateCopy`, `reviewCopy`, `isDeclinedResponse`.
- Produces: `FollowedList({ follows, busy, onUnfollow, onRequestAgain })`, `CatalogList({ channels, busy, onFollow })`, `AddChannel({ onChanged })` for everyone.

- [ ] **Step 1: Followed and Catalog lists**

Rewrite `ChannelList.tsx`. `FollowedList` renders one `.row` per follow:

```tsx
const c = channel;
const approved = c.status === "approved";
<div class="grow">
  {approved ? <a href={`/channel/${c.channelId}`}>{c.title}</a> : <span class={c.status === "declined" ? "unavailable" : ""}>{c.title}</span>}
  <div class="meta">
    {approved && <>{c.episodes.available} summarised · {unreadCount} unread · ingested <Time at={c.lastIngestedAt} fallback="never" />{c.paused && " · paused"}</>}
    {c.status === "requested" && "Awaiting owner approval"}
    {c.status === "declined" && (reviewCopy(c) ?? channelStateCopy(c))}
  </div>
</div>
<div class="actions">
  {c.status === "declined" && (
    <button type="button" disabled={busy.has(c.channelId)}
      onClick={() => { if (window.confirm(`${reviewCopy(c) ?? "Declined"}. Ask the owner again?`)) onRequestAgain(c.channelId); }}>
      Request again
    </button>
  )}
  <button type="button" disabled={busy.has(c.channelId)} onClick={() => onUnfollow(c.channelId)}>Unfollow</button>
</div>
```

Rename `AvailableList` to `CatalogList`; each row shows the title (linked when approved), `c.status === "approved" ? `${c.episodes.available} summarised` : `awaiting approval · ${c.followerCount} following``, and a Follow button. The empty state reads "The catalog is empty. Add a channel below." for everyone (the owner adds from the same box now). Update the `Digest.tsx` import and prop to `CatalogList`.

- [ ] **Step 2: The add-or-follow box**

Rewrite `AddChannel.tsx`:

```tsx
import { useState } from "preact/hooks";
import { api } from "../api";
import { CHANNEL_ID_HELP, isDeclinedResponse } from "../lib/copy";
import { absoluteTime } from "../lib/time";

/**
 * One box for everyone (spec §7). A new id creates a requested channel (approved, for the owner) and
 * follows the caller; an existing id follows; a declined id shows the owner's note and offers Request again.
 */
export function AddChannel({ onChanged }: { onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [declined, setDeclined] = useState<{ channelId: string; note: string } | null>(null);

  async function run(work: () => Promise<unknown>) {
    setBusy(true); setMessage(null); setDeclined(null);
    try {
      await work();
      setValue("");
      onChanged();
    } catch (error) {
      if (isDeclinedResponse(error)) {
        const { channelId, reviewNote, reviewedAt } = error.body;
        const when = reviewedAt === null ? "" : ` on ${absoluteTime(reviewedAt)}`;
        setDeclined({ channelId, note: `Declined${when}${reviewNote ? `: “${reviewNote}”` : ""}` });
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="inline" onSubmit={(e) => { e.preventDefault(); run(() => api.addChannel({ channelId: value })); }}>
      <label>Add a channel{" "}
        <input id="add-channel-id" type="text" value={value} placeholder="UC… id or /channel/UC… URL"
          onInput={(e) => setValue(e.currentTarget.value)} disabled={busy} />
      </label>
      <button type="submit" disabled={busy || value.trim().length === 0}>Add</button>
      <span class="help">{CHANNEL_ID_HELP}</span>
      {message && <span class="error">{message}</span>}
      {declined && (
        <span>{declined.note}.{" "}
          <button type="button" disabled={busy} onClick={() => run(() => api.requestChannel(declined.channelId))}>Request again</button>
        </span>
      )}
    </form>
  );
}
```

The owner's title and import-count overrides move to the approve form (Task 10); the owner's add takes the feed title, and the owner can rename on the detail page later if that is ever wanted (out of scope, spec §8).

- [ ] **Step 3: Home**

In `Home.tsx`: rename the `Available` heading to `Catalog` and its list to `CatalogList` over `channels.data.channels.filter((c) => !c.following)`; pass `onRequestAgain={(id) => withBusy(id, () => api.requestChannel(id))}` to `FollowedList`; render `<AddChannel onChanged={reloadLists} />` after the two lists; the `note=owner-only` paragraph stays. Add the one remaining poll: when any followed channel has `status === "requested"`, `setInterval(reloadLists, 15_000)` in a `useEffect` keyed on that boolean, cleared on unmount.

- [ ] **Step 4: Check, look, commit**

Run: `pnpm check`, then `pnpm dev` and, as a user, paste `UC…` ids from a real channel and a made-up one; follow, unfollow, and see a requested row read "Awaiting owner approval".
Expected: PASS; the box creates and follows, a bad id shows the 400 message.

```bash
git add -A
git commit -m "feat(web): Home lists followed and catalog channels by status with one add-or-follow box"
```

### Task 9: Channel screen for any status

**Files:**
- Modify: `apps/web/src/screens/Channel.tsx`, `apps/web/src/components/EpisodeItem.tsx`

- [ ] **Step 1: Episode phrase**

In `EpisodeItem.tsx` replace the status tag with `episodePhrase(episode)`: `{phrase && <span class="tag"> · {phrase}</span>}` where `const phrase = episodePhrase(episode);`.

- [ ] **Step 2: The screen**

In `Channel.tsx`, after the header line, render by status: `requested` shows `<p>Awaiting owner approval · {c.followerCount} following</p>` and the Follow or Unfollow button, no episodes section; `declined` shows `<p>{reviewCopy(c)}</p>` and a Request again button (`api.requestChannel` then reload both loads), plus the episodes list without summaries when `c.approvedAt !== null`; `approved` renders as today with `{c.episodes.available} summarised`, `paused` appended to the meta line when `c.paused`, and the episodes list. The 404 branch keeps "This channel is not available."

- [ ] **Step 3: Check, look, commit**

Run: `pnpm check`; in the browser open a requested, an approved, and a declined channel by URL.
Expected: PASS; each status renders its phrase and only approved shows summaries.

```bash
git add -A
git commit -m "feat(web): channel screen renders requested, approved, paused, and declined channels"
```

### Task 10: Owner page: queue, attention, catalog table, health strip

**Files:**
- Create: `apps/web/src/components/RequestQueue.tsx` (new content; the Task 1 deletion made room)
- Modify: `apps/web/src/components/CatalogTable.tsx` (rewrite), `apps/web/src/components/CatalogHealth.tsx`, `apps/web/src/components/OwnerCard.tsx`, `apps/web/src/components/Nav.tsx`, `apps/web/src/screens/Owner.tsx`

**Interfaces:**
- Consumes: `api.listChannels({ scope: "all" })`, `api.getCatalog`, `api.listFollowers`, `api.approveChannel`, `api.declineChannel`, `api.pauseChannel`, `api.resumeChannel`, `api.listEpisodes`, `api.retryEpisode`, `api.skipEpisode`.
- Produces: `RequestQueue({ channels, onChanged })` (requested channels only), `CatalogTable({ channels, filter, onChanged })`, `CatalogHealth({ catalog, onFilter })` with `CatalogFilter = "all" | "requested" | "approved" | "paused" | "declined"`, `attentionCount(catalog): number`.
- **Plan decision:** the queue loads each requested channel's followers with one `listFollowers` call per row, since the queue is short; a bulk route can come later if it ever is not.

- [ ] **Step 1: The queue**

`RequestQueue.tsx`:

```tsx
import type { Channel, Follower } from "@media-digest/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { reviewCopy } from "../lib/copy";
import { Time } from "./Time";

/** The owner's review queue (spec §7): requested channels oldest first, with who is waiting. */
export function RequestQueue({ channels, onChanged }: { channels: Channel[]; onChanged: () => void }) {
  const waiting = channels.filter((c) => c.status === "requested")
    .sort((a, b) => (a.management?.createdAt ?? 0) - (b.management?.createdAt ?? 0));
  return (
    <section id="requests">
      <h2>Queue</h2>
      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 && <p class="muted">Nothing waiting for review.</p>}
      {waiting.map((c) => <WaitingRow key={c.channelId} channel={c} onChanged={onChanged} />)}
    </section>
  );
}

function WaitingRow({ channel: c, onChanged }: { channel: Channel; onChanged: () => void }) {
  const [followers, setFollowers] = useState<Follower[] | null>(null);
  const [mode, setMode] = useState<"closed" | "approve" | "decline">("closed");
  const [title, setTitle] = useState(c.title);
  const [importCount, setImportCount] = useState(String(c.management?.initialImportCount ?? 5));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listFollowers(c.channelId).then(({ followers }) => { if (!cancelled) setFollowers(followers); }, () => { if (!cancelled) setFollowers([]); });
    return () => { cancelled = true; };
  }, [c.channelId]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await work(); setMode("closed"); onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  const previous = c.reviewedAt !== null ? `previously ${reviewCopy({ ...c, status: "declined" })?.toLowerCase()}` : null;
  return (
    <div class="row">
      <div class="grow">
        <strong>{c.title}</strong> <a href={c.canonicalUrl}>{c.channelId}</a>
        <div class="meta">
          requested <Time at={c.management?.createdAt ?? null} />
          {followers === null ? " · loading followers" : followers.length === 0 ? " · nobody is waiting" : ` · requested by ${followers.map((f) => f.email).join(", ")}`}
          {previous && ` · ${previous}`}
        </div>
        {mode === "approve" && (
          <form class="inline" onSubmit={(e) => { e.preventDefault(); act(() => api.approveChannel(c.channelId, {
            title: title.trim() || undefined, initialImportCount: Number.parseInt(importCount, 10) || undefined, explanation: note.trim() || undefined })); }}>
            <label>title <input id={`approve-title-${c.channelId}`} type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
            <label>import count <input id={`approve-count-${c.channelId}`} type="number" min="1" value={importCount} onInput={(e) => setImportCount(e.currentTarget.value)} /></label>
            <label>note (optional) <input id={`approve-note-${c.channelId}`} type="text" value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>
            <button type="submit" disabled={busy}>Confirm approval</button>
          </form>
        )}
        {mode === "decline" && (
          <form class="inline" onSubmit={(e) => { e.preventDefault(); act(() => api.declineChannel(c.channelId, { explanation: note.trim() || undefined })); }}>
            <label>note (optional) <input id={`decline-note-${c.channelId}`} type="text" value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>
            <button type="submit" class="danger" disabled={busy}>Confirm decline</button>
          </form>
        )}
        {error && <p class="error">{error}</p>}
      </div>
      <div class="actions">
        <button type="button" disabled={busy} onClick={() => setMode(mode === "approve" ? "closed" : "approve")}>Approve</button>
        <button type="button" class="danger" disabled={busy} onClick={() => setMode(mode === "decline" ? "closed" : "decline")}>Decline</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: The catalog table and attention list**

Rewrite `CatalogTable.tsx` around three blocks. **Needs attention**: `failed` episodes come from `api.listEpisodes(channelId, 200)` for every approved channel whose `management.episodes.failed > 0`, loaded in a `useEffect` into `Record<channelId, Episode[]>`; each failed episode is a row with title linked to `youtu.be`, `processing.failureCode`, `attempt ${processing.attemptCount}`, and **Retry** (`api.retryEpisode`) and **Skip** (`api.skipEpisode`) buttons through the existing `act(channelId, work)` helper. Below them, approved channels with `management.neverStarted` read "approved <Time/>, never started" with a **Start** button that calls `api.approveChannel(c.channelId, {})`; that is 409 today ("already approved") and the plan accepts the error text until M3 adds a start route (the open owner item in spec §3.4). **All channels** keeps the table with columns Title, State (`channelStateCopy(c)`), Episodes (`${c.episodes.available} / ${c.episodes.tracked}` plus `· n skipped`, `· n failed` when non-zero), Last ingested, Latest run, Followers (`c.followerCount`), Actions. Actions by status: `requested` → Approve (`api.approveChannel(id, {})`) and Decline; `approved` → Pause or Resume, and Decline with `window.confirm(`Withdraw ${c.title}? ${c.followerCount} follower${c.followerCount === 1 ? "" : "s"} will lose access to its summaries until it is approved again.`)`; `declined` → Approve. The filter switch maps `"paused"` to `c.status === "approved" && c.paused` and the others to `c.status`.

`CatalogHealth.tsx`: buttons for Requested, Approved, Paused, Declined from `catalog.channels`; the episodes span reads `Episodes {e.available} summarised · {e.pending} pending ({e.waiting} waiting) · {e.failed} failed · {e.skipped} skipped`; runs and last ingestion unchanged. Add and export

```ts
export function attentionCount(catalog: Catalog): number {
  return catalog.attention.requested + catalog.attention.failedEpisodes + catalog.attention.neverStarted;
}
```

`OwnerCard.tsx`: the three phrases become `n channel(s) waiting for review`, `n episode(s) failed`, `n channel(s) approved but never started`. `Nav.tsx`: `setAttention(attentionCount(catalog))`.

- [ ] **Step 3: The screen**

`Owner.tsx`: one `useLoad` for `api.listChannels({ scope: "all" })` feeds both `RequestQueue` and `CatalogTable`; `AddChannel` stays at the bottom of the Catalog section for the owner's add (it creates approved). The section links become Queue, Catalog, Needs attention.

- [ ] **Step 4: Check, look, commit**

Run: `pnpm check`; in the browser as the owner: approve a requested channel with a note, decline another, pause and resume, withdraw an approved one and confirm the dialog names the follower count.
Expected: PASS; the attention count in the nav matches the card.

```bash
git add -A
git commit -m "feat(web): owner queue, attention list, and catalog actions for the new model"
```

### Task 11: Owner channel detail

**Files:**
- Modify: `apps/web/src/screens/OwnerChannel.tsx`

- [ ] **Step 1: Header, episodes, followers**

Header: `channelStateCopy(c)`; `approved since <Time at={c.approvedAt} fallback="never" />`; `reviewed <Time at={c.reviewedAt} /> by {m.reviewedByEmail}` with `“{c.reviewNote}”` when present; `paused since <Time at={m.pausedAt} />` when paused; `lifecycle v{m.lifecycleVersion} · import count {m.initialImportCount} · {c.followerCount} follower(s)`. Actions by status as in the table (Approve, Decline, Pause, Resume), with the same withdraw confirmation.

Episodes table: columns Title, Published, Status (`EPISODE_STATUS_COPY[e.status]`), Waiting (`WAITING_CODE_COPY[code]` or "—"), Attempts, Reason (`processing.skipReason ? SKIP_REASON_COPY[reason] : processing.failureCode ?? "—"`), Chunks, Summary, Processed, Actions: **Retry** for `failed` and `skipped` on an approved channel, **Skip** for `failed`, through `act`.

Followers section replaces the old Requests section: `api.listFollowers` for the owner; when the channel is `requested` list the emails with `followed <Time/>`; otherwise show only "N followers" (spec §7).

- [ ] **Step 2: Check, look, commit**

Run: `pnpm check`; open a requested channel's detail and an approved one with a seeded failed episode (use `wrangler dev`'s local state and the API's episodes list; there is no seeding UI, so this is a typecheck-plus-visual check until M3 produces episodes).
Expected: PASS.

```bash
git add -A
git commit -m "feat(web): owner channel detail with review fields, episode retry and skip, and followers"
```

---

## Task 12: Docs, AGENTS.md, and the walkthrough

**Files:**
- Modify: `AGENTS.md`, `docs/PRD.md`, `docs/specs/channel-simplification.md` (status line only), `docs/specs/channel-simplification-plan.md` (walkthrough record)

- [ ] **Step 1: AGENTS.md and PRD**

Apply spec §11 item by item. Concretely in `AGENTS.md`: the "What this is" paragraph; the Identity model bullets about requests and owner powers; the whole "Catalog, requests, and follows" section rewritten from spec §3.1–3.2 (statuses, create-or-follow, request again, approve, decline with the fence bump, pause and resume, the follower record, the initial import at first approval); the "Ingestion pipeline" bullets that mention channel failure codes, channel retry, `ingestion_waiting_code`, "never automatically restart", and scheduling by follower count; hard rule 3's wording; the Data & schema conventions table list, the one-sentence record of the 2026-09-10 rewrite, and "channels are never deleted"; the API shape table per spec §5; the Screens section per spec §7; the Testing bullets per spec §11. In `docs/PRD.md`: §3, §4.1–4.3, §5 tables and enumerations mirroring spec §6.1 and §6.2, §7, the route table, and the decisions log entry for 2026-09-10. Also `apps/api/migrations/registry/0001_init.sql` and `user/0001_init.sql` headers already say the files are frozen again; confirm.

- [ ] **Step 2: Walkthrough under `wrangler dev`**

From wiped local state (owner runs `clean-local-do`), with `pnpm dev`, record the sequence of spec criterion 15 in a `## Walkthrough record` section at the end of this plan: user adds a channel → owner approves (the log shows `ingestion.start_requested` with `channel_approved`) → mark one episode `available` and one `skipped` by SQL in the local DO, the way the tests do, until M3 ingests for real → user unfollows to zero → channel reads paused → user follows → resumed → owner withdraws → follower's row reads "Withdrawn" with the note and summaries leave the digest → user requests again → owner approves → summaries return. Note each screen checked and any copy that read wrong.

- [ ] **Step 3: Close out**

Set the spec's status line to "accepted, implemented on `feat/channel-simplification`; M3 plan revision pending (spec §12)". Run `pnpm check` one last time.

```bash
git add -A
git commit -m "docs: carry the channel state simplification into AGENTS.md and the PRD"
```

Then hand the branch to the owner for review and the M3 plan revision (spec §12), which is a separate piece of work.

## Walkthrough record

Run on 2026-09-10 against `feat/channel-simplification` at `23a8da5`, in a fresh worktree with no local Durable
Object state to wipe, under `pnpm --filter api exec wrangler dev --port 8787` with
`apps/api/.dev.vars` copied from `.dev.vars.example` (`OWNER_EMAIL=owner@example.com`, gitignored, uncommitted).
Every call is `curl` against `http://127.0.0.1:8787` with an `X-User-Email` header; the only outbound traffic is
the Worker's own fetch of YouTube's public RSS feed (hard rule 2). The channels are `UCBJycsmduvYEL83R_U4JriQ`
(Marques Brownlee) and `UCsBjURrPoezykLs9EqgamOA` (Fireship); only their feeds are read.

| # | Call | Status | Checked |
|---|---|---|---|
| 1 | `POST /channels {channelId}` as alice | 201 | `status: "requested"`, `title: "Marques Brownlee"` from the feed, `following: true`, `followerCount: 1`, `approvedAt: null`, `paused: false`, all `episodes` counts 0 |
| 2 | `GET /channels` as bob | 200 | The requested channel is listed to a non-follower with `following: false`, `followerCount: 1`, and no `management` block |
| 3 | `POST /channels/:id/approve {explanation}` as owner | 200 | `status: "approved"`, `approvedAt` and `reviewedAt` set, `reviewNote` is the owner's text, `management.reviewedByEmail: "owner@example.com"`, `lifecycleVersion: 1`, `neverStarted: true`. The wrangler log printed `{ event: 'ingestion.start_requested', channelId: 'UCBJycsmduvYEL83R_U4JriQ', reason: 'channel_approved' }` |
| 4 | `DELETE /follows/:id` as alice | 200 | The follow keeps `unfollowedAt`; the embedded channel and a fresh `GET /channels/:id` both read `paused: true`, `pausedBy: "system"`, `management.pausedAt` set, `followerCount: 0` |
| 5 | `PUT /follows/:id` as bob | 200 | `paused: false`, `pausedBy: null`, `following: true`, `followerCount: 1` — the follow lifted the system pause |
| 6 | `POST /channels/:id/decline {explanation}` as owner | 200 | `status: "declined"`, `management.lifecycleVersion: 2` (the fence bumped from approved), pause cleared, `approvedAt` unchanged so copy reads "Withdrawn", `reviewNote` is the owner's text |
| 7 | `GET /follows` as bob | 200 | The declined channel is still bob's row, carrying `status: "declined"`, its `reviewNote`, and a non-null `approvedAt`. `GET /channels` as bob returns `[]`; `?scope=all` as owner returns it with `management` |
| 8 | `POST /channels {same id}` as alice | 409 | `ChannelDeclinedResponse`: `code: "INVALID_STATE"`, `status: "declined"`, `channelId`, `reviewNote`, `reviewedAt`, message "channel was declined by the owner; request it again". `PUT /follows/:id` as alice gave the same 409 body |
| 9 | `POST /channels/:id/request` as alice | 200 | `status: "requested"`, review fields kept so the queue can show "previously declined", `following: true`, `followerCount: 2`. `GET /channels/:id/followers` as owner lists bob then alice with their `followedAt` |
| 10 | `POST /channels/:id/approve {explanation}` as owner | 200 | `status: "approved"`, `approvedAt` unchanged at its first-approval value, `reviewNote` replaced by the new note, `lifecycleVersion` still 2, and the wrangler log still holds exactly **one** `ingestion.start_requested` line — no second initial import |
| 11 | `GET /catalog` as owner | 200 | `channels { requested: 0, approved: 1, paused: 0, declined: 0 }`, all `episodes` counts 0, `runs.active: 0`, `attention { failedEpisodes: 0, neverStarted: 1, requested: 0 }`, `lastSuccessfulIngestionAt: null` |
| 12 | `POST /channels {/channel/UC… URL}` as owner | 201 | The owner's own add creates `status: "approved"` with `approvedAt` set **and follows the owner** (`following: true`, `followerCount: 1`, so it is not system-paused), and logs a second `ingestion.start_requested` |
| 13 | `DELETE /channels/:id`, `POST /channels/:id/restore`, `POST /channels/:id/retry`, `GET`/`POST /channel-requests`, `GET /channels/:id/requests` | 404 each | The removed routes are gone from the Worker |
| 14 | `POST /channels {"channelId":"@mkbhd"}` and an id with no feed | 400 each | `INVALID_INPUT` with the copy-the-id instructions, and "no YouTube channel has that id" |
| 15 | `GET /channels/:id/episodes` and `GET /digest` as bob | 200 each | `{"episodes":[]}` and an empty digest — nothing has been ingested |

**Not exercised, and why.** The episode half of spec criterion 15 — an episode becoming `available`, one `skipped`,
one `failed`, and the owner's Retry and Skip on them — cannot be driven through the API on this branch. Ingestion is
still log-only (`lib/ingestion.ts`), so no run ever writes an episode row, and this task does not seed rows by SQL.
The episode routes and their transitions are covered by the API tests, which seed the Registry directly; they should
be walked through under `wrangler dev` when M3 makes an episode reach `available` for real. For the same reason no
`ingestion_runs` row exists, so `GET /channels/:id/ingestion-runs` and a pause interacting with a run in flight were
not observable either.

**Browser pass: done.** Nothing on the web side was rendered in the API run above. On 2026-09-10, after the branch was
merged to `main` at `6e075b1` and local Durable Object state was wiped with `clean-local-do`, the owner walked Home
(Followed, Catalog, and the Add-a-channel box, including the declined-id note with Request again), Channel at each of
the three statuses, Owner (Queue, Needs attention, All channels, health strip), and Owner channel detail under
`pnpm dev` and reported the walkthrough completed with no defects.
