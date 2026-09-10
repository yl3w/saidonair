import type { Channel } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { channelStateCopy } from "../lib/copy";
import { type Act, AttentionList } from "./AttentionList";
import type { CatalogFilter } from "./CatalogHealth";
import { ChannelStatusActions } from "./ChannelStatusActions";
import { Time } from "./Time";

/**
 * The owner's needs-attention list and the all-channels table (spec §7): failed episodes grouped
 * by channel with Retry and Skip, approved channels never started as information, and the table
 * of every channel with the actions its status allows.
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
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const act: Act = async (channelId, work) => {
    setBusy((b) => ({ ...b, [channelId]: true }));
    setErrors((e) => ({ ...e, [channelId]: "" }));
    try {
      await work();
      onChanged();
    } catch (caught) {
      setErrors((e) => ({
        ...e,
        [channelId]: caught instanceof Error ? caught.message : String(caught),
      }));
    } finally {
      setBusy((b) => ({ ...b, [channelId]: false }));
    }
  };

  return (
    <>
      <AttentionList
        channels={channels}
        busy={busy}
        errors={errors}
        act={act}
      />
      <AllChannelsTable
        channels={channels}
        filter={filter}
        busy={busy}
        errors={errors}
        act={act}
      />
    </>
  );
}

/** **All channels** (spec §7): every channel, with the actions its status allows. */
function AllChannelsTable({
  channels,
  filter,
  busy,
  errors,
  act,
}: {
  channels: Channel[];
  filter: CatalogFilter;
  busy: Record<string, boolean>;
  errors: Record<string, string>;
  act: Act;
}) {
  const shown = channels.filter((c) => {
    if (filter === "all") return true;
    if (filter === "paused") return c.status === "approved" && c.paused;
    return c.status === filter;
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
              <th>Followers</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const m = c.management;
              return (
                <tr key={c.channelId}>
                  <td class="wrap">
                    <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
                  </td>
                  <td>{channelStateCopy(c)}</td>
                  <td>
                    {c.episodes.available} / {c.episodes.tracked}
                    {c.episodes.skipped > 0 && (
                      <span class="muted"> · {c.episodes.skipped} skipped</span>
                    )}
                    {c.episodes.failed > 0 && (
                      <span class="muted"> · {c.episodes.failed} failed</span>
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
                  <td>{c.followerCount}</td>
                  <td>
                    <ChannelStatusActions
                      channel={c}
                      busy={busy[c.channelId] ?? false}
                      idPrefix=""
                      act={(work) => act(c.channelId, work)}
                    />
                    {errors[c.channelId] && (
                      <p class="error">{errors[c.channelId]}</p>
                    )}
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
