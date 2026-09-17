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
 *
 * **`scope` says which of them this surface may offer** (owner decision 2026-09-15, docs/PRD.md §9).
 * `adjustments` is what belongs beside the channel itself: the reversible knobs nobody else feels,
 * reached because a reader was looking at this channel and found it stale or noisy. `everything`
 * adds the three decisions — approve, decline, withdraw approval — which belong to Curate, because
 * nobody browses to a channel in order to approve it: that work is driven by the queue of requests,
 * it is felt by other readers, and it needs the context and the forms (title, import count, note)
 * that only Curate has. Principle 2 draws this line already — five-second decisions beside the
 * object, dense administrative work at one destination — and this is it drawn in code.
 */
export function ChannelStatusActions({
  channel: c,
  busy,
  idPrefix,
  scope,
  tone = "safe",
  act,
}: {
  channel: Channel;
  busy: boolean;
  idPrefix: string;
  scope: "adjustments" | "everything";
  /**
   * `owner` paints these amber, which `docs/design.md` §2.1 reserves for an owner-only affordance.
   * It is worth saying beside an object, where the owner's controls sit among a reader's own; it is
   * noise on Curate, where every control on the screen is the owner's and a mark that never varies
   * marks nothing.
   */
  tone?: "safe" | "owner";
  act: ChannelAct;
}) {
  const [confirming, setConfirming] = useState(false);
  const decisions = scope === "everything";

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

  // A channel that is not approved offers only decisions, so beside the object it offers nothing at
  // all; the strip still says where the work is done.
  if (c.status === "requested") {
    return !decisions ? null : (
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
          tone={tone}
          label={CHANNEL_ACTION_COPY.checkFeed}
          hint={CHANNEL_ACTION_COPY.checkFeedHint}
          onClick={() => act(() => api.startRun(c.channelId))}
        />
        <IconAction
          id={`${idPrefix}${c.paused ? "resume" : "pause"}-${c.channelId}`}
          busy={busy}
          icon={c.paused ? Play : Pause}
          tone={tone}
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
        {decisions && decline}
      </div>
    );
  }

  // Declined: approving again is a decision, so it lives in Curate too.
  return !decisions ? null : (
    <div class="flex flex-wrap items-center gap-1">{approve}</div>
  );
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
  /**
   * `safe` is the accent, which means "you can act on this"; `consequence` is the red somebody else
   * feels. **`quiet`** is for an action that is available and not being suggested — Retry on an
   * episode that is already summarised — so that the blue keeps meaning something.
   */
  tone?: "safe" | "quiet" | "consequence";
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
      // A disabled control has to look disabled (owner, 2026-09-17). daisyUI's own disabled state
      // is what does it now — 20% ink on a 10% ink ground, the same in all three tones — so the
      // `disabled:opacity-40` that used to carry it is gone. The tones are daisyUI's colour words
      // because the theme already maps them: primary is --accent, secondary --ink-2, error
      // --consequence (docs/design.md §2.6).
      class={`btn btn-ghost ${
        tone === "consequence"
          ? "btn-error"
          : tone === "quiet"
            ? "btn-secondary"
            : "btn-primary"
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
  tone = "safe",
  onClick,
}: {
  id?: string;
  busy: boolean;
  icon: LucideIcon;
  label: string;
  /** A fuller sentence for the tooltip where the name alone still leaves a question. */
  hint?: string;
  tone?: "safe" | "owner";
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      title={hint ?? label}
      disabled={busy}
      class={`btn btn-ghost btn-square ${
        tone === "owner" ? "btn-warning" : "btn-primary"
      }`}
      onClick={onClick}
    >
      <Icon of={icon} size={20} label={label} />
    </button>
  );
}
