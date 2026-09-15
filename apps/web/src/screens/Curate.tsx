import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { type Act, AttentionList } from "../components/AttentionList";
import { type CatalogFilter, CatalogHealth } from "../components/CatalogHealth";
import { CatalogTable } from "../components/CatalogTable";
import { Page } from "../components/Page";
import { ReviewedList, ReviewQueue } from "../components/RequestQueue";
import { Retry } from "../components/Retry";
import { actionErrorCopy, staleCopy } from "../lib/copy";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Curate() {
  return (
    <Guard ownerOnly>
      <CurateScreen />
    </Guard>
  );
}

/**
 * The owner's one extra destination (docs/design.md principle 2): **Needs you**, the **Catalog**,
 * and what has been **Reviewed**. The five-second decisions live beside the channels they govern, on
 * Sources; this is where the dense work is, which is why it is a table and why it is desktop only
 * (docs/design.md §6) — approving, declining, retrying and the catalog table are dense,
 * consequential and rare, and designing them twice costs more than it returns.
 */
function CurateScreen() {
  const { url } = useLocation();
  const [catalog, reloadCatalog] = useLoad(() => api.getCatalog(), []);
  // The queue and the table keep their rows through a reload, so a row's inline error and an open
  // approve or decline form survive the refresh every action triggers.
  const [channels, reloadChannels] = useLoad(
    () => api.listChannels({ scope: "all" }),
    [],
    { retainDataOnReload: true },
  );
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Retained rows are stale while the list refreshes and untrusted once a refresh has failed: a
  // lost-response approval followed by a failed reload would otherwise leave Decline enabled on a
  // channel that is already approved. Loads keep their own Retry buttons enabled.
  const stale = channels.status === "ready" && channels.refreshError !== null;
  const actionsDisabled =
    channels.status === "ready" && (channels.refreshing || stale);

  // When the numbers on screen were last true. A screen showing data it could not refresh says so
  // and names the time it is from, because acting on stale numbers is how an owner gets a refusal
  // they do not understand (docs/design.md §3).
  const loadedAt = useRef<number | null>(null);
  if (
    channels.status === "ready" &&
    !channels.refreshing &&
    channels.refreshError === null
  ) {
    loadedAt.current = Date.now();
  }

  function reloadAll() {
    reloadCatalog();
    reloadChannels();
  }

  // The reload runs whether the call succeeded or failed: the Registry may have applied the change
  // before the response was lost, and a stale row would offer the opposite action as a live button.
  const act: Act = async (channelId, work) => {
    setBusy((b) => ({ ...b, [channelId]: true }));
    setErrors((e) => ({ ...e, [channelId]: "" }));
    try {
      await work();
    } catch (caught) {
      setErrors((e) => ({ ...e, [channelId]: actionErrorCopy(caught) }));
    } finally {
      reloadAll();
      setBusy((b) => ({ ...b, [channelId]: false }));
    }
  };

  // Section navigation is anchors, not client-side tabs: land on the right one after load.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
  }, [url, channels.status]);

  const rows = channels.status === "ready" ? channels.data.channels : [];

  return (
    <Page measure="wide" desktopOnly>
      <header class="flex flex-wrap items-baseline gap-4">
        <h1 class="font-serif text-screen-title font-semibold tracking-tight text-ink">
          Curate
        </h1>
        <nav class="flex flex-wrap gap-4" aria-label="Sections">
          {[
            ["#needs-you", "Needs you"],
            ["#catalog", "Catalog"],
            ["#reviewed", "Reviewed"],
          ].map(([href, label]) => (
            <a key={href} class="min-h-11 text-ui text-primary" href={href}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      {channels.status === "loading" && (
        <div class="skeleton mt-6 h-32 w-full" />
      )}

      {channels.status === "error" && (
        <p class="mt-6 text-ui text-consequence">
          Couldn't load the channels: {actionErrorCopy(channels.error)}.{" "}
          <Retry onClick={reloadChannels} />
        </p>
      )}

      {channels.status === "ready" && channels.refreshing && (
        <p class="mt-4 text-meta text-ink-3">Refreshing…</p>
      )}

      {stale && (
        <p class="mt-4 rounded border border-consequence bg-panel px-3 py-2 text-ui text-consequence">
          {staleCopy(loadedAt.current)} Nothing here can be acted on until they
          are current. <Retry onClick={reloadChannels}>Try again</Retry>
        </p>
      )}

      {channels.status === "ready" && (
        <>
          <section id="needs-you" class="mt-8">
            <h2 class="font-serif text-section font-semibold text-ink">
              Needs you
            </h2>
            <ReviewQueue
              channels={rows}
              disabled={actionsDisabled}
              onChanged={reloadAll}
            />
            <AttentionList
              channels={rows}
              busy={busy}
              disabled={actionsDisabled}
              errors={errors}
              act={act}
            />
          </section>

          <section id="catalog" class="mt-10">
            <h2 class="font-serif text-section font-semibold text-ink">
              Catalog
            </h2>
            <div class="mt-3">
              {catalog.status === "error" ? (
                <p class="text-ui text-consequence">
                  Couldn't load the catalog's numbers:{" "}
                  {actionErrorCopy(catalog.error)}.{" "}
                  <Retry onClick={reloadCatalog} />
                </p>
              ) : catalog.status === "loading" ? (
                <div class="skeleton h-11 w-full" />
              ) : (
                <CatalogHealth
                  catalog={catalog.data.catalog}
                  filter={filter}
                  total={rows.length}
                  onFilter={setFilter}
                />
              )}
            </div>
            <CatalogTable
              channels={rows}
              disabled={actionsDisabled}
              filter={filter}
              busy={busy}
              errors={errors}
              act={act}
            />
          </section>

          <ReviewedList channels={rows} />
        </>
      )}
    </Page>
  );
}
