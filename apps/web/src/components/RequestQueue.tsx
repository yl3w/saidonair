import type { Channel } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { api } from "../api";
import { decisionCopy, reviewCopy } from "../lib/copy";
import { useLoad } from "../lib/use-load";
import { Time } from "./Time";

/**
 * The owner's review queue (spec §7): requested channels oldest first, with who is waiting, then the
 * reviewed history collapsed: every approved or declined channel with its decision, reviewer, time,
 * and note, newest decision first. A re-requested channel is in Waiting, not in the history.
 */
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
  const reviewed = channels
    .filter((c) => c.status !== "requested" && c.reviewedAt !== null)
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0));
  return (
    <section id="requests">
      <h2>Queue</h2>
      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 && <p class="muted">Nothing waiting for review.</p>}
      {waiting.map((c) => (
        <WaitingRow key={c.channelId} channel={c} onChanged={onChanged} />
      ))}
      <details id="reviewed">
        <summary>Reviewed ({reviewed.length})</summary>
        {reviewed.length === 0 && <p class="muted">No decisions yet.</p>}
        {reviewed.map((c) => (
          <ReviewedRow key={c.channelId} channel={c} />
        ))}
      </details>
    </section>
  );
}

/** One past decision: title linked to the owner detail, the decision, when, by whom, and the note. */
function ReviewedRow({ channel: c }: { channel: Channel }) {
  return (
    <div class="row">
      <div class="grow">
        <a href={`/owner/channels/${c.channelId}`}>{c.title}</a>
        <div class="meta">
          {decisionCopy(c)} <Time at={c.reviewedAt} />
          {c.management?.reviewedByEmail &&
            ` by ${c.management.reviewedByEmail}`}
          {c.reviewNote && ` · “${c.reviewNote}”`}
        </div>
      </div>
    </div>
  );
}

function WaitingRow({
  channel: c,
  onChanged,
}: {
  channel: Channel;
  onChanged: () => void;
}) {
  // Who is waiting is its own load with its own error state: a failed request must never read as
  // "nobody is waiting", which is the phrase that argues for Decline.
  const [followers, reloadFollowers] = useLoad(
    () => api.listFollowers(c.channelId),
    [c.channelId],
  );
  const [mode, setMode] = useState<"closed" | "approve" | "decline">("closed");
  const [title, setTitle] = useState(c.title);
  const [importCount, setImportCount] = useState(
    String(c.management?.initialImportCount ?? 5),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The form closes only on success, so a failed decision can be retried as typed; the reload runs
  // either way, since the Registry may have applied the decision before the response was lost.
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMode("closed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onChanged();
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
          {followers.status === "loading" && " · loading followers"}
          {followers.status === "ready" &&
            (followers.data.followers.length === 0
              ? " · nobody is waiting"
              : ` · requested by ${followers.data.followers
                  .map((f) => f.email)
                  .join(", ")}`)}
          {followers.status === "error" && (
            <>
              {" · "}
              <span class="error">
                couldn't load who is waiting: {followers.error.message}.{" "}
                <button
                  id={`followers-retry-${c.channelId}`}
                  type="button"
                  onClick={reloadFollowers}
                >
                  Retry
                </button>
              </span>
            </>
          )}
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
