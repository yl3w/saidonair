import type { Channel, Follower } from "@media-digest/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { reviewCopy } from "../lib/copy";
import { Time } from "./Time";

/** The owner's review queue (spec §7): requested channels oldest first, with who is waiting. */
export function RequestQueue({
  channels,
  onChanged,
}: {
  channels: Channel[];
  onChanged: () => void;
}) {
  const waiting = channels
    .filter((c) => c.status === "requested")
    .sort(
      (a, b) => (a.management?.createdAt ?? 0) - (b.management?.createdAt ?? 0),
    );
  return (
    <section id="requests">
      <h2>Queue</h2>
      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 && <p class="muted">Nothing waiting for review.</p>}
      {waiting.map((c) => (
        <WaitingRow key={c.channelId} channel={c} onChanged={onChanged} />
      ))}
    </section>
  );
}

function WaitingRow({
  channel: c,
  onChanged,
}: {
  channel: Channel;
  onChanged: () => void;
}) {
  const [followers, setFollowers] = useState<Follower[] | null>(null);
  const [mode, setMode] = useState<"closed" | "approve" | "decline">("closed");
  const [title, setTitle] = useState(c.title);
  const [importCount, setImportCount] = useState(
    String(c.management?.initialImportCount ?? 5),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listFollowers(c.channelId).then(
      ({ followers }) => {
        if (!cancelled) setFollowers(followers);
      },
      () => {
        if (!cancelled) setFollowers([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [c.channelId]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMode("closed");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const previous =
    c.reviewedAt !== null
      ? `previously ${reviewCopy({ ...c, status: "declined" })?.toLowerCase()}`
      : null;
  return (
    <div class="row">
      <div class="grow">
        <strong>{c.title}</strong> <a href={c.canonicalUrl}>{c.channelId}</a>
        <div class="meta">
          requested <Time at={c.management?.createdAt ?? null} />
          {followers === null
            ? " · loading followers"
            : followers.length === 0
              ? " · nobody is waiting"
              : ` · requested by ${followers.map((f) => f.email).join(", ")}`}
          {previous && ` · ${previous}`}
        </div>
        {mode === "approve" && (
          <form
            class="inline"
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api.approveChannel(c.channelId, {
                  title: title.trim() || undefined,
                  initialImportCount:
                    Number.parseInt(importCount, 10) || undefined,
                  explanation: note.trim() || undefined,
                }),
              );
            }}
          >
            <label>
              title{" "}
              <input
                id={`approve-title-${c.channelId}`}
                type="text"
                value={title}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </label>
            <label>
              import count{" "}
              <input
                id={`approve-count-${c.channelId}`}
                type="number"
                min="1"
                value={importCount}
                onInput={(e) => setImportCount(e.currentTarget.value)}
              />
            </label>
            <label>
              note (optional){" "}
              <input
                id={`approve-note-${c.channelId}`}
                type="text"
                value={note}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>
            <button
              id={`approve-confirm-${c.channelId}`}
              type="submit"
              disabled={busy}
            >
              Confirm approval
            </button>
          </form>
        )}
        {mode === "decline" && (
          <form
            class="inline"
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api.declineChannel(c.channelId, {
                  explanation: note.trim() || undefined,
                }),
              );
            }}
          >
            <label>
              note (optional){" "}
              <input
                id={`decline-note-${c.channelId}`}
                type="text"
                value={note}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>
            <button
              id={`decline-confirm-${c.channelId}`}
              type="submit"
              class="danger"
              disabled={busy}
            >
              Confirm decline
            </button>
          </form>
        )}
        {error && <p class="error">{error}</p>}
      </div>
      <div class="actions">
        <button
          id={`queue-approve-${c.channelId}`}
          type="button"
          disabled={busy}
          onClick={() => setMode(mode === "approve" ? "closed" : "approve")}
        >
          Approve
        </button>
        <button
          id={`queue-decline-${c.channelId}`}
          type="button"
          class="danger"
          disabled={busy}
          onClick={() => setMode(mode === "decline" ? "closed" : "decline")}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
