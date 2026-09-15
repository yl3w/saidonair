// What this browser keeps to itself (docs/specs/design-phase.md §4.7): how the reading column is
// set, and whether counts are shown at all. None of it reaches the API — how a page looks is not
// something the product needs to know, and the same reader on another machine is free to choose
// differently. `system_rules` is the exception and lives in the API, because it changes what a chat
// answers rather than how a page looks.

export type ReadingFont = "serif" | "sans";
export type ReadingSize = "small" | "medium" | "large";
export type ReadingTheme = "light" | "sepia" | "dark";

export type ReaderSettings = {
  readingFont: ReadingFont;
  readingSize: ReadingSize;
  readingTheme: ReadingTheme;
  /** False hides every count in the product, for a reader who would rather not be kept score of. */
  showCounts: boolean;
};

export const READING_FONTS: ReadingFont[] = ["serif", "sans"];
export const READING_SIZES: ReadingSize[] = ["small", "medium", "large"];
export const READING_THEMES: ReadingTheme[] = ["light", "sepia", "dark"];

/** Serif, comfortable, light: the reading column as the design draws it (docs/design.md §2.2). */
export const DEFAULT_SETTINGS: ReaderSettings = {
  readingFont: "serif",
  readingSize: "medium",
  readingTheme: "light",
  showCounts: true,
};

const KEY = "media-digest:settings";

/** Never throws and never returns a partial: a blocked or corrupt store simply means the defaults. */
export function readSettings(): ReaderSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    const stored = parsed as Record<string, unknown>;
    return {
      readingFont: oneOf(stored.readingFont, READING_FONTS, "serif"),
      readingSize: oneOf(stored.readingSize, READING_SIZES, "medium"),
      readingTheme: oneOf(stored.readingTheme, READING_THEMES, "light"),
      showCounts:
        typeof stored.showCounts === "boolean" ? stored.showCounts : true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Applies a change and returns the whole settled value, so a caller can render what it stored. */
export function writeSettings(patch: Partial<ReaderSettings>): ReaderSettings {
  const next = { ...readSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the choice lives only for this page load.
  }
  applyReaderSettings(next);
  return next;
}

/**
 * Puts the reader's type and theme on `<html>`, where `styles.css` reads them (owner decision
 * 2026-09-15: reading preferences apply to every page, not only the reading column). Three
 * attributes and nothing else: no component knows which theme is on, because every colour in the
 * product resolves through a token the theme redefines.
 *
 * `<html>` rather than the app root, because a native `<dialog>` renders in the top layer and would
 * otherwise inherit nothing. `index.html` calls the same thing before first paint, so dark never
 * starts white.
 */
export function applyReaderSettings(settings: ReaderSettings): void {
  const root = document.documentElement;
  root.dataset.readingTheme = settings.readingTheme;
  root.dataset.readingFont = settings.readingFont;
  root.dataset.readingSize = settings.readingSize;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
