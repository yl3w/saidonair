import type { Channel } from "@media-digest/shared";
import { CHANNEL_STATUS_COPY } from "../lib/copy";
import type { CatalogFilter } from "./CatalogHealth";
import { Time } from "./Time";

/**
 * The all-channels table (spec §7.4) from GET /channels?scope=all, whose rows carry the
 * owner-only `management` block. Task 10 rebuilds the attention list and the row actions on the
 * new approve, decline, pause, and resume operations.
 */
export function CatalogTable({
  channels,
  filter,
}: {
  channels: Channel[];
  filter: CatalogFilter;
}) {
  const shown = channels.filter((c) => {
    switch (filter) {
      case "all":
        return true;
      case "paused":
        return c.paused;
      case "approved":
        return c.status === "approved" && !c.paused;
      default:
        return c.status === filter;
    }
  });

  return (
    <>
      <h3>
        All channels ({shown.length}
        {filter !== "all" && ` of ${channels.length}, ${filter}`})
      </h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>State</th>
              <th>Episodes</th>
              <th>Last ingested</th>
              <th>Latest run</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const m = c.management;
              const tracked = m
                ? m.episodes.processed +
                  m.episodes.pending +
                  m.episodes.processing +
                  m.episodes.noTranscript +
                  m.episodes.failed
                : c.processedCount;
              return (
                <tr key={c.channelId}>
                  <td class="wrap">
                    <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
                  </td>
                  <td>
                    {CHANNEL_STATUS_COPY[c.status]}
                    {c.paused && " · paused"}
                  </td>
                  <td>
                    {c.processedCount} / {tracked}
                    {m && m.episodes.noTranscript > 0 && (
                      <span class="muted">
                        {" "}
                        · {m.episodes.noTranscript} no captions
                      </span>
                    )}
                    {m && m.episodes.failed > 0 && (
                      <span class="muted"> · {m.episodes.failed} failed</span>
                    )}
                  </td>
                  <td>
                    <Time at={c.lastIngestedAt} />
                  </td>
                  <td>
                    {m?.latestRun
                      ? `${m.latestRun.kind} · ${m.latestRun.status}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
