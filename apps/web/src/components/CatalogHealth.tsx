import type { Catalog } from "@media-digest/shared";
import { Time } from "./Time";

export type CatalogFilter =
  | "all"
  | "requested"
  | "approved"
  | "paused"
  | "declined";

/** The health strip (spec §7.2). Each count is a filter for the table below. */
export function CatalogHealth({
  catalog,
  onFilter,
}: {
  catalog: Catalog;
  onFilter: (filter: CatalogFilter) => void;
}) {
  const c = catalog.channels;
  const e = catalog.episodes;
  const tracked = e.available + e.pending + e.waiting + e.failed + e.skipped;
  const count = (label: string, n: number, filter: CatalogFilter) => (
    <button type="button" onClick={() => onFilter(filter)}>
      {label} {n}
    </button>
  );
  return (
    <div class="strip">
      {count("Requested", c.requested, "requested")}
      {count("Approved", c.approved, "approved")}
      {count("Paused", c.paused, "paused")}
      {count("Declined", c.declined, "declined")}
      <span>
        Episodes {e.available} available / {tracked} tracked
      </span>
      <span>Runs active {catalog.runs.active}</span>
      <span>
        Last ingestion{" "}
        <Time at={catalog.lastSuccessfulIngestionAt} fallback="never" />
      </span>
    </div>
  );
}
