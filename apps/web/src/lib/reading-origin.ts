// Where a summary was opened from, so the reading column can put the reader back (docs/design.md
// §3). A summary has one URL and three ways in — the queue, a day in History, a source's own page —
// and the column itself cannot tell which was used, because `/read/:episodeId` names the episode and
// nothing else.
//
// Kept per tab in `sessionStorage`, like every other per-browser view preference (lib/settings.ts):
// where a reader was in a list is not something the product needs to know, and two tabs reading as
// two people must not tread on each other's place.
//
// The return anchors on the **row**, never on a pixel offset. An offset is wrong when a page of
// "Show more" has not been re-fetched, and wrong when the row itself has left the queue for having
// been read. The row's own id survives both; when the row is genuinely gone, its day heading is
// still there.

import { useEffect, useRef } from "preact/hooks";

const KEY = "media-digest:reading-origin";

export type OriginKind = "queue" | "history" | "source";

export type ReadingOrigin = {
  /** The list's own path, so a day in History returns to that day and not to every day. */
  href: string;
  kind: OriginKind;
  /** The row that was opened: where the reader is put back. */
  episodeId: string;
  /** The day heading that row sat under, for when the row has since left the list. */
  dayKey: string | null;
  /** What to call the destination when the kind cannot: a source is named by its channel. */
  label: string | null;
};

/** The anchor a list puts on a row and the return looks for. One spelling, agreed in one place. */
export function rowAnchorId(episodeId: string): string {
  return `episode-${episodeId}`;
}

/**
 * Remember this list, and this row in it, as the way back. Called as a row is opened; the path comes
 * from the address bar rather than the caller, so a screen cannot disagree with where it actually is.
 */
export function rememberOrigin(origin: {
  kind: OriginKind;
  episodeId: string;
  dayKey?: string;
  label?: string;
}): void {
  const record: ReadingOrigin = {
    href: location.pathname,
    kind: origin.kind,
    episodeId: origin.episodeId,
    dayKey: origin.dayKey ?? null,
    label: origin.label ?? null,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable: the arrow falls back to the queue, which is never wrong, only less kind.
  }
}

/** Never throws and never returns a half-built record: anything unreadable simply means no origin. */
export function readOrigin(): ReadingOrigin | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const stored = parsed as Record<string, unknown>;
    const { href, kind, episodeId } = stored;
    if (typeof href !== "string" || typeof episodeId !== "string") return null;
    if (kind !== "queue" && kind !== "history" && kind !== "source")
      return null;
    return {
      href,
      kind,
      episodeId,
      dayKey: typeof stored.dayKey === "string" ? stored.dayKey : null,
      label: typeof stored.label === "string" ? stored.label : null,
    };
  } catch {
    return null;
  }
}

function forgetOrigin(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do: a store that cannot be cleared could not have been written either.
  }
}

/**
 * Put the reader back on the row they left, once this list's rows are actually in the document.
 * `ready` is what waits for them: the lists all fetch, so the page is one screen tall for a moment
 * after it mounts, which is exactly when the browser's own scroll restoration gives up.
 *
 * The record is consumed by the return, so a later visit to the same list starts at the top the way
 * a fresh visit should.
 */
export function useReturnAnchor(ready: boolean): void {
  const used = useRef(false);

  useEffect(() => {
    if (!ready || used.current) return;
    const origin = readOrigin();
    if (origin === null || origin.href !== location.pathname) return;
    used.current = true;
    forgetOrigin();

    // One frame, so the rows this render just produced are laid out before we measure them.
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(rowAnchorId(origin.episodeId));
      const target =
        row ??
        (origin.dayKey === null
          ? null
          : document.getElementById(`day-${origin.dayKey}`));
      // Centred rather than at the top: the nav bar is sticky and would otherwise cover the row.
      target?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
