import type { Density } from "./SummaryRow";

/**
 * Full or compact rows. The trade is the excerpt, never the title (docs/design.md §5), so this
 * changes how much of a summary a row shows and nothing about which rows there are.
 */
export function DensitySwitch({
  value,
  onChange,
}: {
  value: Density;
  onChange: (value: Density) => void;
}) {
  return (
    <fieldset class="join">
      <legend class="sr-only">Row density</legend>
      {(["full", "compact"] as const).map((density) => (
        <input
          key={density}
          type="radio"
          name="density"
          class="btn join-item min-h-11 border-edge bg-panel text-ui text-ink-2 checked:bg-base-200 checked:font-semibold checked:text-ink"
          aria-label={density === "full" ? "Full" : "Compact"}
          checked={value === density}
          onChange={() => onChange(density)}
        />
      ))}
    </fieldset>
  );
}
