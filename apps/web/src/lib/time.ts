export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3h ago", "2d ago", and for a moment ahead "in 5h" (next attempt, deadline); a date after four weeks past. */
export function relativeTime(at: number, now = Date.now()): string {
  const elapsed = now - at;
  if (elapsed < -MINUTE) return `in ${span(-elapsed)}`;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < 28 * DAY) return `${span(elapsed)} ago`;
  return datedTime(at);
}

/**
 * The date a relative time gives up and states, spelled the way this product spells dates
 * everywhere else. `toLocaleDateString()` alone answered "8/18/2026" beside "14d ago" in the same
 * column — the machine's default, and a different order in every other locale.
 */
function datedTime(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function span(ms: number): string {
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** "pending for 3 days": how long something has been in a state. */
export function duration(sinceMs: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - sinceMs);
  if (elapsed < HOUR)
    return `${Math.max(1, Math.floor(elapsed / MINUTE))} minutes`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hours`;
  return `${Math.floor(elapsed / DAY)} days`;
}

export function absoluteTime(at: number): string {
  return new Date(at).toLocaleString();
}
