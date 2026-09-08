import type { Channel } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { api } from "../api";
import { CHANNEL_STATUS_COPY, failureCopy } from "../lib/copy";
import { duration } from "../lib/time";
import type { CatalogFilter } from "./CatalogHealth";
import { Time } from "./Time";

/**
 * Needs attention (spec §7.3) and the all-channels table (§7.4) from GET /channels?scope=all, whose
 * rows carry the owner-only `management` block. Actions mirror the Registry's rules; the API is the
 * guard. Delete is the one action that asks first.
 */
export function CatalogTable({
  channels,
  filter,
  onChanged,
}: {
  channels: Channel[];
  filter: CatalogFilter;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function act(channelId: string, work: () => Promise<unknown>) {
    setBusy((current) => new Set(current).add(channelId));
    setError(null);
    try {
      await work();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(channelId);
        return next;
      });
    }
  }

  const failed = channels.filter(
    (c) => c.status === "failed" && c.deletedAt === null,
  );
  const stuck = channels.filter((c) => c.management?.stuckPending === true);
  const shown = channels.filter((c) => {
    switch (filter) {
      case "all":
        return true;
      case "deleted":
        return c.deletedAt !== null;
      default:
        return c.deletedAt === null && c.status === filter;
    }
  });

  const retryButton = (c: Channel) => (
    <button
      type="button"
      disabled={busy.has(c.channelId)}
      onClick={() => act(c.channelId, () => api.retryChannel(c.channelId))}
    >
      Retry
    </button>
  );

  return (
    <>
      <h3 id="attention">Needs attention ({failed.length + stuck.length})</h3>
      {failed.length + stuck.length === 0 && (
        <p class="muted">Nothing needs attention.</p>
      )}
      {failed.map((c) => (
        <div class="row" key={`failed-${c.channelId}`}>
          <div class="grow">
            <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
            <div class="meta">
              Failed · {failureCopy(c.failureCode)}
              {c.management?.failureDetail &&
                ` (${c.management.failureDetail})`}{" "}
              · <Time at={c.management?.updatedAt ?? null} />
              {c.management?.latestRun &&
                ` · last run: ${c.management.latestRun.kind}, ${c.management.latestRun.status}`}
            </div>
          </div>
          <div class="actions">{retryButton(c)}</div>
        </div>
      ))}
      {stuck.map((c) => (
        <div class="row" key={`stuck-${c.channelId}`}>
          <div class="grow">
            <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
            <div class="meta">
              Pending for {duration(c.management?.createdAt ?? Date.now())}, no
              run
            </div>
          </div>
        </div>
      ))}

      <h3>
        All channels ({shown.length}
        {filter !== "all" && ` of ${channels.length}, ${filter}`})
      </h3>
      {error && <p class="error">{error}</p>}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>State</th>
              <th>Episodes</th>
              <th>Last ingested</th>
              <th>Latest run</th>
              <th>Requesters</th>
              <th>Actions</th>
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
                    {c.deletedAt !== null
                      ? "Deleted"
                      : CHANNEL_STATUS_COPY[c.status]}
                    {c.status === "failed" && c.deletedAt === null && (
                      <span class="muted"> · {failureCopy(c.failureCode)}</span>
                    )}
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
                  <td>{m?.requesterCount ?? 0}</td>
                  <td>
                    <div class="actions">
                      {c.status === "failed" &&
                        c.deletedAt === null &&
                        retryButton(c)}
                      {c.deletedAt === null ? (
                        <button
                          type="button"
                          class="danger"
                          disabled={busy.has(c.channelId)}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${c.title} from the catalog? Follows and content are kept.`,
                              )
                            ) {
                              act(c.channelId, () =>
                                api.deleteChannel(c.channelId),
                              );
                            }
                          }}
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy.has(c.channelId)}
                          onClick={() =>
                            act(c.channelId, () =>
                              api.restoreChannel(c.channelId),
                            )
                          }
                        >
                          Restore
                        </button>
                      )}
                    </div>
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
