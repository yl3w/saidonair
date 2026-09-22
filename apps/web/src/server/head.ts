import type { EpisodeSummary } from "@media-digest/shared";
import type { Bootstrapped } from "./load";

/**
 * What a crawler and a link unfurl read (`docs/specs/public-reading.md` §4.4). This is most of the
 * reason the public routes are rendered on the edge at all: a shared summary that unfurls as a
 * generic grey line is not shareable, and neither Slack nor a search engine runs the bundle.
 */
export type Head = {
  title: string;
  description: string;
  canonical: string;
  type: "website" | "article";
};

const NAME = "Said on Air";

export const DEFAULT_HEAD: Head = {
  title: NAME,
  description:
    "What was said on the air, in text, with the minute it was said.",
  canonical: "/",
  type: "website",
};

export function headFor(data: Bootstrapped, origin: string): Head {
  switch (data.route) {
    case "landing":
      return { ...DEFAULT_HEAD, canonical: origin };

    case "channel": {
      const { channel } = data;
      const n = channel.episodes.available;
      return {
        title: `${channel.title} · ${NAME}`,
        description:
          n === 0
            ? `Summaries of ${channel.title}, as its episodes are published.`
            : `${n} ${n === 1 ? "episode" : "episodes"} of ${channel.title}, summarised with the minute each thing was said.`,
        canonical: `${origin}/sources/${channel.channelId}`,
        type: "website",
      };
    }

    case "episode": {
      const { episode } = data;
      return {
        title: `${episode.title} · ${episode.channelTitle}`,
        description: summarise(episode.summary, episode.channelTitle),
        canonical: `${origin}/read/${episode.episodeId}`,
        type: "article",
      };
    }
  }
}

/** The summary's own opening, cut at a word, or an honest line when there is none yet. */
function summarise(
  summary: EpisodeSummary | null,
  channelTitle: string,
): string {
  if (summary === null)
    return `An episode of ${channelTitle}, being summarised.`;
  const text =
    summary.format === "structured"
      ? summary.executiveSummary
      : summary.rawText;
  return truncate(text.replace(/\s+/g, " ").trim(), 200);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Both escapes matter and they are different escapes. Attribute values take the four entities
 * below; the boot script's JSON takes `<`, because a summary containing `</script>` would
 * otherwise close that tag and put episode text into the document as markup.
 */
export function headTags(head: Head): string {
  const e = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return [
    `<title>${e(head.title)}</title>`,
    `<meta name="description" content="${e(head.description)}" />`,
    `<meta property="og:type" content="${head.type}" />`,
    `<meta property="og:title" content="${e(head.title)}" />`,
    `<meta property="og:description" content="${e(head.description)}" />`,
    `<meta property="og:url" content="${e(head.canonical)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<link rel="canonical" href="${e(head.canonical)}" />`,
  ].join("\n    ");
}
