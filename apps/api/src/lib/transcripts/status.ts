import type { TranscriptProviderHealth } from "@media-digest/shared";

/**
 * The transcript provider's health, from DownSub's status endpoint: remaining credits and whether
 * the key is accepted (docs/specs/api-reference.md §5.8, m3-ingestion.md §2). `GET /catalog` shows it
 * on the health strip; M3's episode pre-flight reads the same wrapper. The call sends nothing but the
 * key, costs no credits, and is cached per isolate so Home never waits on a third party twice in five
 * minutes. It can only ever answer, never throw: a failure of any kind is `unreachable`.
 */

export const DOWNSUB_STATUS_URL = "https://api.downsub.com/status";
export const STATUS_TIMEOUT_MS = 2_000;
export const STATUS_CACHE_MS = 5 * 60_000;

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderHealthDeps = {
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

const UNREACHABLE: TranscriptProviderHealth = {
  remainingCredits: null,
  status: "unreachable",
};

/**
 * Builds a reader with its own cache. The module's default instance serves the Worker; tests build
 * their own with an injected `fetch`, `now`, and timeout, the `feedFetcher` pattern.
 */
export function providerHealthReader(deps: ProviderHealthDeps = {}) {
  const fetchImpl: FetchLike =
    deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? STATUS_TIMEOUT_MS;
  let cached: { at: number; health: TranscriptProviderHealth } | null = null;

  return async function transcriptProviderHealth(env: {
    DOWNSUB_API_KEY?: string;
  }): Promise<TranscriptProviderHealth> {
    const key = env.DOWNSUB_API_KEY?.trim();
    // No key configured (tests, a fresh checkout): nothing to ask, and nothing to cache.
    if (!key) return UNREACHABLE;
    if (cached && now() - cached.at < STATUS_CACHE_MS) return cached.health;
    const health = await probe(fetchImpl, key, timeoutMs);
    cached = { at: now(), health };
    return health;
  };
}

/** The Worker's reader: one cache per isolate. */
export const transcriptProviderHealth = providerHealthReader();

async function probe(
  fetchImpl: FetchLike,
  key: string,
  timeoutMs: number,
): Promise<TranscriptProviderHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(DOWNSUB_STATUS_URL, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) {
      return { remainingCredits: null, status: "auth_failed" };
    }
    if (!response.ok) return UNREACHABLE;
    const credits = remainingCreditsOf(await response.json());
    return credits === null
      ? UNREACHABLE
      : { remainingCredits: credits, status: "ok" };
  } catch {
    // Network failure, timeout, or a body that is not JSON: all read as the provider being away.
    return UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hand-validated, by name. Confirmed against the live endpoint on 2026-09-12: the body is
 * `{ status, data: { remainingCredits, monthlyCredits, bonusCredits, expiresAt, plan } }` (the
 * 2026-09-08 probe notes had dropped the `data` envelope). Anything else is not a number we would
 * want to show or gate on, so it reads as `unreachable` rather than a guess.
 */
function remainingCreditsOf(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>).remainingCredits;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
