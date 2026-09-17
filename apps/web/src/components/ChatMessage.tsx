import type { ChatMessage as Message } from "@media-digest/shared";
import {
  ANSWER_SHORTENED_COPY,
  chatFailureCopy,
  chatScopeCopy,
  TRY_AGAIN_COPY,
} from "../lib/copy";
import { SourceCards } from "./SourceCards";

/**
 * One message (docs/specs/m4-3-chat-web.md §3.3). **Roles sit in a left gutter, not in bubbles** —
 * a label at the design's 12 px floor, the message beside it. On a phone the gutter does not fit, so
 * the label moves above the message rather than becoming an alignment: a right-aligned bubble would
 * be §4.9's rule broken to save 64 px, and alignment is state carried by position, which §4.10 asks
 * words to carry instead.
 *
 * A question shows the scope it was sent under, or nothing when it was global. **Scope belongs to
 * the message, never to the chat**, so two questions in one conversation can differ and an old one
 * keeps its mark after the channel is unfollowed.
 */
export function ChatMessage({
  message,
  episodeTitle,
  onRetry,
  retrying,
}: {
  message: Message;
  /** The title of the episode this question was scoped to, when it is known. */
  episodeTitle: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const scope = chatScopeCopy(message.aboutEpisodeId, episodeTitle);

  return (
    <div class="mb-6 md:flex md:gap-5">
      <span class="mb-1.5 block text-label uppercase text-ink-3 md:mb-0 md:w-16 md:shrink-0 md:pt-1">
        {message.role === "user" ? "You" : "Answer"}
      </span>

      <div class="min-w-0 md:flex-1">
        {scope !== null && (
          <span class="mb-1.5 block text-meta text-ink-3">{scope}</span>
        )}

        {message.status === "pending" && (
          <div class="flex flex-col gap-2">
            <div class="skeleton h-4 w-full" />
            <div class="skeleton h-4 w-4/5" />
          </div>
        )}

        {message.status === "failed" && (
          <>
            <p class="font-reading text-body text-ink-2">
              {chatFailureCopy(message.failureCode)}
            </p>
            {onRetry !== undefined && (
              <button
                type="button"
                class="btn btn-quiet mt-3"
                disabled={retrying === true}
                onClick={onRetry}
              >
                {retrying === true ? "…" : TRY_AGAIN_COPY}
              </button>
            )}
          </>
        )}

        {message.status === "completed" && (
          <>
            <p class="whitespace-pre-wrap font-reading text-body text-ink">
              {linkify(message.content)}
            </p>
            {message.truncated === true && (
              <span class="mt-3 block border-t border-rule pt-2.5 text-meta text-ink-3">
                {ANSWER_SHORTENED_COPY}
              </span>
            )}
            <SourceCards sources={message.sources} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * **Only `youtube.com` URLs become links** (docs/PRD.md §7). An answer is the model's prose, so
 * anything else it writes that looks like a URL is left as text rather than made clickable.
 */
const YOUTUBE_URL = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/\S+)/g;

function linkify(text: string) {
  return text.split(YOUTUBE_URL).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} class="link link-hover link-primary" href={part}>
        {part}
      </a>
    ) : (
      part
    ),
  );
}
