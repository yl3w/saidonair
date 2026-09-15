import type { Episode } from "@media-digest/shared";
import { Check } from "lucide-preact";
import { readStateCopy, runtimeCopy } from "../lib/copy";
import { dayKeyOf } from "../lib/day";
import { rowAnchorId } from "../lib/reading-origin";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { MetaLine } from "./MetaLine";

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
 *
 * `state` says whether to print "Read" or "Unread". A mixed list owes the word — that is the
 * accessibility floor, which forbids the difference living in colour or a dimmed row — but the queue
 * holds unread summaries only, where the word is a constant rather than information
 * (owner decision 2026-09-15, docs/PRD.md §9). It is never printed for a caller the API gave no
 * receipt state to: not following an approved channel is not the same as not having read something.
 *
 * `lead` says what identifies a row in this list. A queue or a day of History mixes channels, so a
 * row is identified by its source: the mark, the name, and when it arrived. A channel's own history
 * does not — the mark and the name would repeat down the page — so there a row is identified by the
 * date it was published, which is also the order the list is in (owner decision 2026-09-15).
 */
export function SummaryRow({
  episode,
  density = "full",
  busy = false,
  state = true,
  lead = "channel",
  onOpen,
  onDone,
  onUndo,
}: {
  episode: Episode;
  density?: Density;
  busy?: boolean;
  state?: boolean;
  lead?: "channel" | "published";
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
  // Only where the date is not already the lead; there it would say the same thing twice.
  if (publishedElsewhere && lead === "channel") {
    meta.push(`published ${shortDate(episode.publishedAt)}`);
  }

  return (
    <article
      id={rowAnchorId(episode.episodeId)}
      class={`flex gap-3 border-b border-rule ${density === "full" ? "py-[18px]" : "py-[9px]"}`}
    >
      {lead === "channel" && (
        <Avatar
          id={episode.channelId}
          name={episode.channelTitle}
          size={density === "full" ? 34 : 20}
        />
      )}

      <div class="min-w-0 flex-1">
        <p class="text-label uppercase text-ink-3">
          {lead === "channel" ? (
            <>
              {episode.channelTitle}
              {arrivedAt !== null && ` · ${timeOfDay(arrivedAt)}`}
            </>
          ) : (
            fullDate(episode.publishedAt)
          )}
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

        <MetaLine class="mt-1" items={meta} />
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
  lead = "channel",
}: {
  density?: Density;
  lead?: "channel" | "published";
}) {
  return (
    <div
      class={`flex gap-3 border-b border-rule ${density === "full" ? "py-[18px]" : "py-[9px]"}`}
    >
      {lead === "channel" && (
        <div class="skeleton size-[34px] shrink-0 rounded-full" />
      )}
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

/** With its year: a channel's history runs over years, and the year selector may not be showing. */
export function fullDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
