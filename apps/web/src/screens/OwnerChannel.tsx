import type { Channel } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import { api } from "../api";
import { Nav } from "../components/Nav";
import { Time } from "../components/Time";
import {
  CATALOG_STATE_COPY,
  CHANNEL_STATUS_COPY,
  failureCopy,
} from "../lib/copy";
import { type Load, useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function OwnerChannel() {
  return (
    <Guard ownerOnly>
      <OwnerChannelScreen />
    </Guard>
  );
}

/** One channel for the owner (spec §8): management header, episodes, runs, requests. */
function OwnerChannelScreen() {
  const { params } = useRoute();
  const channelId = params.id ?? "";
  const [channel, reloadChannel] = useLoad(
    () => api.getChannel(channelId),
    [channelId],
  );
  const [episodes, reloadEpisodes] = useLoad(
    () => api.listEpisodes(channelId, 200),
    [channelId],
  );
  const [runs, reloadRuns] = useLoad(
    () => api.listIngestionRuns(channelId),
    [channelId],
  );
  const [requests, reloadRequests] = useLoad(
    () => api.listChannelRequestsFor(channelId),
    [channelId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      reloadChannel();
      reloadEpisodes();
      reloadRuns();
      reloadRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="wide">
      <Nav />
      <p>
        <a href="/owner">← Owner</a>
      </p>
      <Section load={channel} label="the channel" reload={reloadChannel}>
        {({ channel: c }) => <Header channel={c} busy={busy} act={act} />}
      </Section>
      {error && <p class="error">{error}</p>}

      <h2>Episodes</h2>
      <Section load={episodes} label="episodes" reload={reloadEpisodes}>
        {({ episodes: list }) =>
          list.length === 0 ? (
            <p class="muted">No episodes yet.</p>
          ) : (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Published</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Failure</th>
                    <th>Chunks</th>
                    <th>Summary</th>
                    <th>Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.videoId}>
                      <td class="wrap">
                        <a href={`https://youtu.be/${e.videoId}`}>{e.title}</a>
                      </td>
                      <td>
                        <Time at={e.publishedAt} />
                      </td>
                      <td>{e.status.replace("_", " ")}</td>
                      <td>{e.processing?.attemptCount ?? "—"}</td>
                      <td>{e.processing?.failureCode ?? "—"}</td>
                      <td>{e.processing?.chunkCount ?? "—"}</td>
                      <td>{e.summary?.format ?? "—"}</td>
                      <td>
                        <Time at={e.processing?.processedAt ?? null} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Section>

      <h2>Runs</h2>
      <Section load={runs} label="ingestion runs" reload={reloadRuns}>
        {({ runs: list }) =>
          list.length === 0 ? (
            <p class="muted">No runs yet.</p>
          ) : (
            <div>
              {list.map((run) => (
                <details key={run.runId}>
                  <summary>
                    {run.kind} · {run.status} · started{" "}
                    <Time at={run.startedAt} /> · finished{" "}
                    <Time at={run.finishedAt} />
                    {run.failureCode && ` · ${run.failureCode}`}
                    {run.episodeLimit !== null &&
                      ` · limit ${run.episodeLimit}`}
                    {` · lifecycle v${run.lifecycleVersion}`}
                  </summary>
                  {run.failureDetail && (
                    <p class="muted">{run.failureDetail}</p>
                  )}
                  {run.episodes.length === 0 ? (
                    <p class="muted">No episode outcomes recorded.</p>
                  ) : (
                    <ul>
                      {run.episodes.map((re) => (
                        <li key={re.videoId}>
                          {re.videoId} · {re.status.replace("_", " ")}
                          {re.failureCode && ` · ${re.failureCode}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}
            </div>
          )
        }
      </Section>

      <h2>Requests</h2>
      <Section load={requests} label="requests" reload={reloadRequests}>
        {({ requests: list }) =>
          list.length === 0 ? (
            <p class="muted">Nobody has requested this channel.</p>
          ) : (
            <div>
              {list.map((r) => (
                <div class="row" key={r.requestId}>
                  <div class="grow">
                    {r.userEmail} · {r.status}
                    <div class="meta">
                      requested <Time at={r.createdAt} />
                      {r.reviewedAt !== null && (
                        <>
                          {" "}
                          · reviewed <Time at={r.reviewedAt} /> by{" "}
                          {r.reviewedByEmail}
                        </>
                      )}
                      {r.ownerExplanation && ` — "${r.ownerExplanation}"`}
                      {r.status === "approved" &&
                        (r.autoFollowCompletedAt !== null
                          ? " · followed automatically"
                          : " · follow not yet delivered")}
                      {` · ${CATALOG_STATE_COPY[r.channel.state]}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </Section>
    </main>
  );
}

function Header({
  channel: c,
  busy,
  act,
}: {
  channel: Channel;
  busy: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const m = c.management;
  return (
    <>
      <h1>{c.title}</h1>
      <p class="muted">
        <a href={c.canonicalUrl}>{c.channelId}</a> ·{" "}
        {c.deletedAt !== null ? "Deleted" : CHANNEL_STATUS_COPY[c.status]}
        {c.status === "failed" && ` · ${failureCopy(c.failureCode)}`}
        {m?.failureDetail && ` (${m.failureDetail})`}
        {m && ` · available since `}
        {m && <Time at={m.availableAt} fallback="never" />}
        {m &&
          ` · lifecycle v${m.lifecycleVersion} · import count ${m.initialImportCount}`}
        {m &&
          ` · ${m.requesterCount} requester${m.requesterCount === 1 ? "" : "s"}`}
      </p>
      <div class="actions">
        {c.status === "failed" && c.deletedAt === null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.retryChannel(c.channelId))}
          >
            Retry
          </button>
        )}
        {c.deletedAt === null ? (
          <button
            type="button"
            class="danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${c.title} from the catalog? Follows and content are kept.`,
                )
              ) {
                act(() => api.deleteChannel(c.channelId));
              }
            }}
          >
            Delete
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.restoreChannel(c.channelId))}
          >
            Restore
          </button>
        )}
      </div>
    </>
  );
}

/** Loading and error handling for one section; children render only with data (spec §11). */
function Section<T>({
  load,
  label,
  reload,
  children,
}: {
  load: Load<T>;
  label: string;
  reload: () => void;
  children: (data: T) => preact.JSX.Element;
}) {
  if (load.status === "loading") return <p>Loading…</p>;
  if (load.status === "error") {
    return (
      <p class="error">
        Couldn't load {label}: {load.error.message}.{" "}
        <button type="button" onClick={reload}>
          Retry
        </button>
      </p>
    );
  }
  return children(load.data);
}
