/**
 * The episode `Ask` was pressed on, handed from the reading screen to the chat composer
 * (owner decision 2026-09-16: scope is component state and nothing is in the URL).
 *
 * A module variable rather than a query parameter, so it lives exactly as long as the tab's current
 * navigation. It carries the scope only for a chat that **does not exist yet**: once there are
 * messages, the conversation is the record, and `Chat.tsx` recovers the scope from its last
 * question on load. So a reload of an existing chat keeps its scope; a reload of the empty composer,
 * and a middle-click into a new tab, land unscoped — and the line beneath the composer says which
 * of the two searches is in force either way.
 */
let pending: string | null = null;

export function setAskScope(episodeId: string): void {
  pending = episodeId;
}

/** Reads it once and clears it: a scope is consumed by the composer it was opened for. */
export function takeAskScope(): string | null {
  const scope = pending;
  pending = null;
  return scope;
}
