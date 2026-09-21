import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { registryMigrations } from "../migrations/registry";
import { applyMigrations } from "../src/do/migrations";
import {
  ALICE,
  CHANNEL_A,
  registry,
  seedApprovedChannel,
  seedRun,
} from "./helpers";

/** The rewritten 0001 (2026-09-12) applies alone and its table checks reject what PRD §5.3 says they reject. */
describe("registry migrations", () => {
  it("creates every Registry table on first access and records both migrations", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);
    const columnsOf = (sql: SqlStorage, table: string) =>
      sql
        .exec<{ name: string }>(`PRAGMA table_info(${table})`)
        .toArray()
        .map((row) => row.name);
    const { tables, versions, channelColumns, episodeColumns, runColumns } =
      await runInDurableObject(stub, (_, state) => ({
        tables: state.storage.sql
          .exec<{ name: string }>(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' ORDER BY name`,
          )
          .toArray()
          .map((row) => row.name),
        versions: state.storage.sql
          .exec<{ version: string }>(
            "SELECT version FROM _migrations ORDER BY version",
          )
          .toArray()
          .map((row) => row.version),
        channelColumns: columnsOf(state.storage.sql, "channels"),
        episodeColumns: columnsOf(state.storage.sql, "episodes"),
        runColumns: columnsOf(state.storage.sql, "ingestion_runs"),
      }));
    expect(tables).toEqual([
      "_migrations",
      "channel_followers",
      "channels",
      "episode_ingestion_attempts",
      "episode_summaries",
      "episodes",
      "global_users",
      "ingestion_runs",
    ]);
    expect(versions).toEqual(["0001_init", "0002_episode_duration"]);
    // Gone with the 2026-09-12 restart: the run fence, the stored ingestion time, the waiting code,
    // and every run status or Workflow column.
    expect(channelColumns).not.toContain("lifecycle_version");
    expect(channelColumns).not.toContain("last_ingested_at");
    expect(episodeColumns).not.toContain("waiting_code");
    expect(episodeColumns).toEqual(
      expect.arrayContaining([
        "discovered_by_run_id",
        "intent",
        "window_deadline_at",
        "next_attempt_at",
        "active_vector_generation",
        "staged_vector_generation",
      ]),
    );
    const indexes = await runInDurableObject(stub, (_, state) =>
      state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'channel_followers' ORDER BY name",
        )
        .toArray()
        .map((row) => row.name),
    );
    // The follower record is the one record of follows: indexed by channel (counts, queue) and by user (own list, eligibility).
    expect(indexes).toEqual(
      expect.arrayContaining([
        "channel_followers_channel_id_unfollowed_at",
        "channel_followers_user_id_unfollowed_at",
      ]),
    );
    expect(runColumns).toEqual([
      "run_id",
      "channel_id",
      "kind",
      "feed_status",
      "discovered_count",
      "episode_limit",
      "started_at",
      "finished_at",
      "created_at",
    ]);
  });

  it("ties channel columns to status", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);
    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      const insert = (id: string, cols: string, vals: string) =>
        sql.exec(
          `INSERT INTO channels (channel_id, title, canonical_url, ${cols}, updated_at, created_at) VALUES ('${id}', 't', 'u', ${vals}, 1, 1)`,
        );
      expect(() => insert("UCx", "status", "'approved'")).toThrow(/CHECK/i);
      expect(() => insert("UCx", "status", "'declined'")).toThrow(/CHECK/i);
      expect(() =>
        insert(
          "UCx",
          "status, paused_by, paused_at",
          "'requested', 'system', 1",
        ),
      ).toThrow(/CHECK/i);
      expect(() => insert("UCx", "status", "'pending'")).toThrow(/CHECK/i);
      // Isolates the approved_at check: review fields are set, approved_at is not.
      expect(() =>
        insert(
          "UCy",
          "status, reviewed_at, reviewed_by_user_id",
          "'approved', 1, NULL",
        ),
      ).toThrow(/CHECK/i);
      insert("UCx", "status", "'requested'");
      expect(() =>
        sql.exec(
          "UPDATE channels SET paused_by = 'owner' WHERE channel_id = 'UCx'",
        ),
      ).toThrow(/CHECK/i);
      insert(
        "UCz",
        "status, approved_at, reviewed_at, reviewed_by_user_id",
        "'approved', 1, 1, (SELECT user_id FROM global_users LIMIT 1)",
      );
      expect(() =>
        sql.exec(
          "UPDATE channels SET paused_by = 'owner' WHERE channel_id = 'UCz'",
        ),
      ).toThrow(/CHECK/i);
      sql.exec(
        "UPDATE channels SET paused_by = 'owner', paused_at = 1 WHERE channel_id = 'UCz'",
      );
    });
  });

  it("is a no-op when run a second time", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);
    const applied = await runInDurableObject(stub, (_, state) =>
      applyMigrations(state.storage, registryMigrations),
    );
    expect(applied).toEqual([]);
  });

  it("ties a discovery run's count to its feed status", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    await expect(
      seedRun(CHANNEL_A, { feedStatus: "unavailable", discoveredCount: 2 }),
    ).rejects.toThrow(/CHECK/i);
    await seedRun(CHANNEL_A, { feedStatus: "unavailable" });
    await seedRun(CHANNEL_A, { feedStatus: "read", discoveredCount: 2 });
    expect(await stub.listRuns(CHANNEL_A)).toHaveLength(2);
  });

  it("ties episode columns to status and the processing window to itself", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    const runId = await seedRun(CHANNEL_A);
    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      const insert = (cols: string, vals: string) =>
        sql.exec(
          `INSERT INTO episodes (episode_id, channel_id, discovered_by_run_id, title, published_at, ${cols}, updated_at, created_at)
           VALUES ('v', ?, ?, 't', 1, ${vals}, 1, 1)`,
          CHANNEL_A,
          runId,
        );
      const available =
        "chunk_count, vectorized_at, processed_at, active_vector_generation";
      expect(() => insert("status", "'processed'")).toThrow(/CHECK/i);
      // Available needs chunks, timestamps, and an active generation.
      expect(() => insert("status", "'available'")).toThrow(/CHECK/i);
      expect(() =>
        insert(`status, ${available}`, "'available', 0, 1, 1, 'g1'"),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert(
          "status, chunk_count, vectorized_at, processed_at",
          "'available', 2, 1, 1",
        ),
      ).toThrow(/CHECK/i);
      // failed is INGESTION_TIMEOUT exactly.
      expect(() => insert("status", "'failed'")).toThrow(/CHECK/i);
      expect(() =>
        insert("status, failure_code", "'failed', 'PROVIDER_HTTP'"),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert("status, failure_code", "'pending', 'INGESTION_TIMEOUT'"),
      ).toThrow(/CHECK/i);
      // Skips: reason and status imply each other, dated, OWNER names who.
      expect(() => insert("status", "'skipped'")).toThrow(/CHECK/i);
      expect(() =>
        insert("status, skip_reason, skipped_at", "'skipped', 'OWNER', 1"),
      ).toThrow(/CHECK/i);
      expect(() => insert("status, skip_reason", "'pending', 'SHORT'")).toThrow(
        /CHECK/i,
      );
      expect(() =>
        insert(
          "status, skip_reason, skipped_at",
          "'skipped', 'NO_CAPTIONS', 1",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert("status, skipped_by_email", "'pending', 'alice@example.com'"),
      ).toThrow(/CHECK/i);
      // The processing window: all four set or all null, `publish` on pending, `replace` on available.
      expect(() => insert("status, intent", "'pending', 'publish'")).toThrow(
        /CHECK/i,
      );
      expect(() =>
        insert(
          "status, intent, window_started_at, window_deadline_at",
          "'pending', 'publish', 1, 2",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert(
          "status, intent, window_started_at, window_deadline_at, next_attempt_at",
          "'pending', 'replace', 1, 2, 1",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert(
          `status, ${available}, intent, window_started_at, window_deadline_at, next_attempt_at`,
          "'available', 2, 1, 1, 'g1', 'publish', 1, 2, 1",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert("status, staged_vector_generation", "'pending', 'g2'"),
      ).toThrow(/CHECK/i);
      // And the shapes that are allowed.
      insert(
        "status, intent, window_started_at, window_deadline_at, next_attempt_at, staged_vector_generation",
        "'pending', 'publish', 1, 2, 1, 'g2'",
      );
      sql.exec(
        `UPDATE episodes SET status = 'skipped', intent = NULL, window_started_at = NULL,
           window_deadline_at = NULL, next_attempt_at = NULL, staged_vector_generation = NULL,
           skip_reason = 'SHORT', skipped_at = 1 WHERE episode_id = 'v'`,
      );
      sql.exec(
        `UPDATE episodes SET status = 'available', skip_reason = NULL, skipped_at = NULL,
           chunk_count = 2, vectorized_at = 1, processed_at = 1, active_vector_generation = 'g1',
           intent = 'replace', window_started_at = 5, window_deadline_at = 6, next_attempt_at = 5
         WHERE episode_id = 'v'`,
      );
      sql.exec(
        `UPDATE episodes SET status = 'failed', failure_code = 'INGESTION_TIMEOUT', failure_detail = 'CAPTIONS',
           intent = NULL, window_started_at = NULL, window_deadline_at = NULL, next_attempt_at = NULL
         WHERE episode_id = 'v'`,
      );
    });
  });

  it("ties attempt columns to status and trigger", async () => {
    const stub = registry();
    await seedApprovedChannel(CHANNEL_A, "A");
    const runId = await seedRun(CHANNEL_A);
    await stub.ensureUser(ALICE);
    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT INTO episodes (episode_id, channel_id, discovered_by_run_id, title, published_at, status, updated_at, created_at)
         VALUES ('v', ?, ?, 't', 1, 'pending', 1, 1)`,
        CHANNEL_A,
        runId,
      );
      const insert = (id: string, cols: string, vals: string) =>
        sql.exec(
          `INSERT INTO episode_ingestion_attempts (attempt_id, episode_id, intent, started_at, created_at, ${cols})
           VALUES ('${id}', 'v', 'publish', 1, 1, ${vals})`,
        );
      // Running has no end; every other status has one.
      expect(() =>
        insert(
          "a1",
          "trigger, status, finished_at",
          "'channel_ingestion', 'running', 2",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert("a1", "trigger, status", "'channel_ingestion', 'waiting'"),
      ).toThrow(/CHECK/i);
      // A blocked start never launched an instance.
      expect(() =>
        insert(
          "a1",
          "trigger, status, finished_at, workflow_id",
          "'scheduled_recovery', 'blocked', 2, 'wf'",
        ),
      ).toThrow(/CHECK/i);
      // Owner Retry names who asked; the automatic triggers name nobody.
      expect(() =>
        insert(
          "a1",
          "trigger, status, finished_at",
          "'owner_retry', 'waiting', 2",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert(
          "a1",
          "trigger, status, finished_at, requested_by_email",
          "'scheduled_recovery', 'waiting', 2, 'alice@example.com'",
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        insert("a1", "trigger, status", "'channel_ingestion', 'started'"),
      ).toThrow(/CHECK/i);
      insert(
        "a1",
        "trigger, status, workflow_id",
        "'channel_ingestion', 'running', 'wf-1'",
      );
      insert(
        "a2",
        "trigger, status, finished_at, requested_by_email",
        "'owner_retry', 'blocked', 2, 'alice@example.com'",
      );
      // outcome_code is the closed AttemptOutcomeCode set (PRD §5.3; the CHECK since M3.7).
      expect(() =>
        insert(
          "a4",
          "trigger, status, finished_at, outcome_code",
          "'channel_ingestion', 'failed', 2, 'SOMETHING_ELSE'",
        ),
      ).toThrow(/CHECK/i);
      insert(
        "a4",
        "trigger, status, finished_at, outcome_code",
        "'channel_ingestion', 'failed', 2, 'WORKFLOW_LOST'",
      );
      // Workflow ids are unique across attempts.
      expect(() =>
        insert(
          "a3",
          "trigger, status, workflow_id",
          "'channel_ingestion', 'running', 'wf-1'",
        ),
      ).toThrow(/UNIQUE/i);
    });
  });

  it("enforces foreign keys and CHECK constraints", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);
    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      expect(() =>
        sql.exec(
          `INSERT INTO channel_followers
             (channel_id, user_id, followed_at, created_at, updated_at)
           VALUES (?, 'no-such-user-id', 1, 1, 1)`,
          CHANNEL_A,
        ),
      ).toThrow(/FOREIGN KEY/i);
      expect(() =>
        sql.exec(
          `INSERT INTO global_users (user_id, email, role, created_at, last_seen_at)
           VALUES ('u-x', 'x@example.com', 'superuser', 0, 0)`,
        ),
      ).toThrow(/CHECK/i);
    });
  });
});
