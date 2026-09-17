import { Minus, Plus } from "lucide-preact";
import { FOLLOW_COPY, followActionCopy } from "../lib/copy";
import { Icon } from "./Icon";

/**
 * Follow or unfollow a channel: `plus` or `minus`, **and the word** (owner decision 2026-09-15,
 * docs/PRD.md §9). The glyph alone was the least legible control in the product — a dash in a box
 * reads as a dash before it reads as "unfollow" — and the answer to an unreadable label is the
 * word, not a different glyph. The pair still leads, so the scannability that made it worth doing
 * survives: two shapes differ at a glance down a list of twenty-five where two words differing by a
 * prefix do not.
 *
 * `plus`/`minus` rather than the commoner `plus`/`check`, because `check` already means "mark this
 * summary done" on every row in the queue and History. Not the `user-*` family either: `user-plus`
 * is the *invite* glyph, an admin adding a person, and beside a follower count it reads as "remove
 * a follower" — a capability that sounds plausible and does not exist. Wrongly specific is worse
 * than vague.
 *
 * **Bordered, where the owner's controls beside it are not.** A reader's own act is a box; a
 * decision about the shared catalog is bare. That is the personal/catalog separation carried by
 * form rather than by a divider.
 *
 * The accessible name carries the channel, so a reader tabbing a list of twenty-five does not meet
 * twenty-five buttons called "Follow"; it opens with the visible word, as a name containing its own
 * label must.
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
  const full = followActionCopy(following, title);
  return (
    <button
      type="button"
      aria-label={full}
      title={full}
      disabled={busy}
      class={`btn ${following ? "btn-quiet-secondary" : "btn-quiet"}`}
      onClick={onClick}
    >
      <Icon of={following ? Minus : Plus} size={16} />
      {following ? FOLLOW_COPY.unfollow : FOLLOW_COPY.follow}
    </button>
  );
}
