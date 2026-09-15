/** The sizes of docs/design.md §2.5, with the letter size each one carries. */
const SIZES = {
  20: { box: 20, text: 11 },
  28: { box: 28, text: 13 },
  34: { box: 34, text: 15 },
  46: { box: 46, text: 20 },
} as const;

export type AvatarSize = keyof typeof SIZES;

/** The six tints live in styles.css, where every colour does; this only picks one. */
const TINTS = 6;

/**
 * A channel's mark: one or two letters from its title on a tint chosen by hashing the channel id
 * (docs/design.md §2.5). Nothing in this product stores channel artwork and there is no permitted
 * source to fetch it from, so a grey disc would be a promise the data cannot keep. No network
 * request, no layout shift, and one channel is the same colour on every screen and for every reader.
 *
 * The letters are a visual aid, never the only name: a channel's title is always beside them, so the
 * mark is hidden from assistive technology unless a caller passes `label` for a standalone one.
 */
export function Avatar({
  channelId,
  title,
  size = 28,
  label,
}: {
  channelId: string;
  title: string;
  size?: AvatarSize;
  label?: string;
}) {
  const { box, text } = SIZES[size];
  const tint = tintOf(channelId);
  const aria =
    label === undefined
      ? ({ "aria-hidden": "true" } as const)
      : ({ role: "img", "aria-label": label } as const);
  return (
    <span
      class="inline-flex shrink-0 items-center justify-center rounded-full font-sans font-semibold select-none"
      style={{
        width: `${box}px`,
        height: `${box}px`,
        fontSize: `${text}px`,
        letterSpacing: "0.01em",
        background: `var(--tint-${tint}-bg)`,
        color: `var(--tint-${tint}-ink)`,
      }}
      {...aria}
    >
      {monogram(title)}
    </span>
  );
}

/**
 * One letter for a one-word title, the first two initials otherwise — "Computerphile" is C, "New
 * York Times Podcasts" is NY. Letters and digits only, so punctuation and emoji in a channel name
 * never become the mark; a title with neither gives "?".
 */
export function monogram(title: string): string {
  const words = title
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((word) => word.length > 0);
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return (initials.length > 0 ? initials : "?").toUpperCase();
}

/**
 * The channel id into one of the six tints, by FNV-1a. Any stable hash would do; what matters is
 * that it depends on nothing but the id, so the mark never changes and never differs between two
 * readers looking at the same channel.
 */
export function tintOf(channelId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < channelId.length; index++) {
    hash ^= channelId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % TINTS) + 1;
}
