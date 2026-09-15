import type { Channel } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { channelStateCopy, runResultCopy } from "../lib/copy";
import { relativeTime } from "../lib/time";
import type { Act } from "./AttentionList";
import type { CatalogFilter } from "./CatalogHealth";
import { ChannelStatusActions } from "./ChannelStatusActions";

const PAGE = 25;

type Column = "title" | "state" | "episodes" | "ingested" | "followers";
type Sort = { column: Column; ascending: boolean };

const COLUMNS: { column: Column; label: string; sortable: boolean }[] = [
  { column: "title", label: "Channel", sortable: true },
  { column: "state", label: "State", sortable: true },
  { column: "episodes", label: "Episodes", sortable: true },
  { column: "ingested", label: "Last summary", sortable: true },
  { column: "followers", label: "Followers", sortable: true },
];

/**
 * Every channel, with the actions its status allows. Curate is allowed to look like a tool: cells
 * are 13.5 px, primaries at full ink, and the density comes from structure rather than small type
 * (docs/design.md §1, §3). What a long table needs is here — a sorted column, the status filters
 * above it, and 25 rows at a time — because those controls are part of the design, not a later fix.
 */
export function CatalogTable({
  channels,
  disabled,
  filter,
  busy,
  errors,
  act,
}: {
  channels: Channel[];
  disabled: boolean;
  filter: CatalogFilter;
  busy: Record<string, boolean>;
  errors: Record<string, string>;
  act: Act;
}) {
  const [sort, setSort] = useState<Sort>({ column: "title", ascending: true });
  const [shown, setShown] = useState(PAGE);

  // Approved and Paused are disjoint here, as they are in the health strip's counts: the Registry
  // counts an approved channel as paused, not approved, while a pause is set.
  const rows = channels
    .filter((c) => {
      if (filter === "all") return true;
      if (filter === "paused") return c.status === "approved" && c.paused;
      if (filter === "approved") return c.status === "approved" && !c.paused;
      return c.status === filter;
    })
    .sort(comparator(sort));
  const page = rows.slice(0, shown);

  function toggle(column: Column) {
    setSort((current) =>
      current.column === column
        ? { column, ascending: !current.ascending }
        : { column, ascending: column === "title" || column === "state" },
    );
    setShown(PAGE);
  }

  return (
    <>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full border-collapse text-cell">
          <thead>
            <tr class="border-b border-edge text-left">
              {COLUMNS.map(({ column, label }) => (
                <th
                  key={column}
                  scope="col"
                  class="py-2 pr-4 font-semibold text-ink-3"
                  aria-sort={
                    sort.column === column
                      ? sort.ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    class={`min-h-11 text-cell ${
                      sort.column === column
                        ? "font-semibold text-ink underline decoration-1 underline-offset-4"
                        : "text-ink-3"
                    }`}
                    onClick={() => toggle(column)}
                  >
                    {label}
                    {sort.column === column && (sort.ascending ? " ↑" : " ↓")}
                  </button>
                </th>
              ))}
              <th scope="col" class="py-2 font-semibold text-ink-3">
                Latest run
              </th>
              <th scope="col" class="py-2 font-semibold text-ink-3">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.map((c) => (
              <tr key={c.channelId} class="border-b border-rule align-top">
                <td class="py-2 pr-4">
                  <a
                    class="font-semibold text-ink"
                    href={`/curate/${c.channelId}`}
                  >
                    {c.title}
                  </a>
                  {errors[c.channelId] && (
                    <p class="text-meta text-consequence">
                      {errors[c.channelId]}
                    </p>
                  )}
                </td>
                <td class="py-2 pr-4 text-ink-2">{channelStateCopy(c)}</td>
                <td class="py-2 pr-4 text-ink-2">
                  {c.episodes.available} of {total(c)}
                  {c.episodes.failed > 0 && (
                    <span class="text-consequence">
                      {" "}
                      · {c.episodes.failed} failed
                    </span>
                  )}
                  {c.episodes.skipped > 0 && (
                    <span class="text-ink-3">
                      {" "}
                      · {c.episodes.skipped} skipped
                    </span>
                  )}
                </td>
                <td class="py-2 pr-4 text-ink-2">
                  {c.lastIngestedAt === null
                    ? "never"
                    : relativeTime(c.lastIngestedAt)}
                </td>
                <td class="py-2 pr-4 text-ink-2">{c.followerCount}</td>
                <td class="py-2 pr-4 text-ink-2">
                  {c.management.latestRun
                    ? `${c.management.latestRun.kind} · ${runResultCopy(c.management.latestRun)}`
                    : "—"}
                </td>
                <td class="py-2">
                  <ChannelStatusActions
                    channel={c}
                    busy={disabled || (busy[c.channelId] ?? false)}
                    idPrefix=""
                    act={(work) => act(c.channelId, work)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p class="mt-3 font-serif text-excerpt text-ink-2">
          No channel is in that state.
        </p>
      )}

      {rows.length > page.length && (
        <button
          type="button"
          class="btn btn-sm mt-3 min-h-11 border-edge bg-panel text-ui text-primary"
          onClick={() => setShown(shown + PAGE)}
        >
          Show {Math.min(PAGE, rows.length - page.length)} more of {rows.length}
        </button>
      )}
    </>
  );
}

function total(c: Channel): number {
  return (
    c.episodes.available +
    c.episodes.pending +
    c.episodes.failed +
    c.episodes.skipped
  );
}

function comparator(sort: Sort): (a: Channel, b: Channel) => number {
  const direction = sort.ascending ? 1 : -1;
  switch (sort.column) {
    case "state":
      return (a, b) =>
        direction * channelStateCopy(a).localeCompare(channelStateCopy(b));
    case "episodes":
      return (a, b) =>
        direction * (a.episodes.available - b.episodes.available);
    case "ingested":
      return (a, b) =>
        direction * ((a.lastIngestedAt ?? -1) - (b.lastIngestedAt ?? -1));
    case "followers":
      return (a, b) => direction * (a.followerCount - b.followerCount);
    default:
      return (a, b) => direction * a.title.localeCompare(b.title);
  }
}
