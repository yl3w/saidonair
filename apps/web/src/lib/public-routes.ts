/**
 * Which URLs a signed-out visitor may reach (`docs/specs/public-reading.md` §4.1).
 *
 * **Three, not four.** `/sources` was among them for a few hours and came out again (owner
 * decision 2026-09-21): signed out it showed the same rows as the landing page, which lists every
 * channel uncapped, and the sort and the paging that were its whole difference are what somebody
 * *working through* a catalog needs rather than somebody arriving at one. A visitor's catalog is
 * `/`; `/sources` is the reader's screen and stays behind the guard. The API route is unaffected
 * and still public — this is the web's gate, not the API's.
 *
 * **Imported by both the Worker and the client**, which is the point: the Worker asks "do I render
 * this on the server", the client asks "does this screen need a session", and one answer serves
 * both. Two copies of this list would drift, and the drift would be invisible until a crawler saw
 * a page a reader could not, or the reverse.
 *
 * Ids are matched loosely. This decides *which screen*, never *whether the thing exists*: a
 * malformed id reaches the API and comes back a 404, which is where a 404 belongs
 * (`docs/specs/public-reading-plan.md`, plan decision 2).
 */
export type PublicRoute =
  | { name: "landing" }
  | { name: "channel"; channelId: string }
  | { name: "episode"; episodeId: string };

const CHANNEL = /^\/sources\/([\w-]+)$/;
const EPISODE = /^\/read\/([\w-]+)$/;

export function matchPublicRoute(pathname: string): PublicRoute | null {
  if (pathname === "/") return { name: "landing" };

  const channel = CHANNEL.exec(pathname);
  if (channel?.[1] !== undefined) {
    return { name: "channel", channelId: channel[1] };
  }

  const episode = EPISODE.exec(pathname);
  if (episode?.[1] !== undefined) {
    return { name: "episode", episodeId: episode[1] };
  }

  return null;
}
