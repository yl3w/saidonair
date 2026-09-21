import type { Channel } from "@media-digest/shared";
import type { ComponentChildren } from "preact";
import {
  channelStateCopy,
  followerCountCopy,
  lastSummaryCopy,
  summaryCountCopy,
  unreadCountCopy,
} from "../lib/copy";
import { Avatar } from "./Avatar";

/**
 * One channel in a list — the landing page's, the catalog's, and whatever lists channels next.
 * It was two components for a day and they had already drifted: the same relative time read
 * "newest 21h ago" on one screen and "last summary 21h ago" on the other.
 *
 * **The meta line says what varies on the screen you are on.** A reader's list mixes statuses, so
 * it leads with the status and adds what is theirs — unread, and the follow. A visitor's list is
 * approved channels only, so "Approved" on every row would say nothing; theirs leads with how much
 * there is to read, and ends with how many other people read it.
 *
 * A channel that has published nothing is listed on both (docs/specs/public-reading.md §3,
 * decision 3) and reads quieter, so the eye catches the difference before the words do.
 */
export function ChannelRow({
  channel,
  signedIn,
  unreadCount = 0,
  note = null,
  action = null,
}: {
  channel: Channel;
  signedIn: boolean;
  unreadCount?: number;
  /** The owner's review note — never passed for a visitor (spec §3, decision 5). */
  note?: string | null;
  /** Follow, Request again, or nothing at all: a visitor gets no control (docs/design.md §9b). */
  action?: ComponentChildren;
}) {
  const published = channel.episodes.available > 0;
  return (
    <article class="flex flex-wrap items-center gap-3 border-b border-rule py-[18px]">
      <Avatar id={channel.channelId} name={channel.title} size={34} />
      <div class="min-w-0 flex-1">
        <h3
          class={`font-reading text-row-compact font-semibold ${
            published ? "text-ink" : "text-ink-3"
          }`}
        >
          <a href={`/sources/${channel.channelId}`}>{channel.title}</a>
        </h3>
        <p class="mt-0.5 flex flex-wrap gap-x-2 text-meta text-ink-3">
          <span>
            {signedIn
              ? channelStateCopy(channel)
              : summaryCountCopy(channel.episodes)}
          </span>
          {signedIn && channel.following && unreadCount > 0 && (
            <span>· {unreadCountCopy(unreadCount)}</span>
          )}
          {channel.lastIngestedAt !== null && (
            <span>· {lastSummaryCopy(channel.lastIngestedAt)}</span>
          )}
          {!signedIn && channel.followerCount > 0 && (
            <span>· {followerCountCopy(channel.followerCount)}</span>
          )}
        </p>
        {note !== null && (
          <p class="mt-1 font-reading text-excerpt text-ink-2">{note}</p>
        )}
      </div>
      {action}
    </article>
  );
}
