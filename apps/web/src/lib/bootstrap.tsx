import { type ComponentChildren, createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * What the server already fetched, handed to the first render so the client does not throw away
 * the markup it was given (`docs/specs/public-reading.md` §4.5).
 *
 * Without this the page arrives rendered, boots, and immediately replaces the article with a
 * skeleton while it fetches what it is already showing — a flash on the one screen this feature
 * exists for. With it, the first client render is the same tree the server produced, which is also
 * what makes hydration match rather than warn.
 *
 * It is **only ever the first render**. Every screen still calls its loader; `useLoad` starts from
 * this instead of from `loading`, then refetches as it always did, which is how a signed-in reader
 * on a cached public page ends up with their own richer shape a moment later.
 *
 * Keyed by an opaque string the screen chooses, because a screen knows what it asked for and this
 * module cannot: `landing`, `channel:UC…`, `episode:abc…`.
 */
export type BootstrapData = Record<string, unknown>;

const BootstrapContext = createContext<BootstrapData | null>(null);

export function Bootstrap({
  value,
  children,
}: {
  value: BootstrapData | null;
  children: ComponentChildren;
}) {
  return (
    <BootstrapContext.Provider value={value}>
      {children}
    </BootstrapContext.Provider>
  );
}

/**
 * The server's answer for this key, once. `undefined` means there is none — a guarded screen, a
 * client-side navigation, or a page the Worker served as the bare shell because the API was down.
 *
 * It is deliberately not cleared after the first read. A screen may mount twice in a session
 * (a back navigation to a page the browser kept), and serving the same first paint is better than
 * a skeleton; the refetch behind it corrects anything stale either way.
 */
export function useBootstrap<T>(key: string | undefined): T | undefined {
  const data = useContext(BootstrapContext);
  if (key === undefined || data === null) return undefined;
  return data[key] as T | undefined;
}
