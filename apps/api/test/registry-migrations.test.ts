import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { registryMigrations } from "../migrations/registry";
import { applyMigrations } from "../src/do/migrations";
import { ALICE, CHANNEL_A, OWNER, registry } from "./helpers";

describe("registry migrations", () => {
  it("creates every Registry table on first access and records the version", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);

    const { tables, versions } = await runInDurableObject(stub, (_, state) => ({
      tables: state.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_'
           ORDER BY name`,
        )
        .toArray()
        .map((row) => row.name),
      versions: state.storage.sql
        .exec<{ version: string }>(
          "SELECT version FROM _migrations ORDER BY version",
        )
        .toArray()
        .map((row) => row.version),
    }));

    expect(tables).toEqual([
      "_migrations",
      "channel_requests",
      "channels",
      "episode_summaries",
      "episodes",
      "global_users",
      "ingestion_run_episodes",
      "ingestion_runs",
    ]);
    expect(versions).toEqual(["0001_init"]);
  });

  it("is a no-op when run a second time", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);

    const applied = await runInDurableObject(stub, (_, state) =>
      applyMigrations(state.storage, registryMigrations),
    );

    expect(applied).toEqual([]);
  });

  it("requires a positive chunk count only when an episode is processed", async () => {
    const stub = registry();
    await stub.configureChannel(OWNER, { channelId: CHANNEL_A, title: "Test" });

    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      for (const count of [null, 0]) {
        expect(() =>
          sql.exec(
            `INSERT INTO episodes
               (video_id, channel_id, title, published_at, status, chunk_count,
                vectorized_at, processed_at, created_at, updated_at)
             VALUES ('invalid', ?, 'Test', 1, 'processed', ?, 1, 1, 1, 1)`,
            CHANNEL_A,
            count,
          ),
        ).toThrow(/CHECK/i);
      }

      sql.exec(
        `INSERT INTO episodes
           (video_id, channel_id, title, published_at, status, created_at, updated_at)
         VALUES ('pending', ?, 'Test', 1, 'pending', 1, 1)`,
        CHANNEL_A,
      );
      expect(() =>
        sql.exec(
          `UPDATE episodes SET status = 'processed', vectorized_at = 1, processed_at = 1
           WHERE video_id = 'pending'`,
        ),
      ).toThrow(/CHECK/i);

      sql.exec(
        `UPDATE episodes SET status = 'processed', chunk_count = 1,
           vectorized_at = 1, processed_at = 1 WHERE video_id = 'pending'`,
      );
      expect(() =>
        sql.exec(
          "UPDATE episodes SET chunk_count = NULL WHERE video_id = 'pending'",
        ),
      ).toThrow(/CHECK/i);
      expect(
        sql
          .exec<{ status: string; chunk_count: number }>(
            "SELECT status, chunk_count FROM episodes WHERE video_id = 'pending'",
          )
          .one(),
      ).toEqual({ status: "processed", chunk_count: 1 });
    });
  });

  it("enforces foreign keys and CHECK constraints", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);

    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      expect(() =>
        sql.exec(
          `INSERT INTO channel_requests
             (request_id, user_email, youtube_channel_id, submitted_url, status, created_at, updated_at)
           VALUES ('r1', 'ghost@example.com', ?, 'u', 'pending', 0, 0)`,
          CHANNEL_A,
        ),
      ).toThrow(/FOREIGN KEY/i);
      expect(() =>
        sql.exec(
          `INSERT INTO global_users (email, role, created_at, last_seen_at)
           VALUES ('x@example.com', 'superuser', 0, 0)`,
        ),
      ).toThrow(/CHECK/i);
    });
  });
});
