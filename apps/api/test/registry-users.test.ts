import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { seedOwner } from "../src/do/registry/users";
import { ALICE, expectDomainError, OWNER, registry } from "./helpers";

describe("registry identities", () => {
  it("seeds OWNER_EMAIL as the owner on start", async () => {
    const owner = await registry().getUser(OWNER);
    expect(owner).toMatchObject({ email: OWNER, role: "owner" });
  });

  it("auto-registers unknown emails as users, normalized", async () => {
    const user = await registry().ensureUser("  Alice@Example.COM ");
    expect(user).toMatchObject({ email: ALICE, role: "user" });
    expect(user.createdAt).toBeGreaterThan(0);
  });

  it("touches last_seen_at on repeat visits without changing created_at or role", async () => {
    const stub = registry();
    const first = await stub.ensureUser(ALICE);
    const second = await stub.ensureUser(ALICE);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastSeenAt).toBeGreaterThanOrEqual(first.lastSeenAt);

    const owner = await stub.ensureUser(OWNER);
    expect(owner.role).toBe("owner");
  });

  it("promotes an already-registered user when seeded, and never demotes", async () => {
    const stub = registry();
    await stub.ensureUser(ALICE);
    await runInDurableObject(stub, (_, state) => {
      seedOwner(state.storage.sql, ALICE, Date.now());
    });

    expect((await stub.getUser(ALICE))?.role).toBe("owner");
    expect((await stub.getUser(OWNER))?.role).toBe("owner");
  });

  it("returns null for unknown users and rejects malformed emails", async () => {
    const stub = registry();
    expect(await stub.getUser("ghost@example.com")).toBeNull();
    await expectDomainError(stub.ensureUser("not-an-email"), "INVALID_INPUT");
    await expectDomainError(stub.getUser(""), "INVALID_INPUT");
  });

  it("mints a stable user_id per identity, and leaves auth_user_id null", async () => {
    const stub = registry();
    const first = await stub.ensureUser("rekey-one@example.com");
    const again = await stub.ensureUser("rekey-one@example.com");
    const other = await stub.ensureUser("rekey-two@example.com");

    expect(first.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(again.userId).toBe(first.userId);
    expect(other.userId).not.toBe(first.userId);
    expect(first.authUserId).toBeNull();
  });

  it("admits many rows with no email, and only one per address", async () => {
    const stub = registry();
    const taken = await stub.ensureUser("rekey-taken@example.com");
    const outcome = await runInDurableObject(stub, (_, state) => {
      const insert = (userId: string, email: string | null) =>
        state.storage.sql.exec(
          `INSERT INTO global_users (user_id, email, role, created_at, last_seen_at)
           VALUES (?, ?, 'user', 1, 1)`,
          userId,
          email,
        );
      insert("nomail-1", null);
      insert("nomail-2", null);
      let duplicateRejected = false;
      try {
        insert("dup", "rekey-taken@example.com");
      } catch {
        duplicateRejected = true;
      }
      return { duplicateRejected, taken: taken.userId };
    });
    expect(outcome.duplicateRejected).toBe(true);
  });

  it("admits many rows with no auth_user_id, and only one per value", async () => {
    const outcome = await runInDurableObject(registry(), (_, state) => {
      const insert = (userId: string, authUserId: string | null) =>
        state.storage.sql.exec(
          `INSERT INTO global_users (user_id, email, auth_user_id, role, created_at, last_seen_at)
           VALUES (?, NULL, ?, 'user', 1, 1)`,
          userId,
          authUserId,
        );
      insert("noauth-1", null);
      insert("noauth-2", null);
      insert("hasauth-1", "auth-abc");
      let duplicateRejected = false;
      try {
        insert("hasauth-2", "auth-abc");
      } catch {
        duplicateRejected = true;
      }
      return { duplicateRejected };
    });
    expect(outcome.duplicateRejected).toBe(true);
  });

  it("seeds the owner without ever creating a second row for that address", async () => {
    const stub = registry();
    const seeded = "rekey-owner@example.com";
    await stub.ensureUser(seeded);
    await runInDurableObject(stub, (_, state) => {
      seedOwner(state.storage.sql, seeded, Date.now());
      seedOwner(state.storage.sql, seeded, Date.now());
    });
    const rows = await runInDurableObject(
      stub,
      (_, state) =>
        state.storage.sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM global_users WHERE email = ?",
            seeded,
          )
          .one().n,
    );
    expect(rows).toBe(1);
    expect((await stub.getUser(seeded))?.role).toBe("owner");
  });
});
