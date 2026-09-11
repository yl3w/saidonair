import type { Channel, Follow } from "@media-digest/shared";
import { channelStateCopy, reviewCopy } from "../lib/copy";
import { Time } from "./Time";

/**
 * Followed channels (spec §6.4). Every title links to the channel screen, which renders any status.
 * A requested follow reads "Awaiting owner approval"; a declined one shows the owner's note (falling
 * back to the plain status) and offers Request again, confirmed.
 */
export function FollowedList({
  follows,
  busy,
  errors,
  onUnfollow,
  onRequestAgain,
}: {
  follows: Follow[];
  busy: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  onUnfollow: (channelId: string) => void;
  onRequestAgain: (channelId: string) => void;
}) {
  if (follows.length === 0) {
    return <p class="muted">You are not following any channels yet.</p>;
  }
  return (
    <div>
      {follows.map(({ channel, unreadCount }) => {
        const c = channel;
        const approved = c.status === "approved";
        return (
          <div class="row" key={c.channelId}>
            <div class="grow">
              <a
                href={`/channel/${c.channelId}`}
                class={c.status === "declined" ? "unavailable" : undefined}
              >
                {c.title}
              </a>
              <div class="meta">
                {approved && (
                  <>
                    {c.episodes.available} summarised · {unreadCount} unread ·
                    ingested <Time at={c.lastIngestedAt} fallback="never" />
                    {c.paused && " · paused"}
                  </>
                )}
                {c.status === "requested" && "Awaiting owner approval"}
                {c.status === "declined" &&
                  (reviewCopy(c) ?? channelStateCopy(c))}
              </div>
              {errors[c.channelId] && (
                <p class="error">{errors[c.channelId]}</p>
              )}
            </div>
            <div class="actions">
              {c.status === "declined" && (
                <button
                  type="button"
                  disabled={busy.has(c.channelId)}
                  onClick={() => {
                    if (
                      window.confirm(
                        `${reviewCopy(c) ?? "Declined"}. Ask the owner again?`,
                      )
                    ) {
                      onRequestAgain(c.channelId);
                    }
                  }}
                >
                  Request again
                </button>
              )}
              <button
                type="button"
                disabled={busy.has(c.channelId)}
                onClick={() => onUnfollow(c.channelId)}
              >
                Unfollow
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Catalog channels the caller does not follow yet (spec §7). Every row links; requested rows show status. */
export function CatalogList({
  channels,
  busy,
  errors,
  onFollow,
}: {
  channels: Channel[];
  busy: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  onFollow: (channelId: string) => void;
}) {
  if (channels.length === 0) {
    return <p class="muted">The catalog is empty. Add a channel below.</p>;
  }
  return (
    <div>
      {channels.map((channel) => {
        const approved = channel.status === "approved";
        return (
          <div class="row" key={channel.channelId}>
            <div class="grow">
              <a href={`/channel/${channel.channelId}`}>{channel.title}</a>
              <div class="meta">
                {approved
                  ? `${channel.episodes.available} summarised`
                  : `awaiting approval · ${channel.followerCount} following`}
              </div>
              {errors[channel.channelId] && (
                <p class="error">{errors[channel.channelId]}</p>
              )}
            </div>
            <button
              type="button"
              disabled={busy.has(channel.channelId)}
              onClick={() => onFollow(channel.channelId)}
            >
              Follow
            </button>
          </div>
        );
      })}
    </div>
  );
}
