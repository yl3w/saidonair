import type { Episode } from "@media-digest/shared";
import { Check } from "lucide-preact";
import { readStateCopy, runtimeCopy } from "../lib/copy";
import { rowAnchorId } from "../lib/reading-origin";
import { Icon } from "./Icon";
import { MetaLine } from "./MetaLine";

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
 * **One shape, in all three lists.** The queue used to offer a second, denser form of this row that
 * dropped the excerpt to fit more of a heavy day on one screen, and it was the only list that did:
 * History and a channel's page drew the full row whatever their length. One row in three lists and
 * two in the fourth is a difference with nothing behind it, so the compact form is gone (owner
 * decision 2026-09-15, docs/PRD.md §9). What a long list owes is paging, which the queue already
 * does.
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
 * **The episode's own date opens the row**, wherever the row is (owner decision 2026-09-15). The
 * queue's day heading says when a summary landed in front of the reader, which is a fact about the
 * pipeline; when the episode was published is a fact about the episode, and it belongs on the
 * episode. The two agree on most days — a channel's cron runs every six hours, so an episode
 * published today is summarised today — and diverge exactly where a reader notices, after an
 * initial import that carries months of back catalogue into one afternoon.
 *
 * `list` says what this row sits in, and the row derives from that the one thing left: a **mixed**
 * list — the queue, a day of History — has to say which channel, so the channel closes the row on
 * its own line, not in the meta line where it would wrap on a phone before it finished. A
 * **channel**'s own history does not. Either way the title is second only to its date.
 */
export function SummaryRow({
  episode,
  busy = false,
  state = true,
  list,
  onOpen,
  onDone,
  onUndo,
}: {
  episode: Episode;
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
  const runtime = runtimeCopy(episode.processing?.durationSec ?? null);

  // No publication date here: it opens the row, and a row never states its date twice.
  const meta: string[] = [];
  if (state && episode.read !== undefined)
    meta.push(readStateCopy(episode.read));
  if (takeaways > 0) meta.push(`${takeaways} takeaways`);
  if (runtime !== null) meta.push(runtime);

  return (
    <article
      id={rowAnchorId(episode.episodeId)}
      class="flex gap-3 border-b border-rule py-[18px]"
    >
      <div class="min-w-0 flex-1">
        <p class="text-label uppercase text-ink-3">
          {fullDate(episode.publishedAt)}
        </p>

        <h3 class="mt-0.5 font-reading text-row-sm font-semibold text-ink md:text-row">
          <a
            href={`/read/${episode.episodeId}`}
            onClick={() => onOpen?.(episode)}
          >
            {episode.title}
          </a>
        </h3>

        {excerpt !== null && (
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
          class="btn btn-quiet-secondary btn-square self-start"
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
          class="btn btn-ghost btn-primary self-start"
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
export function SummaryRowSkeleton() {
  return (
    <div class="flex gap-3 border-b border-rule py-[18px]">
      <div class="min-w-0 flex-1">
        <div class="skeleton h-3 w-32" />
        <div class="skeleton mt-2 h-5 w-3/4" />
        <div class="skeleton mt-2 h-10 w-full" />
        <div class="skeleton mt-2 h-3 w-48" />
      </div>
    </div>
  );
}

/** With its year: a channel's history runs over years, and the year selector may not be showing. */
export function fullDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
