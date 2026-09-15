import type { Channel, ChannelFeed } from "@media-digest/shared";
import { CircleAlert } from "lucide-preact";
import { useState } from "preact/hooks";
import { api } from "../api";
import {
  actionErrorCopy,
  CHANNEL_ID_HELP,
  channelStateCopy,
  feedVerdict,
  newestUploadCopy,
} from "../lib/copy";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

type Step =
  | { name: "paste" }
  | { name: "verify"; feed: ChannelFeed; channel: Channel | null }
  | { name: "done"; message: string };

/**
 * Adding a channel is three steps (docs/specs/design-phase.md §4.6): paste an id, see what its feeds
 * actually say, then decide. The middle step exists because the decision is not obvious from an id —
 * a channel whose newest fifteen uploads are all Shorts produces no episodes at all, and only its
 * feed can say so.
 *
 * The API has no owner shortcut (docs/PRD.md §9), so the owner's one-step approval is this component
 * adding and then approving, with the title, import count and note it was given. A reader files a
 * request instead, which is the same add without the approval.
 */
export function AddChannel({
  isOwner,
  onChanged,
}: {
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<Step>({ name: "paste" });
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [importCount, setImportCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function restart() {
    setStep({ name: "paste" });
    setPasted("");
    setTitle("");
    setImportCount("");
    setNote("");
    setError(null);
  }

  async function verify(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { feed, channel } = await api.readChannelFeed(pasted.trim());
      setTitle(feed.title);
      setStep({ name: "verify", feed, channel });
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setBusy(false);
    }
  }

  /** The decision. An owner approves in the same breath; a reader's add is the request. */
  async function decide(feed: ChannelFeed) {
    setBusy(true);
    setError(null);
    try {
      const chosen = title.trim();
      const count = Number.parseInt(importCount, 10);
      await api.addChannel({
        channelId: feed.channelId,
        ...(isOwner && chosen.length > 0 && chosen !== feed.title
          ? { title: chosen }
          : {}),
        ...(isOwner && Number.isInteger(count) && count > 0
          ? { initialImportCount: count }
          : {}),
      });
      if (isOwner) {
        await api.approveChannel(feed.channelId, {
          ...(note.trim().length > 0 ? { explanation: note.trim() } : {}),
        });
      }
      setStep({
        name: "done",
        message: isOwner
          ? `${chosen.length > 0 ? chosen : feed.title} is approved and you are following it. Its first episodes are on their way.`
          : `${feed.title} is requested and you are following it. It will start producing summaries once the owner approves it.`,
      });
      onChanged();
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setBusy(false);
    }
  }

  /** Following an id the catalog already holds is the same decision, without the add. */
  async function follow(feed: ChannelFeed) {
    setBusy(true);
    setError(null);
    try {
      await api.follow(feed.channelId);
      setStep({
        name: "done",
        message: `You are following ${feed.title}.`,
      });
      onChanged();
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="rounded border border-edge bg-panel p-4">
      <h2 class="font-serif text-section font-semibold text-ink">
        Add a channel
      </h2>

      {step.name === "paste" && (
        <form class="mt-3" onSubmit={verify}>
          <label
            class="block text-label uppercase text-ink-3"
            for="add-channel"
          >
            Channel id
          </label>
          <div class="mt-2 flex flex-wrap gap-2">
            <input
              id="add-channel"
              type="text"
              class="input min-h-11 flex-1 border-edge bg-panel text-ui text-ink"
              placeholder="UC…"
              value={pasted}
              onInput={(event) => {
                setPasted(event.currentTarget.value);
                setError(null);
              }}
            />
            <button
              type="submit"
              class="btn min-h-11 border-edge bg-panel text-ui text-primary"
              disabled={busy || pasted.trim().length === 0}
            >
              {busy ? "Reading its feed…" : "Check it"}
            </button>
          </div>
          <p class="mt-2 font-serif text-excerpt text-ink-2">
            {CHANNEL_ID_HELP}
          </p>
        </form>
      )}

      {step.name === "verify" && (
        <div class="mt-3">
          <div class="flex items-center gap-3">
            <Avatar id={step.feed.channelId} name={step.feed.title} size={34} />
            <div class="min-w-0">
              <p class="font-serif text-row-compact font-semibold text-ink">
                {step.feed.title}
              </p>
              <p class="text-meta text-ink-3">{step.feed.channelId}</p>
            </div>
          </div>

          <p class="mt-3 font-serif text-excerpt text-ink-2">
            {feedVerdict(step.feed)}
          </p>
          <p class="mt-1 text-meta text-ink-3">
            {newestUploadCopy(step.feed.newestLongFormAt)}
          </p>

          {step.feed.longFormCount === 0 && (
            <p class="mt-3 flex items-start gap-2 text-ui text-owner">
              <Icon of={CircleAlert} size={16} />
              Adding it is allowed; expect nothing to read.
            </p>
          )}

          {step.channel !== null && (
            <p class="mt-3 text-ui text-ink-2">
              The catalog already has this one: {channelStateCopy(step.channel)}
              .
            </p>
          )}

          {isOwner && step.channel === null && (
            <div class="mt-4 flex flex-col gap-3 border-t border-rule pt-3">
              <Field
                id="add-title"
                label="Title"
                value={title}
                onInput={setTitle}
              />
              <Field
                id="add-import"
                label="Import how many"
                value={importCount}
                placeholder="the default"
                onInput={setImportCount}
              />
              <Field
                id="add-note"
                label="Note"
                value={note}
                placeholder="why you approved it"
                onInput={setNote}
              />
            </div>
          )}

          <div class="mt-4 flex flex-wrap gap-2">
            {step.channel === null ? (
              <button
                type="button"
                class="btn min-h-11 border-edge bg-panel text-ui text-primary"
                disabled={busy}
                onClick={() => decide(step.feed)}
              >
                {busy
                  ? "Adding…"
                  : isOwner
                    ? "Approve and follow"
                    : "Request and follow"}
              </button>
            ) : step.channel.status === "declined" ? (
              <a
                class="btn min-h-11 border-edge bg-panel text-ui text-primary"
                href={`/sources/${step.channel.channelId}`}
              >
                See why it was declined
              </a>
            ) : step.channel.following ? (
              <a
                class="btn min-h-11 border-edge bg-panel text-ui text-primary"
                href={`/sources/${step.channel.channelId}`}
              >
                You already follow it — open it
              </a>
            ) : (
              <button
                type="button"
                class="btn min-h-11 border-edge bg-panel text-ui text-primary"
                disabled={busy}
                onClick={() => follow(step.feed)}
              >
                {busy ? "Following…" : "Follow it"}
              </button>
            )}
            <button
              type="button"
              class="btn min-h-11 border-edge bg-panel text-ui text-ink-2"
              disabled={busy}
              onClick={restart}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {step.name === "done" && (
        <div class="mt-3">
          <p class="font-serif text-body text-ink">{step.message}</p>
          <button
            type="button"
            class="btn mt-3 min-h-11 border-edge bg-panel text-ui text-primary"
            onClick={restart}
          >
            Add another
          </button>
        </div>
      )}

      {error !== null && <p class="mt-3 text-ui text-consequence">{error}</p>}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  placeholder,
  onInput,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onInput: (value: string) => void;
}) {
  return (
    <div>
      <label class="block text-label uppercase text-ink-3" for={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        class="input mt-1 min-h-11 w-full border-edge bg-panel text-ui text-ink"
        value={value}
        placeholder={placeholder}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
    </div>
  );
}
