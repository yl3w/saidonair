import type { Channel } from "@media-digest/shared";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { api } from "../api";
import { declineQuestion } from "../lib/copy";
import { ConfirmDialog } from "./ConfirmDialog";

/** One channel action; the caller reloads whatever it shows once the work settles. */
export type ChannelAct = (work: () => Promise<unknown>) => Promise<void>;

/**
 * Approve, decline, pause, resume, or start a channel, by status (docs/PRD.md §7). Start checks an
 * approved channel's feed now, paused or not.
 *
 * Actions are text with the padding and weight to be found and to be hit (docs/design.md §3), and
 * the colour says what kind of thing they are: safe actions wear the accent, and Decline — the only
 * one here anybody else feels — wears the consequence red and asks first, naming the follower count
 * and what those readers lose.
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
  const [confirming, setConfirming] = useState(false);

  const approve = (
    <Action
      id={`${idPrefix}approve-${c.channelId}`}
      busy={busy}
      onClick={() => act(() => api.approveChannel(c.channelId, {}))}
    >
      Approve
    </Action>
  );

  const decline = (
    <>
      <Action
        id={`${idPrefix}decline-${c.channelId}`}
        busy={busy}
        tone="consequence"
        onClick={() => setConfirming(true)}
      >
        {c.approvedAt === null ? "Decline" : "Withdraw"}
      </Action>
      <ConfirmDialog
        open={confirming}
        title={c.approvedAt === null ? "Decline this channel?" : "Withdraw it?"}
        question={declineQuestion(c)}
        confirmLabel={c.approvedAt === null ? "Decline it" : "Withdraw it"}
        busy={busy}
        onConfirm={() => {
          setConfirming(false);
          act(() => api.declineChannel(c.channelId, {}));
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );

  if (c.status === "requested") {
    return (
      <div class="flex flex-wrap items-center gap-1">
        {approve}
        {decline}
      </div>
    );
  }

  if (c.status === "approved") {
    return (
      <div class="flex flex-wrap items-center gap-1">
        <Action
          id={`${idPrefix}start-${c.channelId}`}
          busy={busy}
          title="Check the feed now, paused or not"
          onClick={() => act(() => api.startRun(c.channelId))}
        >
          Start
        </Action>
        <Action
          id={`${idPrefix}${c.paused ? "resume" : "pause"}-${c.channelId}`}
          busy={busy}
          onClick={() =>
            act(() =>
              c.paused
                ? api.resumeChannel(c.channelId)
                : api.pauseChannel(c.channelId),
            )
          }
        >
          {c.paused ? "Resume" : "Pause"}
        </Action>
        {decline}
      </div>
    );
  }

  return <div class="flex flex-wrap items-center gap-1">{approve}</div>;
}

/**
 * A row action: text, but with the padding and weight to be a target rather than a word
 * (docs/design.md §3, §4). Busy shows in the label rather than only in a disabled state, because a
 * greyed control that says nothing is indistinguishable from a broken one.
 */
export function Action({
  id,
  busy,
  tone = "safe",
  title,
  onClick,
  children,
}: {
  id?: string;
  busy: boolean;
  tone?: "safe" | "consequence";
  title?: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      disabled={busy}
      class={`min-h-11 rounded px-2 text-ui font-semibold ${
        tone === "consequence" ? "text-consequence" : "text-primary"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
