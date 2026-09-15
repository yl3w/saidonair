import { Fragment } from "preact";

/**
 * A line of facts, separated by a middle dot: the channel and time over a summary row, the counts
 * under a channel's title, the date and runtime under a title in the reading column.
 *
 * **The separator belongs to the line, not to an item.** Written out, each item after the first
 * carried its own "· " and the row's flex gap sat only on its left, so every dot had twice as much
 * space before it as after — visible, and wrong in three places at once. Here the dot is its own
 * element inside the same gap, so both sides match, and an item that does not apply can drop out
 * from anywhere without leaving a stray mark at the front.
 *
 * The dots are hidden from assistive technology: a list of facts read aloud does not want "dot"
 * between every one of them.
 */
export function MetaLine({
  items,
  class: className = "",
}: {
  items: readonly string[];
  class?: string;
}) {
  return (
    <p class={`flex flex-wrap gap-x-2 text-meta text-ink-3 ${className}`}>
      {items.map((item, index) => (
        <Fragment key={`${index}:${item}`}>
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>{item}</span>
        </Fragment>
      ))}
    </p>
  );
}
