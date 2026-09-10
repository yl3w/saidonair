import type { Channel, Follow } from "@media-digest/shared";
import { CHANNEL_STATUS_COPY } from "../lib/copy";
import { Time } from "./Time";

/** Followed channels (spec §6.4). A follow whose channel is not approved stays listed, muted, unlinked. */
export function FollowedList({
  follows,
  busy,
  onUnfollow,
}: {
  follows: Follow[];
  busy: ReadonlySet<string>;
  onUnfollow: (channelId: string) => void;
}) {
  if (follows.length === 0) {
    return <p class="muted">You are not following any channels yet.</p>;
  }
  return (
    <div>
      {follows.map(({ channel, unreadCount }) => (
        <div class="row" key={channel.channelId}>
          <div class="grow">
            {channel.status === "approved" ? (
              <a href={`/channel/${channel.channelId}`}>{channel.title}</a>
            ) : (
              <span class="unavailable">{channel.title}</span>
            )}
            <div class="meta">
              {channel.status === "approved" ? (
                <>
                  {channel.episodes.available} available · {unreadCount} unread
                  · ingested{" "}
                  <Time at={channel.lastIngestedAt} fallback="never" />
                </>
              ) : (
                CHANNEL_STATUS_COPY[channel.status]
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={busy.has(channel.channelId)}
            onClick={() => onUnfollow(channel.channelId)}
          >
            Unfollow
          </button>
        </div>
      ))}
    </div>
  );
}

/** Available channels the caller does not follow yet. */
export function AvailableList({
  channels,
  busy,
  onFollow,
  isOwner,
}: {
  channels: Channel[];
  busy: ReadonlySet<string>;
  onFollow: (channelId: string) => void;
  isOwner: boolean;
}) {
  if (channels.length === 0) {
    return (
      <p class="muted">
        {isOwner
          ? "The catalog is empty. Add a channel from the Owner page."
          : "The catalog is empty. Request a channel below."}
      </p>
    );
  }
  return (
    <div>
      {channels.map((channel) => (
        <div class="row" key={channel.channelId}>
          <div class="grow">
            <a href={`/channel/${channel.channelId}`}>{channel.title}</a>
            <div class="meta">{channel.episodes.available} available</div>
          </div>
          <button
            type="button"
            disabled={busy.has(channel.channelId)}
            onClick={() => onFollow(channel.channelId)}
          >
            Follow
          </button>
        </div>
      ))}
    </div>
  );
}
