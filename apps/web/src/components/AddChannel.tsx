import { useState } from "preact/hooks";
import { api } from "../api";
import { CHANNEL_ID_HELP, isDeclinedResponse } from "../lib/copy";
import { absoluteTime } from "../lib/time";

/**
 * One box for everyone (spec §7). A new id creates a requested channel (approved, for the owner) and
 * follows the caller; an existing id follows; a declined id shows the owner's note and offers Request again.
 */
export function AddChannel({ onChanged }: { onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [declined, setDeclined] = useState<{
    channelId: string;
    note: string;
  } | null>(null);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    setDeclined(null);
    try {
      await work();
      setValue("");
      onChanged();
    } catch (error) {
      if (isDeclinedResponse(error)) {
        const { channelId, reviewNote, reviewedAt } = error.body;
        const when =
          reviewedAt === null ? "" : ` on ${absoluteTime(reviewedAt)}`;
        setDeclined({
          channelId,
          note: `Declined${when}${reviewNote ? `: “${reviewNote}”` : ""}`,
        });
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      class="inline"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.addChannel({ channelId: value }));
      }}
    >
      <label>
        Add a channel{" "}
        <input
          id="add-channel-id"
          type="text"
          value={value}
          placeholder="UC… id or /channel/UC… URL"
          onInput={(e) => setValue(e.currentTarget.value)}
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy || value.trim().length === 0}>
        Add
      </button>
      <span class="help">{CHANNEL_ID_HELP}</span>
      {message && <span class="error">{message}</span>}
      {declined && (
        <span>
          {declined.note}.{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => api.requestChannel(declined.channelId))}
          >
            Request again
          </button>
        </span>
      )}
    </form>
  );
}
