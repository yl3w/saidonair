import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { AddChannel } from "../components/AddChannel";
import { type CatalogFilter, CatalogHealth } from "../components/CatalogHealth";
import { CatalogTable } from "../components/CatalogTable";
import { Page } from "../components/Page";
import { RequestQueue } from "../components/RequestQueue";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Owner() {
  return (
    <Guard ownerOnly>
      <OwnerScreen />
    </Guard>
  );
}

/** The owner's job in one page (spec §7): the review queue, catalog health and table, attention list. */
function OwnerScreen() {
  const { url } = useLocation();
  const [catalog, reloadCatalog] = useLoad(() => api.getCatalog(), []);
  // The queue and the table keep their rows through a reload, so a row's inline error and an open
  // approve or decline form survive the refresh every action triggers (spec §11).
  const [channels, reloadChannels] = useLoad(
    () => api.listChannels({ scope: "all" }),
    [],
    { retainDataOnReload: true },
  );
  const [filter, setFilter] = useState<CatalogFilter>("all");
  // Retained rows are stale while the list refreshes and untrusted once a refresh has failed: a
  // lost-response approval followed by a failed reload would otherwise leave Decline enabled on a
  // channel that is already approved. Loads keep their own Retry buttons enabled.
  const actionsDisabled =
    channels.status === "ready" &&
    (channels.refreshing || channels.refreshError !== null);

  function reloadAll() {
    reloadCatalog();
    reloadChannels();
  }

  // Section links are anchors; land on the right one after load and on hash changes.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
  }, [url, channels.status]);

  return (
    <Page measure="wide">
      <nav class="sections" aria-label="Sections">
        <a href="#requests">Queue</a>
        <a href="#catalog">Catalog</a>
        <a href="#attention">Needs attention</a>
      </nav>

      {channels.status === "loading" && <p>Loading channels…</p>}
      {channels.status === "error" && (
        <p class="error">
          Couldn't load channels: {channels.error.message}.{" "}
          <button type="button" onClick={reloadChannels}>
            Retry
          </button>
        </p>
      )}
      {channels.status === "ready" && channels.refreshing && (
        <p class="muted">Refreshing channels…</p>
      )}
      {channels.status === "ready" && channels.refreshError !== null && (
        <p class="error">
          Couldn't refresh channels: {channels.refreshError.message}.{" "}
          <button type="button" onClick={reloadChannels}>
            Retry
          </button>
        </p>
      )}
      {channels.status === "ready" && (
        <RequestQueue
          channels={channels.data.channels}
          disabled={actionsDisabled}
          onChanged={reloadAll}
        />
      )}

      <section id="catalog">
        <h2>Catalog</h2>
        {catalog.status === "loading" && <p>Loading…</p>}
        {catalog.status === "error" && (
          <p class="error">
            Couldn't load the catalog summary: {catalog.error.message}.{" "}
            <button type="button" onClick={reloadCatalog}>
              Retry
            </button>
          </p>
        )}
        {catalog.status === "ready" && (
          <CatalogHealth catalog={catalog.data.catalog} onFilter={setFilter} />
        )}
        {channels.status === "ready" && (
          <CatalogTable
            channels={channels.data.channels}
            disabled={actionsDisabled}
            filter={filter}
            onChanged={reloadAll}
          />
        )}
        <AddChannel onChanged={reloadAll} />
      </section>
    </Page>
  );
}
