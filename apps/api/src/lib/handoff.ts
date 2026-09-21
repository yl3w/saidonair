/**
 * The one-time code that carries a session across the origin boundary (docs/specs/auth-phase.md
 * §4.5). The OAuth callback lands on this API and better-auth sets its cookie here; the web is on
 * another origin and can never read it. Something has to cross, and in a redirect the only vehicle
 * is the URL — so what crosses is a code worth nothing after sixty seconds or one use, and the
 * session token itself is only ever returned in a response body.
 *
 * It lives in better-auth's own `verification` table, which is already
 * `identifier / value / expiresAt` (A0 question 5). Our identifiers carry a prefix so they can
 * never be mistaken for, or collide with, the OAuth state rows better-auth keeps there.
 */

const PREFIX = "handoff:";
const LIFETIME_MS = 60_000;

/** Mints a single-use code for a session token. Returns the code to put in the URL fragment. */
export async function mintCode(
  db: D1Database,
  sessionToken: string,
  now: number,
): Promise<string> {
  const code = crypto.randomUUID().replaceAll("-", "");
  const iso = (ms: number) => new Date(ms).toISOString();
  await db
    .prepare(
      `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      PREFIX + code,
      sessionToken,
      iso(now + LIFETIME_MS),
      iso(now),
      iso(now),
    )
    .run();
  return code;
}

/**
 * Consumes a code and answers the session token it carried, or null. Deletes and returns in one
 * statement, so two requests racing the same code cannot both win: `DELETE … RETURNING` removes the
 * row and hands back what it held, and a replay finds nothing. Expiry is checked after the delete,
 * because an expired code is still spent.
 */
export async function consumeCode(
  db: D1Database,
  code: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `DELETE FROM verification WHERE identifier = ? RETURNING value, expiresAt`,
    )
    .bind(PREFIX + code)
    .first<{ value: string; expiresAt: string }>();
  if (!row) return null;
  return Date.parse(row.expiresAt) > now ? row.value : null;
}
