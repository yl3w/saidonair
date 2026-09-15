/**
 * The retry inside an error sentence. It reads as a link because that is where it sits, but it is a
 * 44 px target like every other control a finger reaches (docs/design.md §4) — an error state is
 * exactly where a missed tap costs the most.
 */
export function Retry({
  id,
  onClick,
  children = "Retry",
}: {
  id?: string;
  onClick: () => void;
  children?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      class="inline-flex min-h-11 items-center px-1 align-middle text-ui font-semibold text-primary underline decoration-1 underline-offset-2"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
