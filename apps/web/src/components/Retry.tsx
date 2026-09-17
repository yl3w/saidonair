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
      class="btn btn-link [--btn-p:0.25rem]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
