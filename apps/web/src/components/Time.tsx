import { absoluteTime, relativeTime } from "../lib/time";

/**
 * Relative in the text, absolute in the title. The one place a timestamp becomes words, so a reader
 * hovering a table cell can still read the date it stands for.
 */
export function Time({
  at,
  fallback = "—",
}: {
  at: number | null;
  fallback?: string;
}) {
  if (at === null) return <span class="text-ink-3">{fallback}</span>;
  return (
    <time dateTime={new Date(at).toISOString()} title={absoluteTime(at)}>
      {relativeTime(at)}
    </time>
  );
}
