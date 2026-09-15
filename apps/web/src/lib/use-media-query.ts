import { useEffect, useState } from "preact/hooks";

/** Tailwind's `md`: the width at which the top bar keeps its links and a popover stays a popover. */
export const WIDE = "(min-width: 48rem)";

/**
 * Whether a media query matches, kept current. Layout belongs in CSS, so this is only for the few
 * places where the *behaviour* differs and not just the look — a popover on a desktop is a bottom
 * sheet on a phone (docs/design.md §3), and a `<dialog>` is opened from script, not from a class.
 *
 * Starts false and settles on mount: there is no viewport to measure before there is a document.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
