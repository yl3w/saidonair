import type {
  Channel,
  ChannelResponse,
  ChannelsResponse,
  Episode,
  EpisodeResponse,
  EpisodesResponse,
} from "@media-digest/shared";
import type { PublicRoute } from "../lib/public-routes";
import { publicChannels, publicEpisodes } from "../lib/public-view";

/**
 * What the server needs before it can render a public route, and the only other place in the web
 * that calls `fetch` (`src/api.ts` is the browser's). It is a second call site on purpose, not by
 * oversight: `api.ts` sends the session this tab holds, and there is no tab and no session here.
 *
 * **No `Authorization` header, ever.** Two reasons, and both matter: the anonymous shape is what a
 * visitor must get (`docs/specs/route-visibility.md` §4.3), and a render that cannot vary by caller
 * is a render the edge may cache for everyone.
 */
/**
 * The discriminant is flat, not `route: { name }`: TypeScript narrows a union on a direct property
 * only, and a nested one leaves every member's fields unreachable.
 */
export type Bootstrapped =
  | { route: "landing"; channels: Channel[] }
  | { route: "channel"; channel: Channel; episodes: Episode[] }
  | { route: "episode"; episode: Episode };

export type Loaded =
  | { kind: "ok"; data: Bootstrapped }
  | { kind: "missing" }
  | { kind: "unavailable" };

export async function load(route: PublicRoute, api: Fetcher): Promise<Loaded> {
  /** The host is never resolved: a service binding is an in-process call to the API Worker. */
  const get = async <T>(path: string): Promise<T | null> => {
    const response = await api.fetch(
      new Request(`https://api${path}`, {
        headers: { accept: "application/json" },
      }),
    );
    // 404 and 400 are both "this URL names nothing": the API answers 400 for an id of the wrong
    // shape — `/read/nosuchepisode` is eleven characters short of a YouTube id — and a reader who
    // followed a mangled link wants a 404 page, not a page saying the service is unavailable.
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) throw new Error(`API ${response.status} on ${path}`);
    return (await response.json()) as T;
  };

  try {
    switch (route.name) {
      case "landing": {
        const body = await get<ChannelsResponse>("/channels");
        if (body === null) return { kind: "missing" };
        return {
          kind: "ok",
          data: {
            route: "landing",
            channels: publicChannels(body.channels),
          },
        };
      }

      case "channel": {
        const id = encodeURIComponent(route.channelId);
        const [channel, episodes] = await Promise.all([
          get<ChannelResponse>(`/channels/${id}`),
          get<EpisodesResponse>(`/channels/${id}/episodes`),
        ]);
        if (channel === null || episodes === null) return { kind: "missing" };
        // A requested or declined channel renders, minus the owner's note
        // (docs/specs/public-reading.md §3, decision 5). An earlier draft of the spec answered
        // 404 here and was reversed the same day; the screen decides what to show, not this.
        return {
          kind: "ok",
          data: {
            route: "channel",
            channel: channel.channel,
            episodes: publicEpisodes(episodes.episodes),
          },
        };
      }

      case "episode": {
        const body = await get<EpisodeResponse>(
          `/episodes/${encodeURIComponent(route.episodeId)}`,
        );
        if (body === null) return { kind: "missing" };
        return {
          kind: "ok",
          data: { route: "episode", episode: body.episode },
        };
      }
    }
    // Unreachable: every member of `PublicRoute` returns above, and the compiler is told so
    // rather than trusted to notice.
    return { kind: "missing" };
  } catch {
    // Unreachable, 5xx, or malformed. The page still renders — as the shell, uncached, for the
    // client to retry (src/server/worker.tsx) — because a failure the browser can survive should
    // not become a dead page.
    return { kind: "unavailable" };
  }
}
