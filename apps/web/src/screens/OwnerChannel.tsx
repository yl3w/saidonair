import type { Channel } from "@media-digest/shared";
import { useRoute } from "preact-iso";
import { api } from "../api";
import { Nav } from "../components/Nav";
import { Time } from "../components/Time";
import { CHANNEL_STATUS_COPY } from "../lib/copy";
import { type Load, useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function OwnerChannel() {
  return (
    <Guard ownerOnly>
      <OwnerChannelScreen />
    </Guard>
  );
}

/** One channel for the owner (spec §8): management header, episodes, runs. */
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
  return (
    <main class="wide">
      <Nav />
      <p>
        <a href="/owner">← Owner</a>
      </p>
      <Section load={channel} label="the channel" reload={reloadChannel}>
        {({ channel: c }) => <Header channel={c} />}
      </Section>

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
                      <td>
                        {e.processing?.skipReason ??
                          e.processing?.failureCode ??
                          "—"}
                      </td>
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
    </main>
  );
}

/** Display only for now; Task 10 adds approve, decline, pause, and resume here. */
function Header({ channel: c }: { channel: Channel }) {
  const m = c.management;
  return (
    <>
      <h1>{c.title}</h1>
      <p class="muted">
        <a href={c.canonicalUrl}>{c.channelId}</a> ·{" "}
        {CHANNEL_STATUS_COPY[c.status]}
        {c.paused && ` · paused${c.pausedBy ? ` by ${c.pausedBy}` : ""}`}
        {c.reviewNote && ` · ${c.reviewNote}`}
        {" · approved since "}
        <Time at={c.approvedAt} fallback="never" />
        {m &&
          ` · lifecycle v${m.lifecycleVersion} · import count ${m.initialImportCount}`}
      </p>
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
