// The only place the web app calls fetch (AGENTS.md → Web UI). Sets X-User-Email from the identity
// the session has bound (never from storage, so a tab sends exactly the account it displays) and the
// base URL from VITE_API_URL (default: local wrangler dev). One typed function per operation, named
// after the entity it touches; every shape comes from @media-digest/shared.
import type {
  ApproveChannelRequestBody,
  ApproveChannelRequestResponse,
  CatalogResponse,
  ChannelRequestResponse,
  ChannelRequestsResponse,
  ChannelResponse,
  ChannelsResponse,
  CreateChannelBody,
  CreateChannelRequestBody,
  DigestResponse,
  EpisodesResponse,
  FollowResponse,
  FollowsResponse,
  IngestionRunsResponse,
  MeResponse,
  RejectChannelRequestBody,
} from "@media-digest/shared";

const BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Thrown before any request when no account is bound; the session guard sends the user to `/`. */
export const NO_ACCOUNT = "NO_ACCOUNT";

/**
 * The account every request acts for. Only `SessionProvider` sets it, in the same effect that
 * moves the session state, so what a tab displays and what it sends cannot drift apart. Another
 * tab changing the stored selection does not reach here; storage is read once, at startup.
 */
let identity: string | null = null;

export function bindIdentity(email: string | null): void {
  identity = email;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const email = identity;
  if (email === null) throw new ApiError(0, "no account selected", NO_ACCOUNT);

  const headers: Record<string, string> = { "X-User-Email": email };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const error = isRecord(json) ? json : {};
    throw new ApiError(
      response.status,
      typeof error.error === "string" ? error.error : response.statusText,
      typeof error.code === "string" ? error.code : undefined,
      json,
    );
  }
  return json as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const enc = encodeURIComponent;

export const api = {
  getMe: () => request<MeResponse>("GET", "/me"),

  // catalog
  getCatalog: () => request<CatalogResponse>("GET", "/catalog"),

  // channels
  listChannels: (options: { scope?: "all" } = {}) =>
    request<ChannelsResponse>(
      "GET",
      options.scope === "all" ? "/channels?scope=all" : "/channels",
    ),
  createChannel: (body: CreateChannelBody) =>
    request<ChannelResponse>("POST", "/channels", body),
  getChannel: (channelId: string) =>
    request<ChannelResponse>("GET", `/channels/${enc(channelId)}`),
  deleteChannel: (channelId: string) =>
    request<ChannelResponse>("DELETE", `/channels/${enc(channelId)}`),
  restoreChannel: (channelId: string) =>
    request<ChannelResponse>("POST", `/channels/${enc(channelId)}/restore`),
  retryChannel: (channelId: string) =>
    request<ChannelResponse>("POST", `/channels/${enc(channelId)}/retry`),
  listEpisodes: (channelId: string, limit?: number) =>
    request<EpisodesResponse>(
      "GET",
      `/channels/${enc(channelId)}/episodes${limit === undefined ? "" : `?limit=${limit}`}`,
    ),
  listIngestionRuns: (channelId: string) =>
    request<IngestionRunsResponse>(
      "GET",
      `/channels/${enc(channelId)}/ingestion-runs`,
    ),
  listChannelRequestsFor: (channelId: string) =>
    request<ChannelRequestsResponse>(
      "GET",
      `/channels/${enc(channelId)}/requests`,
    ),

  // channel requests
  listChannelRequests: (options: { scope?: "all" } = {}) =>
    request<ChannelRequestsResponse>(
      "GET",
      options.scope === "all"
        ? "/channel-requests?scope=all"
        : "/channel-requests",
    ),
  createChannelRequest: (body: CreateChannelRequestBody) =>
    request<ChannelRequestResponse>("POST", "/channel-requests", body),
  approveChannelRequest: (requestId: string, body: ApproveChannelRequestBody) =>
    request<ApproveChannelRequestResponse>(
      "POST",
      `/channel-requests/${enc(requestId)}/approve`,
      body,
    ),
  rejectChannelRequest: (requestId: string, body: RejectChannelRequestBody) =>
    request<ChannelRequestResponse>(
      "POST",
      `/channel-requests/${enc(requestId)}/reject`,
      body,
    ),

  // follows
  listFollows: () => request<FollowsResponse>("GET", "/follows"),
  follow: (channelId: string) =>
    request<FollowResponse>("PUT", `/follows/${enc(channelId)}`),
  unfollow: (channelId: string) =>
    request<FollowResponse>("DELETE", `/follows/${enc(channelId)}`),

  // digest
  getDigest: (sinceMs?: number) =>
    request<DigestResponse>(
      "GET",
      sinceMs === undefined
        ? "/digest"
        : `/digest?since=${enc(new Date(sinceMs).toISOString())}`,
    ),
};

export type Api = typeof api;
