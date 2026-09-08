import type {
  ChannelRequest,
  ChannelRequestsResponse,
  RequestOutcome,
} from "@media-digest/shared";
import { useEffect, useState } from "preact/hooks";
import { ApiError, api } from "../api";
import { CHANNEL_ID_HELP, outcomeCopy } from "../lib/copy";
import type { Load } from "../lib/use-load";
import { Time } from "./Time";

const POLL_MS = 15_000;
const IN_FLIGHT: ReadonlySet<RequestOutcome> = new Set([
  "awaiting_review",
  "importing",
  "approved_pending_follow",
]);

/**
 * The caller's own channel requests plus the request form (spec §6.4). Polls every 15 s only while
 * a request is in flight. A URL for an already-available channel gets a Follow button, not a request.
 */
export function Requests({
  load,
  reload,
  onFollow,
}: {
  load: Load<ChannelRequestsResponse>;
  reload: () => void;
  onFollow: (channelId: string) => Promise<void>;
}) {
  const requests = load.status === "ready" ? load.data.requests : [];
  const inFlight = requests.some((r) => IN_FLIGHT.has(r.outcome));

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, reload]);

  return (
    <section id="requests">
      <h3>Your requests ({requests.length})</h3>
      {load.status === "loading" && <p>Loading…</p>}
      {load.status === "error" && (
        <p class="error">
          Couldn't load your requests: {load.error.message}.{" "}
          <button type="button" onClick={reload}>
            Retry
          </button>
        </p>
      )}
      {load.status === "ready" && requests.length === 0 && (
        <p class="muted">No requests yet.</p>
      )}
      {requests.map((request) => (
        <RequestRow key={request.requestId} request={request} />
      ))}
      <RequestForm onSubmitted={reload} onFollow={onFollow} />
    </section>
  );
}

function RequestRow({ request }: { request: ChannelRequest }) {
  return (
    <div class="row">
      <div class="grow">
        {request.outcome === "following" ? (
          <a href={`/channel/${request.channelId}`}>
            {request.channelTitle ?? request.channelId}
          </a>
        ) : (
          <span>{request.channelTitle ?? request.channelId}</span>
        )}
        <span class="meta"> · {request.channelId}</span>
        <div class="meta">
          {outcomeCopy(request)}
          {request.ownerExplanation && ` — "${request.ownerExplanation}"`} ·{" "}
          <Time at={request.createdAt} />
        </div>
      </div>
    </div>
  );
}

function RequestForm({
  onSubmitted,
  onFollow,
}: {
  onSubmitted: () => void;
  onFollow: (channelId: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [alreadyAvailable, setAlreadyAvailable] = useState<string | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setAlreadyAvailable(null);
    try {
      await api.createChannelRequest({ channelId: value });
      setValue("");
      onSubmitted();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const body = error.body as { channelId?: unknown } | null;
        setAlreadyAvailable(
          typeof body?.channelId === "string" ? body.channelId : null,
        );
        setMessage("Already in the catalog.");
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="inline" onSubmit={submit}>
      <label>
        Request a channel{" "}
        <input
          type="text"
          value={value}
          placeholder="UC… channel id"
          onInput={(event) => setValue(event.currentTarget.value)}
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy || value.trim().length === 0}>
        Request
      </button>
      <span class="help">{CHANNEL_ID_HELP}</span>
      {message && (
        <span class={alreadyAvailable ? "" : "error"}>
          {message}{" "}
          {alreadyAvailable && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onFollow(alreadyAvailable);
                  setMessage(null);
                  setAlreadyAvailable(null);
                  setValue("");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Follow
            </button>
          )}
        </span>
      )}
    </form>
  );
}
