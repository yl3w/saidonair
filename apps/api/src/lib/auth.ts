import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import type { Env } from "../env";
import { DEFAULT_WEB_ORIGINS, parseOrigins } from "./cors";

/**
 * The `better-auth` instance, built **per request** because a D1 binding does not exist at module
 * scope (docs/specs/auth-phase.md §4.1). 1.7.5 accepts the binding directly — no Kysely, no
 * dialect, no wrapper — and defaults `transaction` to false, which is what D1 needs; the A0 spike
 * completed a real Google sign-in on this configuration.
 *
 * Nothing consumes it yet. `requireIdentity` still reads `X-User-Email`, and chunk A7 is where the
 * session becomes the identity.
 */
export function makeAuth(env: Env) {
  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.API_BASE_URL,
    basePath: "/auth",
    // One source for "which browser origins are ours", shared with CORS so the two cannot drift.
    trustedOrigins: parseOrigins(env.WEB_ORIGINS ?? DEFAULT_WEB_ORIGINS),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
        mapProfileToUser: emailFallback("google"),
      },
      facebook: {
        clientId: env.FACEBOOK_CLIENT_ID ?? "",
        clientSecret: env.FACEBOOK_CLIENT_SECRET ?? "",
        mapProfileToUser: emailFallback("facebook"),
      },
    },
    account: {
      // One person is one identity: the same verified address arriving by either provider resolves
      // to one better-auth user, and so to one `user_id` and one User DO (spec decision 6).
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "facebook"],
      },
    },
    plugins: [bearer()],
  });
}

/**
 * The providers this environment can actually sign somebody in with: configured in `makeAuth`
 * above *and* holding credentials. Meta is configured with none until an App ID exists (owner
 * decision 2026-09-20), so it is absent here, `GET /session/start` refuses it with a 400 rather
 * than a 500 from the provider, and A6 renders one button instead of two.
 */
export function configuredProviders(env: Env): string[] {
  const available: string[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    available.push("google");
  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) {
    available.push("facebook");
  }
  return available;
}

/**
 * better-auth's `user.email` is `not null unique`, and a provider can return an account with no
 * address at all — Meta, for a phone-only signup or revoked consent. Such a user gets a synthesized
 * placeholder here while `global_users.email` stays null, so the Registry remains the source of
 * truth for whether this product knows a person's address (spec §4.2, owner decision 2026-09-20).
 *
 * `.invalid` is RFC 2606's reserved TLD: the address can never collide with a real one or be
 * delivered to, and nothing in this product sends email anyway.
 */
function emailFallback(providerId: string) {
  return (profile: { id?: string; sub?: string; email?: string | null }) => {
    if (profile.email) return {};
    const accountId = profile.sub ?? profile.id ?? "unknown";
    return { email: `${providerId}:${accountId}@no-email.invalid` };
  };
}
