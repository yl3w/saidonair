import type { Channel } from "@media-digest/shared";
import { api } from "../api";

/** One channel action; the caller reloads whatever it shows once the work settles. */
export type ChannelAct = (work: () => Promise<unknown>) => Promise<void>;

/** The one withdraw confirmation, so the catalog table and the channel screen ask the same thing. */
function withdrawQuestion(channel: Channel): string {
  const count = channel.followerCount;
  return `Withdraw ${channel.title}? ${count} follower${count === 1 ? "" : "s"} will lose access to its summaries until it is approved again.`;
}

/**
 * Approve, decline, pause, resume, or start a channel, by status (spec §7; PRD §7). Start checks an
 * approved channel's feed now, paused or not. The owner's catalog table and channel screen both
 * render this; `idPrefix` is prepended to every button id so the two can be on screen at once
 * without colliding.
 */
export function ChannelStatusActions({
  channel: c,
  busy,
  idPrefix,
  act,
}: {
  channel: Channel;
  busy: boolean;
  idPrefix: string;
  act: ChannelAct;
}) {
  const approve = (
    <button
      id={`${idPrefix}approve-${c.channelId}`}
      type="button"
      disabled={busy}
      onClick={() => act(() => api.approveChannel(c.channelId, {}))}
    >
      Approve
    </button>
  );

  if (c.status === "requested") {
    return (
      <div class="actions">
        {approve}
        <button
          id={`${idPrefix}decline-${c.channelId}`}
          type="button"
          class="danger"
          disabled={busy}
          onClick={() => act(() => api.declineChannel(c.channelId, {}))}
        >
          Decline
        </button>
      </div>
    );
  }

  if (c.status === "approved") {
    return (
      <div class="actions">
        <button
          id={`${idPrefix}start-${c.channelId}`}
          type="button"
          disabled={busy}
          title="Check the feed now, paused or not"
          onClick={() => act(() => api.startRun(c.channelId))}
        >
          Start
        </button>
        <button
          id={`${idPrefix}${c.paused ? "resume" : "pause"}-${c.channelId}`}
          type="button"
          disabled={busy}
          onClick={() =>
            act(() =>
              c.paused
                ? api.resumeChannel(c.channelId)
                : api.pauseChannel(c.channelId),
            )
          }
        >
          {c.paused ? "Resume" : "Pause"}
        </button>
        <button
          id={`${idPrefix}decline-${c.channelId}`}
          type="button"
          class="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(withdrawQuestion(c))) {
              act(() => api.declineChannel(c.channelId, {}));
            }
          }}
        >
          Decline
        </button>
      </div>
    );
  }

  return <div class="actions">{approve}</div>;
}
