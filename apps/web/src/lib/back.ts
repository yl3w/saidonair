import { useEffect } from "preact/hooks";
import { useLocation } from "preact-iso";

/**
 * "The page I came from", for a screen that carries its own bar instead of the nav.
 *
 * This is the browser's own back, not a remembered path, and deliberately so: a breadcrumb that
 * records "the previous page" on every route change is wrong the moment a reader presses the
 * browser's back button, because the page they just left becomes the one the app would send them
 * back to. History already holds the answer and cannot disagree with itself.
 *
 * The one thing history cannot answer is whether there is anywhere to go: a reader who opened this
 * URL directly — a pasted link, a bookmark, a new tab — would be thrown out of the app. So this
 * tracks whether the tab has navigated inside the app at all, and falls back to a real destination
 * when it has not.
 */
let navigated = false;

/**
 * Mounted once, under the router: every path change after the first is an in-app navigation, so
 * from then on there is an entry to go back to.
 */
export function useTrackNavigation(): void {
  const { path } = useLocation();
  useEffect(() => {
    // The first render is the page the tab opened on, not a navigation.
    if (first === null) {
      first = path;
      return;
    }
    if (path !== first) navigated = true;
  }, [path]);
}

let first: string | null = null;

/** Go back, or to `fallback` when this tab arrived here directly and has nowhere to go. */
export function goBack(fallback: () => void): void {
  if (navigated) history.back();
  else fallback();
}

/** Whether back would stay inside the app; a screen may want to name its fallback instead. */
export function canGoBack(): boolean {
  return navigated;
}
