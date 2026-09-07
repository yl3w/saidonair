/**
 * DO SQLite accepts at most 100 bound parameters per statement (101 fails with "too many SQL
 * variables"). Keep `IN (...)` lists and multi-row writes under the cap by chunking.
 */
export const MAX_BOUND_PARAMS = 100;

export function chunk<T>(items: readonly T[], size = MAX_BOUND_PARAMS): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** `?, ?, ?` for `count` bindings. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
