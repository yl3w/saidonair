import type { Catalog } from "@media-digest/shared";
import { relativeTime } from "../lib/time";

export type CatalogFilter =
  | "all"
  | "requested"
  | "approved"
  | "paused"
  | "declined";

const FILTERS: { filter: CatalogFilter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "requested", label: "Requested" },
  { filter: "approved", label: "Approved" },
  { filter: "paused", label: "Paused" },
  { filter: "declined", label: "Declined" },
];

/**
 * What the catalog is, in one strip: how many channels are in each state, how the episodes are
 * doing, what the transcript provider has left, and when anything last succeeded. The channel
 * counts double as the table's status filters, which is why they are buttons.
 */
export function CatalogHealth({
  catalog,
  filter,
  total,
  onFilter,
}: {
  catalog: Catalog;
  filter: CatalogFilter;
  total: number;
  onFilter: (filter: CatalogFilter) => void;
}) {
  const c = catalog.channels;
  const e = catalog.episodes;
  const t = catalog.transcripts;

  return (
    <div>
      <fieldset class="flex flex-wrap gap-1">
        <legend class="sr-only">Status filter</legend>
        {FILTERS.map(({ filter: name, label }) => {
          const n =
            name === "all"
              ? total
              : name === "requested"
                ? c.requested
                : name === "approved"
                  ? c.approved
                  : name === "paused"
                    ? c.paused
                    : c.declined;
          const on = filter === name;
          return (
            <button
              key={name}
              id={`filter-${name}`}
              type="button"
              aria-pressed={on}
              class={`btn ${on ? "btn-neutral" : "btn-quiet-secondary"} [--fontsize:var(--text-cell)]`}
              onClick={() => onFilter(name)}
            >
              {label}
              <span class="text-meta opacity-70">{n}</span>
            </button>
          );
        })}
      </fieldset>

      <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-meta text-ink-3">
        <Fact
          label="Episodes"
          value={`${e.available} summarised · ${e.pending} pending · ${e.failed} failed · ${e.skipped} skipped`}
        />
        <Fact
          label="Transcript credits"
          value={
            t.status === "ok"
              ? String(t.remainingCredits ?? "unknown")
              : t.status === "auth_failed"
                ? "key rejected"
                : "provider unreachable"
          }
          tone={t.status === "ok" ? "plain" : "consequence"}
        />
        <Fact
          label="Last ingestion"
          value={
            catalog.lastSuccessfulIngestionAt === null
              ? "never"
              : relativeTime(catalog.lastSuccessfulIngestionAt)
          }
        />
      </dl>
    </div>
  );
}

function Fact({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "consequence";
}) {
  return (
    <div class="flex gap-1.5">
      <dt class="text-label uppercase">{label}</dt>
      <dd class={tone === "consequence" ? "text-consequence" : "text-ink-2"}>
        {value}
      </dd>
    </div>
  );
}

/** The nav badge and Account share this: requested review, failed episodes, never started. */
export function attentionCount(catalog: Catalog): number {
  return (
    catalog.attention.requested +
    catalog.attention.failedEpisodes +
    catalog.attention.neverStarted
  );
}
