import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import schema from "../migrations/auth/0001_better_auth.sql";
import { consumeCode, mintCode } from "../src/lib/handoff";

/**
 * The handoff (docs/specs/auth-phase.md §4.5): the one place a session crosses from this origin to
 * the web's. Nothing here touches a provider — the OAuth leg cannot be exercised offline and is
 * covered by the chunk's `wrangler dev` walkthrough.
 */

const WEB = "http://localhost:5173/auth/callback";
const NOT_WEB = "https://elsewhere.example.com/auth/callback";

/** better-auth's schema, applied statement by statement: D1's `exec` cannot take comments. */
beforeAll(async () => {
  const statements = schema
    .split("\n")
    .filter((line) => !line.startsWith("--") && line.trim().length > 0)
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await env.AUTH_DB.prepare(
      statement.replace(/^create (table|index) "/, 'create $1 if not exists "'),
    ).run();
  }
});

/** A signed-in identity, inserted the way A7's test helper will: rows, then the session's token. */
async function signedIn(suffix: string): Promise<string> {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  await env.AUTH_DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Test', ?, 1, ?, ?)`,
  )
    .bind(`u_${suffix}`, `${suffix}@example.com`, now, now)
    .run();
  await env.AUTH_DB.prepare(
    `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(`s_${suffix}`, later, `token-${suffix}`, now, now, `u_${suffix}`)
    .run();
  return `token-${suffix}`;
}

describe("the session handoff", () => {
  it("spends a code exactly once", async () => {
    const token = await signedIn("once");
    const code = await mintCode(env.AUTH_DB, token, Date.now());

    const first = await SELF.fetch("http://api/session/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      token: string;
      userId: string;
      email: string | null;
    };
    expect(body.token).toBe(token);
    expect(body.userId).toBe("u_once");
    expect(body.email).toBe("once@example.com");

    const replay = await SELF.fetch("http://api/session/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(replay.status).toBe(401);
  });

  it("refuses a code older than its minute, and spends it anyway", async () => {
    const token = await signedIn("stale");
    const code = await mintCode(env.AUTH_DB, token, Date.now() - 61_000);
    expect(await consumeCode(env.AUTH_DB, code, Date.now())).toBeNull();
    // Expired or not, the row is gone: an expired code is still a spent one.
    expect(await consumeCode(env.AUTH_DB, code, Date.now())).toBeNull();
  });

  it("answers the same 401 for unknown, expired and spent codes", async () => {
    const unknown = await SELF.fetch("http://api/session/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "no-such-code" }),
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({
      error: "the code is expired, unknown, or already used",
    });
  });

  it("refuses to hand off to an origin WEB_ORIGINS does not allow, and mints nothing", async () => {
    const before = await codeCount();
    for (const path of [
      `http://api/session/start?provider=google&next=${encodeURIComponent(NOT_WEB)}`,
      `http://api/session/handoff?next=${encodeURIComponent(NOT_WEB)}`,
    ]) {
      const response = await SELF.fetch(path, { redirect: "manual" });
      expect(response.status).toBe(400);
    }
    expect(await codeCount()).toBe(before);
  });

  it("tells a configured provider from one with no credentials", async () => {
    // Meta is configured in lib/auth.ts and deliberately has none until an App ID exists, so it is
    // a 400 from us rather than a 500 from the provider — and it is what tells A6 which buttons to
    // render. Google is given credentials here so the test discriminates instead of refusing
    // everything: with none set, both would be 400 and the assertion would prove nothing.
    env.GOOGLE_CLIENT_ID = "test-client-id";
    env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    try {
      const refused = await SELF.fetch(
        `http://api/session/start?provider=facebook&next=${encodeURIComponent(WEB)}`,
        { redirect: "manual" },
      );
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "INVALID_INPUT" });

      // Google gets as far as building the provider URL, and the state cookie rides the redirect —
      // the whole reason this route exists rather than a fetch from the web (A4, 2026-09-20).
      const started = await SELF.fetch(
        `http://api/session/start?provider=google&next=${encodeURIComponent(WEB)}`,
        { redirect: "manual" },
      );
      expect(started.status).toBe(302);
      expect(started.headers.get("location")).toContain("accounts.google.com");
      expect(started.headers.getSetCookie().join(";")).toContain(
        "better-auth.state=",
      );
    } finally {
      env.GOOGLE_CLIENT_ID = undefined;
      env.GOOGLE_CLIENT_SECRET = undefined;
    }
  });

  it("refuses a handoff with no session rather than redirecting somewhere useless", async () => {
    const response = await SELF.fetch(
      `http://api/session/handoff?next=${encodeURIComponent(WEB)}`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(401);
  });

  it("redirects with the code in the fragment and the token nowhere", async () => {
    // The bearer plugin resolves a session from this header exactly as the cookie does, which is
    // what lets the route be exercised offline; deployed, the callback arrives with the cookie.
    const token = await signedIn("fragment");
    const response = await SELF.fetch(
      `http://api/session/handoff?next=${encodeURIComponent(WEB)}`,
      { redirect: "manual", headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";

    const [before, fragment] = location.split("#");
    expect(before).toBe(WEB);
    expect(fragment).toMatch(/^code=[0-9a-f]{32}$/);
    // The credential itself never travels in the URL — that is the whole point of the code.
    expect(location).not.toContain(token);
    // And the code it does carry is spendable exactly once, for that session.
    const code = fragment?.slice("code=".length) ?? "";
    expect(await consumeCode(env.AUTH_DB, code, Date.now())).toBe(token);
  });
});

async function codeCount(): Promise<number> {
  const row = await env.AUTH_DB.prepare(
    "SELECT COUNT(*) AS n FROM verification WHERE identifier LIKE 'handoff:%'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}
