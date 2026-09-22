import type { ChannelsResponse, EpisodesResponse } from "@media-digest/shared";
import { publicChannels } from "../lib/public-view";

/**
 * What a crawler is told: which paths to read, and where everything is
 * (`docs/specs/public-reading.md` §4.6).
 *
 * Both are served by the Worker rather than shipped as files, because both carry the origin they
 * are served from and there are three of those. A `robots.txt` in `public/` would name one of
 * them, and the one it named would be wrong on the other two — a staging robots pointing at
 * production's sitemap is the kind of mistake nobody catches by reading it.
 */
export function robots(origin: string): string {
  return `User-agent: *

# The reader's screens. Nothing here renders without a session, so a crawler would only ever
# index the shell.
Disallow: /queue
Disallow: /history
Disallow: /chats
Disallow: /account
Disallow: /curate
Disallow: /sign-in
Disallow: /auth/
# Exactly /sources — the reader's catalog. A channel beneath it, /sources/UC…, is public, and a
# bare \`Disallow: /sources\` would take those with it.
Disallow: /sources$

Sitemap: ${origin}/sitemap.xml
`;
}

/** The API's own ceiling (`MAX_EPISODE_LIMIT`). Its default is 20, which is not enough. */
const EPISODE_LIMIT = 200;

/**
 * Every page a visitor can reach: the landing page, each public channel, and each episode with a
 * summary to read. A `pending` episode is left out — it is worth showing on a channel page, where
 * it says the archive is alive, and not worth sending a crawler to a page with nothing on it yet.
 *
 * ## What this does not scale to, and in what order it breaks
 *
 * Written down because none of it fails loudly, and the first one was already happening: this
 * asked for a channel's episodes without a `limit`, so it silently listed the newest **20**.
 *
 * | Scale | What happens |
 * |---|---|
 * | **> 200 episodes in one channel** | Silently short. `MAX_EPISODE_LIMIT` is 200 and the public episodes read exposes no cursor, so completeness needs an API change, not a change here. |
 * | **> ~50 channels (free plan) or ~1000 (paid)** | Hard failure: this is `1 + N` subrequests and a Worker is capped. |
 * | **> 50,000 URLs** | Crawlers reject or truncate the file — the sitemap protocol's limit. A `<sitemapindex>` over paged children is the answer. |
 * | **Hundreds of thousands of episodes** | The isolate runs out of memory, and long before that on the JSON: this fetches whole episodes, summaries included, to read their ids. |
 *
 * At the size this product is built for — a personal tool, tens of channels — none of that binds,
 * and the cache absorbs the N+1. The shape that does scale is a sitemap index over paged children
 * fed by a lean `(id, lastmod)` read, or generation on a cron into R2. Neither is worth building
 * for a catalog that fits on one screen.
 */
export async function sitemap(origin: string, api: Fetcher): Promise<string> {
  const get = async <T>(path: string): Promise<T | null> => {
    const response = await api.fetch(
      new Request(`https://api${path}`, {
        headers: { accept: "application/json" },
      }),
    );
    if (!response.ok) return null;
    return (await response.json()) as T;
  };

  const catalog = await get<ChannelsResponse>("/channels");
  const channels = catalog === null ? [] : publicChannels(catalog.channels);

  const entries: { loc: string; lastmod: number | null }[] = [
    { loc: origin, lastmod: null },
  ];

  for (const channel of channels) {
    entries.push({
      loc: `${origin}/sources/${channel.channelId}`,
      lastmod: channel.lastIngestedAt,
    });
    const episodes = await get<EpisodesResponse>(
      `/channels/${encodeURIComponent(channel.channelId)}/episodes?limit=${EPISODE_LIMIT}`,
    );
    for (const episode of episodes?.episodes ?? []) {
      if (episode.status !== "available") continue;
      entries.push({
        loc: `${origin}/read/${episode.episodeId}`,
        lastmod: episode.summaryAvailableAt ?? episode.publishedAt,
      });
    }
  }

  const urls = entries
    .map(({ loc, lastmod }) => {
      const when =
        lastmod === null
          ? ""
          : `\n    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>`;
      return `  <url>\n    <loc>${xml(loc)}</loc>${when}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** A channel id is opaque and an origin is ours, but neither is trusted into markup unescaped. */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
