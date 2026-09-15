import { List, Rss, Table } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { readSettings } from "../lib/settings";
import { useSession } from "../session";
import { Avatar } from "./Avatar";
import { attentionCount } from "./CatalogHealth";
import { Icon } from "./Icon";

/**
 * The frame (docs/design.md §3): a 56 px top bar carrying the wordmark, the reader's destinations,
 * and the reader themselves. There is one navigation for everyone — no role switcher and no owner
 * mode. The owner simply has one more destination, Curate, and it appears only on a screen wide
 * enough for what it holds (docs/design.md §6); below that, Account says what is waiting and why it
 * is not here.
 *
 * On a phone the reader destinations move to a bottom tab bar, where a thumb can reach them.
 *
 * Chats is not here. Primary navigation is for what a reader can use, and an entry leading to a
 * placeholder makes the whole product read as unfinished; it returns when M4 builds the screen
 * (owner decision 2026-09-15, docs/PRD.md §9).
 */

const DESTINATIONS = [
  { href: "/queue", label: "Queue", icon: List },
  { href: "/sources", label: "Sources", icon: Rss },
] as const;

export function Nav() {
  const { state } = useSession();
  const { path } = useLocation();
  const email = state.status === "ready" ? state.email : null;
  const role = state.status === "ready" ? state.role : null;
  const waiting = useAttentionCount(role === "owner", path);
  const showCounts = readSettings().showCounts;

  return (
    <>
      <header class="sticky top-0 z-20 border-b border-rule bg-panel">
        <div class="mx-auto flex h-14 w-full items-center gap-6 px-5 md:px-8">
          <a
            href="/queue"
            class="flex min-h-11 items-center font-serif text-section font-semibold tracking-tight text-ink"
          >
            Said on Air
          </a>

          <nav
            class="hidden md:flex md:items-center md:gap-5"
            aria-label="Primary"
          >
            {DESTINATIONS.map((destination) => (
              <TopLink
                key={destination.href}
                href={destination.href}
                label={destination.label}
                current={isCurrent(path, destination.href)}
              />
            ))}
            {role === "owner" && (
              <TopLink
                href="/curate"
                label="Curate"
                current={isCurrent(path, "/curate")}
                owner
                count={showCounts ? waiting : null}
              />
            )}
          </nav>

          {email !== null && (
            <a
              href="/account"
              class="ml-auto flex min-h-11 items-center gap-2 text-meta text-ink-2"
              aria-current={isCurrent(path, "/account") ? "page" : undefined}
            >
              <span class="hidden lg:inline">{email}</span>
              <Avatar id={email} name={localPart(email)} size={28} />
              <span class="sr-only">Account</span>
            </a>
          )}
        </div>
      </header>

      <nav
        class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-rule bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Primary"
      >
        {DESTINATIONS.map(({ href, label, icon }) => {
          const current = isCurrent(path, href);
          return (
            <a
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              class={`flex min-h-14 flex-col items-center justify-center gap-1 text-label ${
                current ? "font-semibold text-ink" : "text-ink-2"
              }`}
            >
              <Icon of={icon} size={20} />
              {label}
            </a>
          );
        })}
      </nav>
    </>
  );
}

/**
 * A destination in the top bar. The current one says so in words to assistive technology, in weight
 * and in a rule under it, before it says so in colour — state is never colour alone
 * (docs/design.md §4). The count renders only when something waits, and not at all for a reader who
 * has turned counts off.
 */
function TopLink({
  href,
  label,
  current,
  owner = false,
  count = null,
}: {
  href: string;
  label: string;
  current: boolean;
  owner?: boolean;
  count?: number | null;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      class={`flex min-h-11 items-center gap-1.5 border-b-2 text-ui ${
        current ? "border-ink font-semibold" : "border-transparent"
      } ${owner ? "text-owner" : current ? "text-ink" : "text-ink-2"} ${
        owner ? "hidden lg:flex" : ""
      }`}
    >
      {owner && <Icon of={Table} size={16} />}
      {label}
      {count !== null && count > 0 && (
        <span class="badge badge-sm border-owner bg-transparent text-meta text-owner">
          {count}
        </span>
      )}
    </a>
  );
}

/** `/sources` is current on `/sources/UC…` too; `/` is only ever itself. */
function isCurrent(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

function localPart(email: string): string {
  return email.split("@")[0] ?? email;
}

/**
 * How many things wait in Curate, from `GET /catalog`, refreshed on every navigation rather than on
 * a timer. Null while it is unknown or the read failed: a count nobody can vouch for is worse than
 * no count, and the destination is reachable either way.
 */
function useAttentionCount(enabled: boolean, path: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;
    api.getCatalog().then(
      ({ catalog }) => {
        if (!cancelled) setCount(attentionCount(catalog));
      },
      () => {
        if (!cancelled) setCount(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, path]);
  return count;
}
