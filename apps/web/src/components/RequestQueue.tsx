import type { ChannelRequest } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { api } from "../api";
import { CATALOG_STATE_COPY } from "../lib/copy";
import { Time } from "./Time";

/**
 * The owner's review queue (spec §7.1): pending oldest first with the decision inputs, then the
 * reviewed history collapsed. Approve is refused for a deleted channel; the API is the guard, the
 * disabled button only reflects it.
 */
export function RequestQueue({
  requests,
  onChanged,
}: {
  requests: ChannelRequest[];
  onChanged: () => void;
}) {
  const waiting = requests
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt);
  const reviewed = requests
    .filter((r) => r.status !== "pending")
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0));
  const pendingByChannel = new Map<string, number>();
  for (const r of waiting) {
    pendingByChannel.set(
      r.channelId,
      (pendingByChannel.get(r.channelId) ?? 0) + 1,
    );
  }

  return (
    <section id="requests">
      <h2>Requests</h2>
      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 && <p class="muted">Nothing waiting for review.</p>}
      {waiting.map((request) => (
        <WaitingRow
          key={request.requestId}
          request={request}
          others={(pendingByChannel.get(request.channelId) ?? 1) - 1}
          onChanged={onChanged}
        />
      ))}
      <details>
        <summary>Reviewed ({reviewed.length})</summary>
        {reviewed.map((request) => (
          <div class="row" key={request.requestId}>
            <div class="grow">
              {request.userEmail} · {request.channelTitle ?? request.channelId}
              <div class="meta">
                {request.status} <Time at={request.reviewedAt} /> by{" "}
                {request.reviewedByEmail}
                {request.ownerExplanation && ` — "${request.ownerExplanation}"`}
                {request.status === "approved" &&
                  (request.autoFollowCompletedAt !== null
                    ? " · followed automatically"
                    : " · follow not yet delivered")}
              </div>
            </div>
          </div>
        ))}
      </details>
    </section>
  );
}

function WaitingRow({
  request,
  others,
  onChanged,
}: {
  request: ChannelRequest;
  others: number;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"closed" | "approve" | "reject">("closed");
  const [title, setTitle] = useState(request.channelTitle ?? "");
  const [importCount, setImportCount] = useState("5");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleted = request.channel.state === "deleted";

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

  return (
    <div class="row">
      <div class="grow">
        {request.userEmail} ·{" "}
        <strong>{request.channelTitle ?? "(no title)"}</strong>{" "}
        <a href={`https://www.youtube.com/channel/${request.channelId}`}>
          {request.channelId}
        </a>
        <div class="meta">
          {CATALOG_STATE_COPY[request.channel.state]} ·{" "}
          <Time at={request.createdAt} />
          {others > 0 &&
            ` · also requested by ${others} other${others === 1 ? "" : "s"}`}
          {deleted && " · restore the channel first"}
        </div>
        {mode === "approve" && (
          <form
            class="inline"
            onSubmit={(event) => {
              event.preventDefault();
              act(() =>
                api.approveChannelRequest(request.requestId, {
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
                type="text"
                value={title}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </label>
            <label>
              import count{" "}
              <input
                type="number"
                min="1"
                value={importCount}
                onInput={(e) => setImportCount(e.currentTarget.value)}
              />
            </label>
            <label>
              note (optional){" "}
              <input
                type="text"
                value={note}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              Confirm approval
            </button>
          </form>
        )}
        {mode === "reject" && (
          <form
            class="inline"
            onSubmit={(event) => {
              event.preventDefault();
              act(() =>
                api.rejectChannelRequest(request.requestId, {
                  explanation: note.trim() || undefined,
                }),
              );
            }}
          >
            <label>
              note (optional){" "}
              <input
                type="text"
                value={note}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>
            <button type="submit" class="danger" disabled={busy}>
              Confirm rejection
            </button>
          </form>
        )}
        {error && <p class="error">{error}</p>}
      </div>
      <div class="actions">
        <button
          type="button"
          disabled={busy || deleted}
          onClick={() => setMode(mode === "approve" ? "closed" : "approve")}
        >
          Approve
        </button>
        <button
          type="button"
          class="danger"
          disabled={busy}
          onClick={() => setMode(mode === "reject" ? "closed" : "reject")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
