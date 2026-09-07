import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { seedOwner } from "../src/do/registry/users";
import { ALICE, expectRegistryError, OWNER, registry } from "./helpers";

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
    await expectRegistryError(stub.ensureUser("not-an-email"), "INVALID_INPUT");
    await expectRegistryError(stub.getUser(""), "INVALID_INPUT");
  });
});
