import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useBootstrap } from "./bootstrap";

export type Load<T> =
  | { status: "loading" }
  | {
      status: "ready";
      data: T;
      refreshing: boolean;
      refreshError: Error | null;
    }
  | { status: "error"; error: Error };

/**
 * Loads `loader()` whenever `deps` change and exposes a reload. Every section on a screen loads
 * independently (spec §11), so this is the one place loading and error states are modelled. A
 * result that arrives after a newer load started is dropped. `retainDataOnReload` keeps ready data
 * only for an explicit reload, including when that refresh fails; dependency changes still load
 * from empty. With `enabled: false` nothing is fetched and the state stays "loading", which is how
 * Home orders the digest after the lists.
 */
export function useLoad<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options: {
    enabled?: boolean;
    retainDataOnReload?: boolean;
    /**
     * What the server rendered this screen from, if it did (lib/bootstrap.tsx). It seeds the first
     * state so the client's first paint is the markup it was handed rather than a skeleton over
     * the top of it; the loader still runs, and its answer replaces this.
     */
    bootstrapKey?: string;
  } = {},
): [Load<T>, () => void] {
  const enabled = options.enabled ?? true;
  const retainDataOnReload = options.retainDataOnReload ?? false;
  const booted = useBootstrap<T>(options.bootstrapKey);
  const [state, setState] = useState<Load<T>>(
    booted === undefined
      ? { status: "loading" }
      : { status: "ready", data: booted, refreshing: true, refreshError: null },
  );
  const [tick, setTick] = useState(0);
  const reloadRequested = useRef(false);
  const previousDeps = useRef<readonly unknown[] | null>(null);
  const reload = useCallback(() => {
    reloadRequested.current = true;
    setTick((n) => n + 1);
  }, []);

  // The caller names the inputs; the loader itself is a fresh closure every render.
  useEffect(() => {
    let cancelled = false;
    const priorDeps = previousDeps.current;
    const dependenciesChanged =
      priorDeps === null ||
      priorDeps.length !== deps.length ||
      deps.some(
        (dependency, index) => !Object.is(dependency, priorDeps[index]),
      );
    previousDeps.current = [...deps];

    // Retention is deliberately limited to explicit reloads. A dependency change identifies
    // different data, so showing the old result under the new key would be incorrect.
    const retained =
      retainDataOnReload &&
      reloadRequested.current &&
      !dependenciesChanged &&
      state.status === "ready"
        ? state
        : null;
    reloadRequested.current = false;
    setState(
      retained === null
        ? { status: "loading" }
        : { ...retained, refreshing: true, refreshError: null },
    );
    if (!enabled) return;
    loader().then(
      (data) => {
        if (!cancelled) {
          setState({
            status: "ready",
            data,
            refreshing: false,
            refreshError: null,
          });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          const caught =
            error instanceof Error ? error : new Error(String(error));
          setState(
            retained === null
              ? { status: "error", error: caught }
              : { ...retained, refreshing: false, refreshError: caught },
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, tick, enabled, retainDataOnReload]);

  return [state, reload];
}
