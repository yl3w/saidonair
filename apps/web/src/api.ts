// The only place the web app calls fetch (AGENTS.md → Web UI code). Sets X-User-Email from the identity
// the session has bound (never from storage, so a tab sends exactly the account it displays) and the
// base URL from VITE_API_URL (default: local wrangler dev). One typed function per operation, named
// after the entity it touches; every shape comes from @media-digest/shared.
import type {
  ApproveChannelBody,
  CatalogResponse,
  ChannelResponse,
  ChannelsResponse,
  CreateChannelBody,
  DeclineChannelBody,
  DigestEpisodesResponse,
  DigestRowsResponse,
  EpisodeResponse,
  EpisodeRetryResponse,
  EpisodesResponse,
  FollowersResponse,
  FollowResponse,
  FollowsResponse,
  IngestionRunResponse,
  IngestionRunsResponse,
  MeResponse,
  PreferencesResponse,
  UpdatePreferencesBody,
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
  return (await send(method, path, body)).json as T;
}

/** One call, with the status kept: `addChannel` needs to know whether it created or followed. */
async function send(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
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
  return { status: response.status, json };
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
  /** `created` is true for a 201 (new channel) and false for a 200 (an existing one, now followed). */
  addChannel: async (
    body: CreateChannelBody,
  ): Promise<ChannelResponse & { created: boolean }> => {
    const { status, json } = await send("POST", "/channels", body);
    return { ...(json as ChannelResponse), created: status === 201 };
  },
  getChannel: (channelId: string) =>
    request<ChannelResponse>("GET", `/channels/${enc(channelId)}`),
  requestChannel: (channelId: string) =>
    request<ChannelResponse>("POST", `/channels/${enc(channelId)}/request`),
  approveChannel: (channelId: string, body: ApproveChannelBody) =>
    request<ChannelResponse>(
      "POST",
      `/channels/${enc(channelId)}/approve`,
      body,
    ),
  declineChannel: (channelId: string, body: DeclineChannelBody) =>
    request<ChannelResponse>(
      "POST",
      `/channels/${enc(channelId)}/decline`,
      body,
    ),
  pauseChannel: (channelId: string) =>
    request<ChannelResponse>("POST", `/channels/${enc(channelId)}/pause`),
  resumeChannel: (channelId: string) =>
    request<ChannelResponse>("POST", `/channels/${enc(channelId)}/resume`),
  listEpisodes: (channelId: string, limit?: number) =>
    request<EpisodesResponse>(
      "GET",
      `/channels/${enc(channelId)}/episodes${limit === undefined ? "" : `?limit=${limit}`}`,
    ),
  /** One episode with its summary, related titles and read state: the reading view's deep link. */
  getEpisode: (channelId: string, videoId: string) =>
    request<EpisodeResponse>(
      "GET",
      `/channels/${enc(channelId)}/episodes/${enc(videoId)}`,
    ),
  /** Done. The one write that marks a summary read (docs/PRD.md §4.4); nothing else records one. */
  markRead: (channelId: string, videoId: string) =>
    request<EpisodeResponse>(
      "POST",
      `/channels/${enc(channelId)}/episodes/${enc(videoId)}/read`,
    ),
  /** Undo, offered from History where the row is visible. */
  clearRead: (channelId: string, videoId: string) =>
    request<EpisodeResponse>(
      "DELETE",
      `/channels/${enc(channelId)}/episodes/${enc(videoId)}/read`,
    ),
  /** The episode and its new attempt: `running` when work started, `blocked` when pre-flight refused it. */
  retryEpisode: (channelId: string, videoId: string) =>
    request<EpisodeRetryResponse>(
      "POST",
      `/channels/${enc(channelId)}/episodes/${enc(videoId)}/retry`,
    ),
  skipEpisode: (channelId: string, videoId: string) =>
    request<EpisodeResponse>(
      "POST",
      `/channels/${enc(channelId)}/episodes/${enc(videoId)}/skip`,
    ),
  listIngestionRuns: (channelId: string) =>
    request<IngestionRunsResponse>("GET", `/channels/${enc(channelId)}/runs`),
  /** Start: check the channel's feed now, paused or not; 502 when YouTube does not answer. */
  startRun: (channelId: string) =>
    request<IngestionRunResponse>("POST", `/channels/${enc(channelId)}/runs`),
  listFollowers: (channelId: string) =>
    request<FollowersResponse>("GET", `/channels/${enc(channelId)}/followers`),

  // follows
  listFollows: () => request<FollowsResponse>("GET", "/follows"),
  follow: (channelId: string) =>
    request<FollowResponse>("PUT", `/follows/${enc(channelId)}`),
  unfollow: (channelId: string) =>
    request<FollowResponse>("DELETE", `/follows/${enc(channelId)}`),

  // digest — the one route behind Queue, History and the calendar. The range is the reader's own
  // local days, worked out here: the API takes instants and never a timezone (docs/PRD.md §4.4).
  getDigest: (range: DigestRange = {}) =>
    request<DigestEpisodesResponse>("GET", `/digest${digestQuery(range)}`),
  /** The same range as rows — four fields each — which is how five weeks of calendar cost one read. */
  getDigestRows: (range: DigestRange = {}) =>
    request<DigestRowsResponse>(
      "GET",
      `/digest${digestQuery({ ...range, compact: true })}`,
    ),

  // preferences
  getPreferences: () => request<PreferencesResponse>("GET", "/preferences"),
  putPreferences: (body: UpdatePreferencesBody) =>
    request<PreferencesResponse>("PUT", "/preferences", body),
};

/** `from` is inclusive and `to` exclusive, so consecutive local days never claim the same summary. */
export type DigestRange = {
  fromMs?: number;
  toMs?: number;
  unread?: boolean;
  channelIds?: readonly string[];
  cursor?: string;
  limit?: number;
  compact?: boolean;
};

function digestQuery(range: DigestRange): string {
  const query = new URLSearchParams();
  if (range.fromMs !== undefined)
    query.set("from", new Date(range.fromMs).toISOString());
  if (range.toMs !== undefined)
    query.set("to", new Date(range.toMs).toISOString());
  if (range.unread === true) query.set("unread", "true");
  for (const channelId of range.channelIds ?? [])
    query.append("channelId", channelId);
  if (range.cursor !== undefined) query.set("cursor", range.cursor);
  if (range.limit !== undefined) query.set("limit", String(range.limit));
  if (range.compact === true) query.set("compact", "true");
  const rendered = query.toString();
  return rendered.length === 0 ? "" : `?${rendered}`;
}

export type Api = typeof api;
