import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { registryMigrations } from "../migrations/registry";
import { applyMigrations } from "../src/do/migrations";
import { ALICE, CHANNEL_A, OWNER, registry } from "./helpers";

describe("registry migrations", () => {
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
        .exec<{ version: string }>(
          "SELECT version FROM _migrations ORDER BY version",
        )
        .toArray()
        .map((row) => row.version),
    }));
    expect(tables).toEqual([
      "_migrations",
      "channel_followers",
      "channels",
      "episode_summaries",
      "episodes",
      "global_users",
      "ingestion_run_episodes",
      "ingestion_runs",
    ]);
    expect(versions).toEqual(["0001_init"]);
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
          "status, reviewed_at, reviewed_by_email",
          "'approved', 1, 'alice@example.com'",
        ),
      ).toThrow(/CHECK/i);
      insert("UCx", "status", "'requested'");
      expect(() =>
        sql.exec(
          "UPDATE channels SET paused_by = 'owner' WHERE channel_id = 'UCx'",
        ),
      ).toThrow(/CHECK/i);

      // Isolates the pause-pair check on an approved row: paused_by alone must fail,
      // paused_by with paused_at must pass.
      insert(
        "UCz",
        "status, approved_at, reviewed_at, reviewed_by_email",
        "'approved', 1, 1, 'alice@example.com'",
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

  it("ties episode columns to status", async () => {
    const stub = registry();
    await stub.createChannel(OWNER, {
      channelId: CHANNEL_A,
      title: "A",
      status: "approved",
    });
    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      const insert = (cols: string, vals: string) =>
        sql.exec(
          `INSERT INTO episodes (video_id, channel_id, title, published_at, ${cols}, updated_at, created_at) VALUES ('v', ?, 't', 1, ${vals}, 1, 1)`,
          CHANNEL_A,
        );
      expect(() => insert("status", "'processed'")).toThrow(/CHECK/i);
      expect(() => insert("status", "'available'")).toThrow(/CHECK/i);
      expect(() =>
        insert(
          "status, chunk_count, vectorized_at, processed_at",
          "'available', 0, 1, 1",
        ),
      ).toThrow(/CHECK/i);
      expect(() => insert("status", "'skipped'")).toThrow(/CHECK/i);
      expect(() =>
        insert("status, skip_reason, skipped_at", "'skipped', 'OWNER', 1"),
      ).toThrow(/CHECK/i);
      expect(() => insert("status, skip_reason", "'pending', 'SHORT'")).toThrow(
        /CHECK/i,
      );
      expect(() => insert("status", "'failed'")).toThrow(/CHECK/i);
      expect(() =>
        insert(
          "status, waiting_code, chunk_count, vectorized_at, processed_at",
          "'available', 'CAPTIONS', 1, 1, 1",
        ),
      ).toThrow(/CHECK/i);
      insert("status, waiting_code", "'pending', 'CAPTIONS'");
      sql.exec(
        "UPDATE episodes SET status = 'skipped', waiting_code = NULL, skip_reason = 'SHORT', skipped_at = 1 WHERE video_id = 'v'",
      );
      sql.exec(
        "UPDATE episodes SET status = 'available', skip_reason = NULL, skipped_at = NULL, chunk_count = 2, vectorized_at = 1, processed_at = 1 WHERE video_id = 'v'",
      );
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
             (channel_id, user_email, followed_at, created_at, updated_at)
           VALUES (?, 'ghost@example.com', 1, 1, 1)`,
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
