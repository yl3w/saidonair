import type { LucideIcon } from "lucide-preact";

/** The three sizes the design fixes (docs/design.md §2.4); there is no fourth. */
export type IconSize = 16 | 20 | 24;

/**
 * Every icon in the product. Lucide glyphs are imported by name at the point of use and handed to
 * this component, which is the one place size, stroke and colour are set, so no screen sets them by
 * hand and no screen can introduce a fourth size. Round caps and joins are Lucide's own defaults.
 *
 *     import { Check } from "lucide-preact";
 *     <Icon of={Check} label="Mark done" />
 *
 * An icon that carries meaning on its own takes a `label` and becomes an image with that name. One
 * that decorates text already on the screen takes none and is hidden from assistive technology,
 * because a name read twice is worse than a name read once. Never draw your own glyph, and never an
 * emoji: take another from Lucide by name.
 */
export function Icon({
  of: Glyph,
  size = 16,
  label,
  class: className,
}: {
  of: LucideIcon;
  size?: IconSize;
  label?: string;
  class?: string;
}) {
  const decorative = label === undefined;
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      color="currentColor"
      class={className}
      role={decorative ? undefined : "img"}
      aria-label={label}
      aria-hidden={decorative ? "true" : undefined}
    />
  );
}
