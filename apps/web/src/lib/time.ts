const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3h ago", "2d ago"; falls back to a date after four weeks. */
export function relativeTime(at: number, now = Date.now()): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 28 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(at).toLocaleDateString();
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
