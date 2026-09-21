// The only place the web app calls fetch (AGENTS.md → Web UI code). Sends the session token the
// provider has bound (never from storage, so a tab sends exactly the account it displays) and takes
// the base URL from VITE_API_URL (default: local wrangler dev). One typed function per operation, named
// after the entity it touches; every shape comes from @media-digest/shared.
import type {
  ApproveChannelBody,
  CatalogResponse,
  ChannelFeedResponse,
  ChannelResponse,
  ChannelsResponse,
  ChatExchangeResponse,
  ChatMessagesResponse,
  ChatResponse,
  ChatsResponse,
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
  SendMessageBody,
  UpdatePreferencesBody,
} from "@media-digest/shared";

/**
 * Where the API answers. `localhost`, not `127.0.0.1`: the sign-in flow sets a cookie on this
 * origin and the provider's redirect returns to it, so it must be spelled the same way the Worker's
 * own `API_BASE_URL` is or the callback arrives at a different origin and fails `state_mismatch`.
 */
export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8787"
).replace(/\/$/, "");
const BASE_URL = API_BASE_URL;

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

/** Thrown before a request that needs a session when none is bound; the guard sends them to `/sign-in`. */
export const NO_ACCOUNT = "NO_ACCOUNT";

/**
 * The five reads that answer a caller with no session at all (`docs/specs/route-visibility.md` §1,
 * public since 2026-09-21): the channel list, a channel, a channel's episodes, an episode through
 * its channel, and an episode by its own id. They are richer with a session and correct without
 * one, so they are the only calls allowed past the guard below.
 *
 * Marked call by call rather than inferred from the path: the set is closed, it is the same five
 * the API's own `openapi.test.ts` pins, and a sixth joining it should be a deliberate edit here.
 */
const PUBLIC = { anonymous: true } as const;
type SendOptions = { anonymous?: boolean };

/**
 * The session every request acts for. Only `SessionProvider` sets it, in the same effect that moves
 * the session state, so what a tab displays and what it sends cannot drift apart. Another tab
 * signing in or out does not reach here; storage is read once, at startup.
 *
 * The token is the whole credential: `X-User-Email` was deleted in A7, and with it the last way to
 * act as somebody by saying so.
 */
let session: { token: string; email: string | null } | null = null;

export function bindSession(
  next: { token: string; email: string | null } | null,
): void {
  session = next;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: SendOptions,
): Promise<T> {
  return (await send(method, path, body, options)).json as T;
}

/** One call, with the status kept: `addChannel` needs to know whether it created or followed. */
async function send(
  method: string,
  path: string,
  body?: unknown,
  options?: SendOptions,
): Promise<{ status: number; json: unknown }> {
  // Refusing every call without a session was right while every route needed one. Since the public
  // reads landed it is wrong for exactly five of them, and a visitor browsing the catalog met
  // "not signed in" from their own browser while the API was answering 200 to `curl`.
  if (session === null && options?.anonymous !== true) {
    throw new ApiError(0, "not signed in", NO_ACCOUNT);
  }

  // No session, no header — which is what makes the API answer the anonymous shape.
  const headers: Record<string, string> =
    session === null ? {} : { Authorization: `Bearer ${session.token}` };
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
      undefined,
      PUBLIC,
    ),
  /**
   * Step two of adding a channel: what YouTube's feeds say about an id, and what the catalog already
   * holds for it. Creates nothing — the decision is step three.
   */
  readChannelFeed: (channelId: string) =>
    request<ChannelFeedResponse>(
      "GET",
      `/channels/feed?channelId=${enc(channelId)}`,
    ),
  /** `created` is true for a 201 (new channel) and false for a 200 (an existing one, now followed). */
  addChannel: async (
    body: CreateChannelBody,
  ): Promise<ChannelResponse & { created: boolean }> => {
    const { status, json } = await send("POST", "/channels", body);
    return { ...(json as ChannelResponse), created: status === 201 };
  },
  getChannel: (channelId: string) =>
    request<ChannelResponse>(
      "GET",
      `/channels/${enc(channelId)}`,
      undefined,
      PUBLIC,
    ),
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
      undefined,
      PUBLIC,
    ),
  /**
   * One episode by its own id: what the reading view has on a cold load, since `/read/:episodeId`
   * names the episode and not its channel.
   */
  getEpisodeById: (episodeId: string) =>
    request<EpisodeResponse>(
      "GET",
      `/episodes/${enc(episodeId)}`,
      undefined,
      PUBLIC,
    ),
  /** The same episode through its channel, where a mismatch is a 404. */
  getEpisode: (channelId: string, episodeId: string) =>
    request<EpisodeResponse>(
      "GET",
      `/channels/${enc(channelId)}/episodes/${enc(episodeId)}`,
      undefined,
      PUBLIC,
    ),
  /** Done. The one write that marks a summary read (docs/PRD.md §4.4); nothing else records one. */
  markRead: (channelId: string, episodeId: string) =>
    request<EpisodeResponse>(
      "POST",
      `/channels/${enc(channelId)}/episodes/${enc(episodeId)}/read`,
    ),
  /** Undo, offered from History where the row is visible. */
  clearRead: (channelId: string, episodeId: string) =>
    request<EpisodeResponse>(
      "DELETE",
      `/channels/${enc(channelId)}/episodes/${enc(episodeId)}/read`,
    ),
  /** The episode and its new attempt: `running` when work started, `blocked` when pre-flight refused it. */
  retryEpisode: (channelId: string, episodeId: string) =>
    request<EpisodeRetryResponse>(
      "POST",
      `/channels/${enc(channelId)}/episodes/${enc(episodeId)}/retry`,
    ),
  skipEpisode: (channelId: string, episodeId: string) =>
    request<EpisodeResponse>(
      "POST",
      `/channels/${enc(channelId)}/episodes/${enc(episodeId)}/skip`,
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

  // chats (docs/PRD.md §4.5). A chat begins at a summary and nowhere else, which is the web's rule
  // and not the API's: `createChat` is open and this client simply never calls it from anywhere but
  // the composer `Ask` opens (docs/specs/chat-origin-scope.md §4.1).
  listChats: () => request<ChatsResponse>("GET", "/chats"),
  createChat: (title?: string) =>
    request<ChatResponse>(
      "POST",
      "/chats",
      title === undefined ? {} : { title },
    ),
  getChatMessages: (chatId: string, limit?: number) =>
    request<ChatMessagesResponse>(
      "GET",
      `/chats/${enc(chatId)}/messages${limit === undefined ? "" : `?limit=${limit}`}`,
    ),
  /**
   * Ask a question. The reply is complete in the response — answering runs inside the request, so
   * there is nothing to poll. `aboutEpisodeId` scopes the question to one episode and narrows only:
   * an episode whose channel the caller does not follow is refused in words, never widened.
   */
  sendMessage: (chatId: string, body: SendMessageBody) =>
    request<ChatExchangeResponse>(
      "POST",
      `/chats/${enc(chatId)}/messages`,
      body,
    ),

  // preferences — the chat rules field returns with the chat screens (PRD §9)
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
