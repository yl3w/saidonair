-- better-auth's own schema for this environment's D1 database (docs/specs/auth-phase.md §4.1).
-- Generated, not hand-written, and it holds nothing of the domain: the Registry and the User DO are
-- untouched by it, and the only link between the two stores is `global_users.auth_user_id`, which
-- chunk A7 writes.
--
-- Regenerate after a better-auth upgrade. The CLI cannot reach a D1 binding, so point it at Node's
-- built-in SQLite instead, from `apps/api`, with a throwaway config that mirrors `src/lib/auth.ts`'s
-- providers and plugins (they decide the schema):
--
--   export const auth = betterAuth({
--     database: new DatabaseSync("./tmp.db"), secret: "generation-only",
--     socialProviders: { google: {...}, facebook: {...} },
--     account: { accountLinking: { enabled: true, trustedProviders: ["google", "facebook"] } },
--     plugins: [bearer()],
--   });
--   pnpm dlx @better-auth/cli@latest generate --config <that file> --output migrations/auth/0001_better_auth.sql -y
--
-- Apply with `wrangler d1 execute media-digest-auth-dev --local --file=migrations/auth/0001_better_auth.sql`
-- (or the environment's database, without --local). This is not run by `applyMigrations`: that is the
-- Durable Objects' migration runner, and D1 is not a Durable Object.
--
-- Timestamps are ISO 8601 strings, not epoch milliseconds — A7's test helper has to match.

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");