import type { Episode } from "@media-digest/shared";
import { Check } from "lucide-preact";
import { readStateCopy, runtimeCopy } from "../lib/copy";
import { dayKeyOf } from "../lib/day";
import { rowAnchorId } from "../lib/reading-origin";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

export type Density = "full" | "compact";

/**
 * One summary as a list shows it (docs/design.md §3): the channel's mark, the channel and when the
 * summary became readable, the title, up to three lines of the executive summary — always the
 * executive summary, never a takeaway — and a meta line. A check at the right marks it done without
 * opening it.
 *
 * Compact trades the excerpt, never the title.
 *
 * `onOpen` fires as the title is followed, so the list can record itself as the way back
 * (lib/reading-origin.ts). The row carries its anchor id for the same reason: it is what the return
 * scrolls to.
 */
export function SummaryRow({
  episode,
  density = "full",
  busy = false,
  onOpen,
  onDone,
  onUndo,
}: {
  episode: Episode;
  density?: Density;
  busy?: boolean;
  onOpen?: (episode: Episode) => void;
  onDone?: (episode: Episode) => void;
  onUndo?: (episode: Episode) => void;
}) {
  const summary = episode.summary;
  const excerpt =
    summary?.format === "structured"
      ? summary.executiveSummary
      : (summary?.rawText ?? null);
  const takeaways =
    summary?.format === "structured" ? summary.takeaways.length : 0;
  const runtime = runtimeCopy(episode.processing.durationSec);
  const arrivedAt = episode.summaryAvailableAt;
  const publishedElsewhere =
    arrivedAt !== null && dayKeyOf(episode.publishedAt) !== dayKeyOf(arrivedAt);

  return (
    <article
      id={rowAnchorId(episode.episodeId)}
      class={`flex gap-3 border-b border-rule ${density === "full" ? "py-[18px]" : "py-[9px]"}`}
    >
      <Avatar
        id={episode.channelId}
        name={episode.channelTitle}
        size={density === "full" ? 34 : 20}
      />

      <div class="min-w-0 flex-1">
        <p class="text-label uppercase text-ink-3">
          {episode.channelTitle}
          {arrivedAt !== null && ` · ${timeOfDay(arrivedAt)}`}
        </p>

        <h3
          class={`mt-0.5 font-reading font-semibold text-ink ${
            density === "full"
              ? "text-row-sm md:text-row"
              : "truncate text-row-compact"
          }`}
        >
          <a
            href={`/read/${episode.episodeId}`}
            onClick={() => onOpen?.(episode)}
          >
            {episode.title}
          </a>
        </h3>

        {density === "full" && excerpt !== null && (
          <p class="mt-1 line-clamp-3 font-reading text-excerpt text-ink-2">
            {excerpt}
          </p>
        )}

        <p class="mt-1 flex flex-wrap gap-x-2 text-meta text-ink-3">
          <span>{readStateCopy(episode.read === true)}</span>
          {takeaways > 0 && <span>· {takeaways} takeaways</span>}
          {runtime !== null && <span>· {runtime}</span>}
          {publishedElsewhere && (
            <span>· published {shortDate(episode.publishedAt)}</span>
          )}
        </p>
      </div>

      {onDone !== undefined && (
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center self-start rounded border border-edge text-ink-2 disabled:opacity-100"
          disabled={busy}
          aria-label={`Mark "${episode.title}" done`}
          onClick={() => onDone(episode)}
        >
          <Icon of={Check} size={20} />
        </button>
      )}

      {onUndo !== undefined && (
        <button
          type="button"
          class="min-h-11 shrink-0 self-start px-2 text-ui text-primary"
          disabled={busy}
          onClick={() => onUndo(episode)}
        >
          Undo
        </button>
      )}
    </article>
  );
}

/** Rows of the real row's shape, so a loading queue does not jump when it arrives. */
export function SummaryRowSkeleton({
  density = "full",
}: {
  density?: Density;
}) {
  return (
    <div
      class={`flex gap-3 border-b border-rule ${density === "full" ? "py-[18px]" : "py-[9px]"}`}
    >
      <div class="skeleton size-[34px] shrink-0 rounded-full" />
      <div class="min-w-0 flex-1">
        <div class="skeleton h-3 w-32" />
        <div class="skeleton mt-2 h-5 w-3/4" />
        {density === "full" && <div class="skeleton mt-2 h-10 w-full" />}
        <div class="skeleton mt-2 h-3 w-48" />
      </div>
    </div>
  );
}

function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
