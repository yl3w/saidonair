/**
 * A segmented choice built from real radios, so it is one stop on the keyboard and the arrow keys
 * move between the options. daisyUI supplies the form; the words are ours (docs/design.md §2.6).
 */
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="flex flex-wrap items-center gap-3">
      <legend class="sr-only">{legend}</legend>
      <span class="w-14 text-meta text-ink-3">{legend}</span>
      <div class="join">
        {options.map((option) => (
          <input
            key={option.value}
            type="radio"
            name={legend}
            class="btn join-item"
            aria-label={option.label}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}
