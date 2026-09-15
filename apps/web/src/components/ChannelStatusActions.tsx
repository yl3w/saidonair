import type { Channel } from "@media-digest/shared";
import { type LucideIcon, Pause, Play, RotateCw } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { api } from "../api";
import { CHANNEL_ACTION_COPY, declineQuestion } from "../lib/copy";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";

/** One channel action; the caller reloads whatever it shows once the work settles. */
export type ChannelAct = (work: () => Promise<unknown>) => Promise<void>;

/**
 * Approve, decline, pause, resume, or check the feed of a channel, by status (docs/PRD.md §7).
 * Checking the feed reads an approved channel's uploads now, paused or not.
 *
 * **Form says what kind of act each one is** (owner decision 2026-09-15, docs/PRD.md §9). The two
 * reversible knobs nobody else feels — check the feed now, pause and resume ingestion — are glyphs:
 * conventional, complementary, and used often enough to be learnt. The one decision that reaches
 * other readers keeps its word, in the consequence red, and asks first. No glyph means "withdraw
 * approval" anyway: `x`, `ban` and `circle-minus` all read as *delete*, and withdrawing deletes
 * nothing.
 *
 * Words are still what these are called — `CHANNEL_ACTION_COPY` — and a glyph carries its name for
 * assistive technology and as its tooltip; a list with room for the word uses the word.
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
      {CHANNEL_ACTION_COPY.approve}
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
        {c.approvedAt === null
          ? CHANNEL_ACTION_COPY.decline
          : CHANNEL_ACTION_COPY.withdraw}
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
        <IconAction
          id={`${idPrefix}start-${c.channelId}`}
          busy={busy}
          icon={RotateCw}
          label={CHANNEL_ACTION_COPY.checkFeed}
          hint={CHANNEL_ACTION_COPY.checkFeedHint}
          onClick={() => act(() => api.startRun(c.channelId))}
        />
        <IconAction
          id={`${idPrefix}${c.paused ? "resume" : "pause"}-${c.channelId}`}
          busy={busy}
          icon={c.paused ? Play : Pause}
          label={
            c.paused ? CHANNEL_ACTION_COPY.resume : CHANNEL_ACTION_COPY.pause
          }
          onClick={() =>
            act(() =>
              c.paused
                ? api.resumeChannel(c.channelId)
                : api.pauseChannel(c.channelId),
            )
          }
        />
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

/**
 * The same action as a glyph, for the two that are reversible, conventional and offered in a dense
 * group. A 44 px square target, and the word still exists: `label` is the accessible name and the
 * tooltip, so the control is never nameless to assistive technology or to a pointer that rests on
 * it. Only for acts nobody else feels — anything with a consequence keeps its word (docs/design.md
 * §2.4).
 */
export function IconAction({
  id,
  busy,
  icon,
  label,
  hint,
  onClick,
}: {
  id?: string;
  busy: boolean;
  icon: LucideIcon;
  label: string;
  /** A fuller sentence for the tooltip where the name alone still leaves a question. */
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      title={hint ?? label}
      disabled={busy}
      class="flex size-11 shrink-0 items-center justify-center rounded text-primary"
      onClick={onClick}
    >
      <Icon of={icon} size={20} label={label} />
    </button>
  );
}
