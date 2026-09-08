import type { Catalog } from "@media-digest/shared";
import { Time } from "./Time";

export type CatalogFilter =
  | "all"
  | "available"
  | "pending"
  | "failed"
  | "deleted";

/** The health strip (spec §7.2). Each count is a filter for the table below. */
export function CatalogHealth({
  catalog,
  onFilter,
}: {
  catalog: Catalog;
  onFilter: (filter: CatalogFilter) => void;
}) {
  const c = catalog.channels;
  const count = (label: string, n: number, filter: CatalogFilter) => (
    <button type="button" onClick={() => onFilter(filter)}>
      {label} {n}
    </button>
  );
  return (
    <div class="strip">
      {count("Available", c.available, "available")}
      {count("Pending", c.pending, "pending")}
      {count("Failed", c.failed, "failed")}
      {count("Deleted", c.deleted, "deleted")}
      <span>
        Episodes {catalog.episodes.processed} processed /{" "}
        {catalog.episodes.tracked} tracked
      </span>
      <span>Runs active {catalog.runs.active}</span>
      <span>
        Last ingestion{" "}
        <Time at={catalog.lastSuccessfulIngestionAt} fallback="never" />
      </span>
    </div>
  );
}
