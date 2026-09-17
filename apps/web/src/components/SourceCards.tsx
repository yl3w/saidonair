import type { ChatSource } from "@media-digest/shared";
import { momentCopy } from "../lib/copy";

/**
 * A reply's citations (docs/specs/m4-3-chat-web.md §3.3). The API stores **one source per retrieved
 * chunk, in score order**, because which chunk matched best is real information; grouping them is
 * the reader's view and lives here.
 *
 * **Group by episode, ascend within a group.** A scoped question's chunks are all one episode by
 * construction, so without grouping a reply would show the same title eight times; and a reader
 * scanning one episode's moments wants them in the order they were said, not the order they
 * matched. Card order stays first-appearance, which is score order — the strongest match first
 * (docs/PRD.md §9, 2026-09-16).
 */
export function SourceCards({ sources }: { sources: readonly ChatSource[] }) {
  const cards = groupByEpisode(sources);
  if (cards.length === 0) return null;

  return (
    <div class="mt-4 flex flex-col gap-2.5">
      {cards.map((card) => (
        <div
          key={card.episodeId}
          class="rounded-box border border-edge bg-panel px-4 py-3.5"
        >
          <span class="block font-serif text-row-compact font-semibold leading-tight text-ink">
            {card.episodeTitle}
          </span>
          <span class="mt-0.5 block text-meta text-ink-3">
            {card.channelTitle}
          </span>
          <div class="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-2">
            {card.startSecs.map((startSec) => (
              <a
                key={startSec}
                // inline-flex, not inline: min-height does nothing to a non-replaced
                // inline element, so a bare `min-h-11` on an anchor is not a 44 px target.
                class="inline-flex min-h-11 items-center text-ui text-primary md:min-h-0"
                href={`https://youtu.be/${card.episodeId}?t=${Math.floor(startSec)}`}
              >
                {momentCopy(startSec)}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type Card = {
  episodeId: string;
  episodeTitle: string;
  channelTitle: string;
  startSecs: number[];
};

function groupByEpisode(sources: readonly ChatSource[]): Card[] {
  const byEpisode = new Map<string, Card>();
  for (const source of sources) {
    const card = byEpisode.get(source.episodeId);
    if (card === undefined) {
      byEpisode.set(source.episodeId, {
        episodeId: source.episodeId,
        episodeTitle: source.episodeTitle,
        channelTitle: source.channelTitle,
        startSecs: [source.startSec],
      });
      continue;
    }
    card.startSecs.push(source.startSec);
  }
  const cards = [...byEpisode.values()];
  for (const card of cards) card.startSecs.sort((a, b) => a - b);
  return cards;
}
