import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { AddChannel } from "../components/AddChannel";
import { type CatalogFilter, CatalogHealth } from "../components/CatalogHealth";
import { CatalogTable } from "../components/CatalogTable";
import { Nav } from "../components/Nav";
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Owner() {
  return (
    <Guard ownerOnly>
      <OwnerScreen />
    </Guard>
  );
}

/** The owner's job in one page (spec §7): catalog health and the table. */
function OwnerScreen() {
  const { url } = useLocation();
  const [catalog, reloadCatalog] = useLoad(() => api.getCatalog(), []);
  const [channels, reloadChannels] = useLoad(
    () => api.listChannels({ scope: "all" }),
    [],
  );
  const [filter, setFilter] = useState<CatalogFilter>("all");

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
    <main class="wide">
      <Nav />
      <nav class="sections" aria-label="Sections">
        <a href="#catalog">Catalog</a>
        <a href="#attention">Needs attention</a>
      </nav>

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
        {channels.status === "loading" && <p>Loading channels…</p>}
        {channels.status === "error" && (
          <p class="error">
            Couldn't load channels: {channels.error.message}.{" "}
            <button type="button" onClick={reloadChannels}>
              Retry
            </button>
          </p>
        )}
        {channels.status === "ready" && (
          <CatalogTable
            channels={channels.data.channels}
            filter={filter}
            onChanged={reloadAll}
          />
        )}
        <AddChannel onChanged={reloadAll} />
      </section>
    </main>
  );
}
