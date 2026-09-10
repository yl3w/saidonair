import { useState } from "preact/hooks";
import { api } from "../api";
import { CHANNEL_ID_HELP } from "../lib/copy";

/** Owner add (spec §7.4): id verified against its feed by the API, feed title unless given. */
export function AddChannel({ onChanged }: { onChanged: () => void }) {
  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState("");
  const [importCount, setImportCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addChannel({
        channelId,
        title: title.trim() || undefined,
        initialImportCount: Number.parseInt(importCount, 10) || undefined,
      });
      setChannelId("");
      setTitle("");
      setImportCount("5");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Add a channel</h3>
      <form class="inline" onSubmit={submit}>
        <label>
          channel id{" "}
          <input
            type="text"
            value={channelId}
            placeholder="UC… id or /channel/UC… URL"
            onInput={(e) => setChannelId(e.currentTarget.value)}
            disabled={busy}
          />
        </label>
        <label>
          title (from the feed if empty){" "}
          <input
            type="text"
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            disabled={busy}
          />
        </label>
        <label>
          import count{" "}
          <input
            type="number"
            min="1"
            value={importCount}
            onInput={(e) => setImportCount(e.currentTarget.value)}
            disabled={busy}
          />
        </label>
        <button type="submit" disabled={busy || channelId.trim().length === 0}>
          Add
        </button>
        <span class="help">{CHANNEL_ID_HELP}</span>
      </form>
      {error && <p class="error">{error}</p>}
    </>
  );
}
