import { absoluteTime, relativeTime } from "../lib/time";

/** Relative in the text, absolute in the title (spec §11). */
export function Time({
  at,
  fallback = "—",
}: {
  at: number | null;
  fallback?: string;
}) {
  if (at === null) return <span class="muted">{fallback}</span>;
  return (
    <time dateTime={new Date(at).toISOString()} title={absoluteTime(at)}>
      {relativeTime(at)}
    </time>
  );
}
