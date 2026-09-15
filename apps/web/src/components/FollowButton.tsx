import { Minus, Plus } from "lucide-preact";
import { followActionCopy } from "../lib/copy";
import { Icon } from "./Icon";

/**
 * Follow or unfollow a channel, as `plus` and `minus` (owner decision 2026-09-15, docs/PRD.md §9).
 * It meets the three conditions a control must meet before it may be a glyph (docs/design.md §2.4):
 * trivially reversible — the glyph beside it is the reversal — conventional wherever anything is
 * subscribed to, and the thing a reader does most on this screen.
 *
 * `plus`/`minus` rather than the commoner `plus`/`check`, because `check` already means "mark this
 * summary done" on every row in the queue and History, and one glyph with two meanings on screens a
 * reader crosses in a single session is worse than a long word. The pair also reads faster down a
 * list than "Follow" and "Unfollow" do: two shapes differ at a glance where two words differing by
 * a prefix do not.
 *
 * **Bordered, where the owner's glyphs beside it are not.** A reader's own act is a box; a decision
 * about the shared catalog is bare text or a bare glyph. That is the personal/catalog separation
 * carried by form rather than by a divider.
 *
 * The accessible name carries the channel, so a reader tabbing a list of twenty-five does not meet
 * twenty-five buttons all called "Follow".
 */
export function FollowButton({
  title,
  following,
  busy,
  onClick,
}: {
  title: string;
  following: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const label = followActionCopy(following, title);
  return (
    <button
      type="button"
      title={label}
      disabled={busy}
      class={`flex size-11 shrink-0 items-center justify-center rounded border border-edge bg-panel ${
        following ? "text-ink-2" : "text-primary"
      }`}
      onClick={onClick}
    >
      <Icon of={following ? Minus : Plus} size={20} label={label} />
    </button>
  );
}
