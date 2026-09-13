import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { userMigrations } from "../migrations/user";
import { applyMigrations } from "../src/do/migrations";
import { ALICE, userDO } from "./helpers";

describe("user migrations", () => {
  it("creates every per-user table on first access and records the version", async () => {
    const stub = userDO(ALICE);
    await stub.getPreferences();

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

    // No follows table: the Registry's channel_followers is the one record of follows.
    expect(tables).toEqual([
      "_migrations",
      "chat_message_sources",
      "chat_messages",
      "chats",
      "summary_reads",
      "user_preferences",
    ]);
    expect(versions).toEqual(["0001_init"]);
  });

  it("is a no-op when run a second time", async () => {
    const stub = userDO(ALICE);
    await stub.getPreferences();

    const applied = await runInDurableObject(stub, (_, state) =>
      applyMigrations(state.storage, userMigrations),
    );

    expect(applied).toEqual([]);
  });

  it("enforces the same-chat reply rule and the other CHECK constraints", async () => {
    const stub = userDO(ALICE);
    await stub.getPreferences();

    await runInDurableObject(stub, (_, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT INTO chats (chat_id, title, created_at, updated_at)
         VALUES ('c1', NULL, 1, 1), ('c2', NULL, 1, 1)`,
      );
      sql.exec(
        `INSERT INTO chat_messages
           (message_id, chat_id, sequence_number, role, content, status, created_at, updated_at)
         VALUES ('m1', 'c1', 0, 'user', 'hi', 'completed', 1, 1)`,
      );

      // A reply in chat c2 cannot answer a message from chat c1.
      expect(() =>
        sql.exec(
          `INSERT INTO chat_messages
             (message_id, chat_id, sequence_number, role, content, status, reply_to_message_id,
              created_at, updated_at)
           VALUES ('m2', 'c2', 0, 'assistant', '', 'pending', 'm1', 1, 1)`,
        ),
      ).toThrow(/FOREIGN KEY/i);
      // The same reply in chat c1 is fine.
      sql.exec(
        `INSERT INTO chat_messages
           (message_id, chat_id, sequence_number, role, content, status, reply_to_message_id,
            created_at, updated_at)
         VALUES ('m2', 'c1', 1, 'assistant', '', 'pending', 'm1', 1, 1)`,
      );

      // User messages are always completed; assistant replies always answer something.
      expect(() =>
        sql.exec(
          `INSERT INTO chat_messages
             (message_id, chat_id, sequence_number, role, content, status, created_at, updated_at)
           VALUES ('m3', 'c1', 2, 'user', 'x', 'pending', 1, 1)`,
        ),
      ).toThrow(/CHECK/i);
      expect(() =>
        sql.exec(
          `INSERT INTO chat_messages
             (message_id, chat_id, sequence_number, role, content, status, created_at, updated_at)
           VALUES ('m3', 'c1', 2, 'assistant', '', 'pending', 1, 1)`,
        ),
      ).toThrow(/CHECK/i);
      // Failed replies carry a code.
      expect(() =>
        sql.exec(
          "UPDATE chat_messages SET status = 'failed' WHERE message_id = 'm2'",
        ),
      ).toThrow(/CHECK/i);

      // Preferences are a singleton.
      expect(() =>
        sql.exec(
          `INSERT INTO user_preferences (id, system_rules, created_at, updated_at)
           VALUES ('other', '', 1, 1)`,
        ),
      ).toThrow(/CHECK/i);
    });
  });
});
