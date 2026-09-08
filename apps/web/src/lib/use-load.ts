import { useCallback, useEffect, useState } from "preact/hooks";

export type Load<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: Error };

/**
 * Loads `loader()` whenever `deps` change and exposes a reload. Every section on a screen loads
 * independently (spec §11), so this is the one place loading and error states are modelled. A
 * result that arrives after a newer load started is dropped. With `enabled: false` nothing is
 * fetched and the state stays "loading", which is how Home orders the digest after the lists.
 */
export function useLoad<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean } = {},
): [Load<T>, () => void] {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  // The caller names the inputs; the loader itself is a fresh closure every render.
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    if (!enabled) return;
    loader().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, tick, enabled]);

  return [state, reload];
}
