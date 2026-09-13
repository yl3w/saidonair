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
  const t = catalog.transcripts;
  const count = (label: string, n: number, filter: CatalogFilter) => (
    <button
      id={`filter-${filter}`}
      type="button"
      onClick={() => onFilter(filter)}
    >
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
        Episodes {e.available} summarised · {e.pending} pending · {e.failed}{" "}
        failed · {e.skipped} skipped
      </span>
      <span>
        Transcript credits{" "}
        {t.status === "ok"
          ? t.remainingCredits
          : t.status === "auth_failed"
            ? "key rejected"
            : "unknown"}
      </span>
      <span>
        Last ingestion{" "}
        <Time at={catalog.lastSuccessfulIngestionAt} fallback="never" />
      </span>
    </div>
  );
}

/** The nav badge and the owner card share this: requested review, failed episodes, never started. */
export function attentionCount(catalog: Catalog): number {
  return (
    catalog.attention.requested +
    catalog.attention.failedEpisodes +
    catalog.attention.neverStarted
  );
}
