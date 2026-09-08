import type { Episode } from "@media-digest/shared";
import { Time } from "./Time";

/**
 * One episode as a reader sees it: title linked to YouTube, byline, the shared summary when the
 * API returned one, related titles (already filtered to the reader's eligible channels). Text only;
 * youtube.com is the only host ever linked (AGENTS.md → Web UI).
 */
export function EpisodeItem({
  episode,
  showChannel = true,
}: {
  episode: Episode;
  showChannel?: boolean;
}) {
  const { summary } = episode;
  return (
    <article class="episode">
      <div>
        {episode.wasUnread === true && <span class="new">NEW</span>}
        <a href={`https://youtu.be/${episode.videoId}`}>{episode.title}</a>
        {episode.status !== "processed" && (
          <span class="tag"> · {episode.status.replace("_", " ")}</span>
        )}
      </div>
      <div class="byline">
        {showChannel && (
          <>
            <a href={`/channel/${episode.channelId}`}>{episode.channelTitle}</a>{" "}
            ·{" "}
          </>
        )}
        <Time at={episode.publishedAt} />
        {summary?.format === "raw_fallback" && " · unformatted summary"}
      </div>
      {summary?.format === "structured" && (
        <>
          <p>{summary.executiveSummary}</p>
          <ul>
            {summary.takeaways.map((takeaway) => (
              <li key={takeaway}>{takeaway}</li>
            ))}
          </ul>
          {summary.topicTags.length > 0 && (
            <p class="muted">tags: {summary.topicTags.join(", ")}</p>
          )}
        </>
      )}
      {summary?.format === "raw_fallback" && <pre>{summary.rawText}</pre>}
      {episode.related.length > 0 && (
        <p class="muted">
          Related:{" "}
          {episode.related.map((related, i) => (
            <span key={related.videoId}>
              {i > 0 && ", "}
              <a href={`https://youtu.be/${related.videoId}`}>
                {related.title}
              </a>
            </span>
          ))}
        </p>
      )}
    </article>
  );
}
