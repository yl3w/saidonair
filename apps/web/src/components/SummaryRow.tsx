import type { Episode } from "@media-digest/shared";
import { Check } from "lucide-preact";
import { readStateCopy, runtimeCopy } from "../lib/copy";
import { dayKeyOf } from "../lib/day";
import { rowAnchorId } from "../lib/reading-origin";
import { Icon } from "./Icon";
import { MetaLine } from "./MetaLine";

export type Density = "full" | "compact";

/**
 * One summary as a list shows it (docs/design.md §3): the title, up to three lines of the executive
 * summary — always the executive summary, never a takeaway — and a meta line. A check at the right
 * marks it done without opening it.
 *
 * **The title leads.** A monogram and an uppercase channel name used to come first, which put
 * furniture where the content belongs and pushed the title and its excerpt 46 px right — measure
 * lost from the one thing worth reading, and worst on a phone. The mark is gone from a list
 * entirely (owner decision 2026-09-15): it was a second, weaker copy of a fact the row already
 * states, and triaging by channel is the channel filter's job, not a scan of thirty discs. It
 * survives where it identifies rather than repeats — a Sources row, a channel's header, the
 * reader's own monogram.
 *
 * Compact trades the excerpt, never the title.
 *
 * `onOpen` fires as the title is followed, so the list can record itself as the way back
 * (lib/reading-origin.ts). The row carries its anchor id for the same reason: it is what the return
 * scrolls to.
 *
 * `state` says whether to print "Read" or "Unread". A mixed list owes the word — that is the
 * accessibility floor, which forbids the difference living in colour or a dimmed row — but the queue
 * holds unread summaries only, where the word is a constant rather than information
 * (owner decision 2026-09-15, docs/PRD.md §9). It is never printed for a caller the API gave no
 * receipt state to: not following an approved channel is not the same as not having read something.
 *
 * `list` says what this row sits in, and the row derives what it must name from that. A **mixed**
 * list — the queue, a day of History — has to say which channel, so the channel closes the row on
 * its own line: not in the meta line, where it would wrap on a phone before it finished. A
 * **channel**'s own history does not, and is ordered by publication, so the date opens the row
 * instead. Either way the title is second to nothing.
 */
export function SummaryRow({
  episode,
  density = "full",
  busy = false,
  state = true,
  list,
  onOpen,
  onDone,
  onUndo,
}: {
  episode: Episode;
  density?: Density;
  busy?: boolean;
  state?: boolean;
  list: "mixed" | "channel";
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

  const meta: string[] = [];
  if (state && episode.read !== undefined)
    meta.push(readStateCopy(episode.read));
  if (takeaways > 0) meta.push(`${takeaways} takeaways`);
  if (runtime !== null) meta.push(runtime);
  // Only where the date does not already open the row; there it would say the same thing twice.
  if (publishedElsewhere && list === "mixed") {
    meta.push(`published ${shortDate(episode.publishedAt)}`);
  }

  return (
    <article
      id={rowAnchorId(episode.episodeId)}
      class={`flex gap-3 border-b border-rule ${density === "full" ? "py-[18px]" : "py-[9px]"}`}
    >
      <div class="min-w-0 flex-1">
        {list === "channel" && (
          <p class="text-label uppercase text-ink-3">
            {fullDate(episode.publishedAt)}
          </p>
        )}

        <h3
          class={`font-reading font-semibold text-ink ${
            list === "channel" ? "mt-0.5" : ""
          } ${
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

        <MetaLine class="mt-1" items={meta} />

        {/* The channel closes the row, in the label the date opens a channel's own history with.
            Plain text, not a link: a destination on its own line owes a 44 px target, which a 12 px
            label cannot give without becoming a band (docs/design.md §7). */}
        {list === "mixed" && (
          <p class="mt-1 text-label uppercase text-ink-3">
            {episode.channelTitle}
          </p>
        )}
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
      <div class="min-w-0 flex-1">
        <div class="skeleton h-3 w-32" />
        <div class="skeleton mt-2 h-5 w-3/4" />
        {density === "full" && <div class="skeleton mt-2 h-10 w-full" />}
        <div class="skeleton mt-2 h-3 w-48" />
      </div>
    </div>
  );
}

function shortDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** With its year: a channel's history runs over years, and the year selector may not be showing. */
export function fullDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
