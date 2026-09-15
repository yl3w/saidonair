import type { Channel } from "@media-digest/shared";
import { useState } from "preact/hooks";
import { api } from "../api";
import { actionErrorCopy, decisionCopy, reviewCopy } from "../lib/copy";
import { relativeTime } from "../lib/time";
import { useLoad } from "../lib/use-load";
import { Action } from "./ChannelStatusActions";
import { Retry } from "./Retry";

/**
 * The channels waiting for a decision: the first thing in **Needs you**, oldest request first, each
 * with who is waiting on it. Never paginates.
 */
export function ReviewQueue({
  waiting,
  disabled,
  onChanged,
}: {
  waiting: Channel[];
  disabled: boolean;
  onChanged: () => void;
}) {
  if (waiting.length === 0) return null;
  return (
    <section class="mt-6">
      <h3 class="flex items-baseline gap-2 text-label uppercase text-ink-3">
        Waiting for review
        <span>{waiting.length}</span>
      </h3>
      <div class="mt-1 border-t border-rule">
        {waiting.map((c) => (
          <WaitingRow
            key={c.channelId}
            channel={c}
            disabled={disabled}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

/** Every decision already made, newest first. A re-requested channel is in Waiting, not here. */
export function ReviewedList({ channels }: { channels: Channel[] }) {
  const reviewed = channels
    .filter((c) => c.status !== "requested" && c.reviewedAt !== null)
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0));
  return (
    <section id="reviewed" class="mt-10">
      <h2 class="flex items-baseline gap-2 font-reading text-section font-semibold text-ink">
        Reviewed
        <span class="text-meta font-normal text-ink-3">{reviewed.length}</span>
      </h2>
      {reviewed.length === 0 ? (
        <p class="mt-2 font-reading text-excerpt text-ink-2">
          No decisions yet.
        </p>
      ) : (
        <div class="mt-2 border-t border-rule">
          {reviewed.map((c) => (
            <div key={c.channelId} class="border-b border-rule py-3">
              <a
                class="text-ui font-semibold text-ink"
                href={`/curate/${c.channelId}`}
              >
                {c.title}
              </a>
              <p class="text-meta text-ink-3">
                {decisionCopy(c)}{" "}
                {c.reviewedAt === null ? "" : relativeTime(c.reviewedAt)}
                {c.management?.reviewedByEmail &&
                  ` by ${c.management.reviewedByEmail}`}
                {c.reviewNote && ` · “${c.reviewNote}”`}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One channel awaiting review. Approve and Decline each open the form that carries what the decision
 * needs — a title, an import count and a note, or just a note — because the decision and its
 * reasoning are one act, not two.
 *
 * Who is waiting is its own load with its own error: a failed request must never read as "nobody is
 * waiting", which is the phrase that argues for Decline.
 */
function WaitingRow({
  channel: c,
  disabled,
  onChanged,
}: {
  channel: Channel;
  disabled: boolean;
  onChanged: () => void;
}) {
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
      setError(actionErrorCopy(caught));
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
    <div class="border-b border-rule py-3">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-ui font-semibold text-ink">{c.title}</p>
          <p class="text-meta text-ink-3">
            <a class="text-primary" href={c.canonicalUrl}>
              {c.channelId}
            </a>
            {c.management?.createdAt !== undefined &&
              ` · requested ${relativeTime(c.management.createdAt)}`}
            {previous && ` · ${previous}`}
          </p>
          <p class="text-meta text-ink-3">
            {followers.status === "loading" && "Loading who is waiting…"}
            {followers.status === "ready" &&
              (followers.data.followers.length === 0
                ? "Nobody is waiting on it."
                : `Requested by ${followers.data.followers.map((f) => f.email).join(", ")}`)}
          </p>
          {followers.status === "error" && (
            <p class="text-meta text-consequence">
              Couldn't load who is waiting: {followers.error.message}.{" "}
              <Retry
                id={`followers-retry-${c.channelId}`}
                onClick={reloadFollowers}
              />
            </p>
          )}
        </div>

        <div class="flex flex-wrap items-center gap-1">
          <Action
            id={`queue-approve-${c.channelId}`}
            busy={busy || disabled}
            onClick={() => setMode(mode === "approve" ? "closed" : "approve")}
          >
            Approve
          </Action>
          <Action
            id={`queue-decline-${c.channelId}`}
            busy={busy || disabled}
            tone="consequence"
            onClick={() => setMode(mode === "decline" ? "closed" : "decline")}
          >
            Decline
          </Action>
        </div>
      </div>

      {mode === "approve" && (
        <form
          class="mt-3 flex flex-wrap items-end gap-2 border-t border-rule pt-3"
          onSubmit={(event) => {
            event.preventDefault();
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
          <DecisionField
            id={`approve-title-${c.channelId}`}
            label="Title"
            value={title}
            onInput={setTitle}
          />
          <DecisionField
            id={`approve-count-${c.channelId}`}
            label="Import"
            value={importCount}
            type="number"
            width="w-24"
            onInput={setImportCount}
          />
          <DecisionField
            id={`approve-note-${c.channelId}`}
            label="Note"
            value={note}
            onInput={setNote}
          />
          <button
            id={`approve-confirm-${c.channelId}`}
            type="submit"
            class="btn btn-sm min-h-11 border-edge bg-panel text-ui text-primary"
            disabled={busy || disabled}
          >
            {busy ? "Approving…" : "Confirm approval"}
          </button>
        </form>
      )}

      {mode === "decline" && (
        <form
          class="mt-3 flex flex-wrap items-end gap-2 border-t border-rule pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            act(() =>
              api.declineChannel(c.channelId, {
                explanation: note.trim() || undefined,
              }),
            );
          }}
        >
          <DecisionField
            id={`decline-note-${c.channelId}`}
            label="Note"
            value={note}
            onInput={setNote}
          />
          <button
            id={`decline-confirm-${c.channelId}`}
            type="submit"
            class="btn btn-sm min-h-11 border-consequence bg-panel text-ui text-consequence"
            disabled={busy || disabled}
          >
            {busy ? "Declining…" : "Confirm decline"}
          </button>
        </form>
      )}

      {error !== null && <p class="mt-2 text-meta text-consequence">{error}</p>}
    </div>
  );
}

function DecisionField({
  id,
  label,
  value,
  type = "text",
  width = "w-44",
  onInput,
}: {
  id: string;
  label: string;
  value: string;
  type?: "text" | "number";
  width?: string;
  onInput: (value: string) => void;
}) {
  return (
    <div>
      <label class="block text-label uppercase text-ink-3" for={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        min={type === "number" ? "1" : undefined}
        class={`input mt-1 min-h-11 border-edge bg-panel text-ui text-ink ${width}`}
        value={value}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
    </div>
  );
}
