import { DomainError } from "../errors";

// Canonical YouTube channel ids: "UC" followed by 22 URL-safe base64 characters.
const CHANNEL_ID_SHAPE = /^UC[A-Za-z0-9_-]{22}$/;
// The same id inside a channel URL path, e.g. https://www.youtube.com/channel/UC…/videos.
const CHANNEL_PATH_SHAPE = /\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/;
// YouTube video ids: 11 URL-safe base64 characters.
const VIDEO_ID_SHAPE = /^[A-Za-z0-9_-]{11}$/;

/** Shown whenever someone submits a handle or any other URL (decision 2 in the Home spec). */
export const CHANNEL_ID_INSTRUCTIONS =
  "paste the channel id: on the channel's page open About, then Share channel, then Copy channel ID";

/**
 * Accepts a bare `UC…` id or any URL containing `/channel/UC…` and returns the id. Everything
 * else, including `@handle` and `/c/…` URLs, is rejected with the copy-the-id instructions:
 * there is no handle resolution (docs/PRD.md §4.1).
 */
export function extractChannelId(raw: string): string {
  const input = raw.trim();
  if (CHANNEL_ID_SHAPE.test(input)) return input;
  const match = CHANNEL_PATH_SHAPE.exec(input);
  if (match?.[1]) return match[1];
  throw new DomainError(
    "INVALID_INPUT",
    `not a channel id or /channel/UC… URL; ${CHANNEL_ID_INSTRUCTIONS}`,
  );
}

export function requireChannelId(raw: string): string {
  const channelId = raw.trim();
  if (!CHANNEL_ID_SHAPE.test(channelId)) {
    throw new DomainError(
      "INVALID_INPUT",
      "channelId must be a canonical UC… id",
    );
  }
  return channelId;
}

/** Validates every id and drops duplicates; the DO never trusts caller-supplied lists. */
export function requireChannelIds(raw: readonly string[]): string[] {
  return [...new Set(raw.map(requireChannelId))];
}

export function requireEpisodeId(raw: string): string {
  const episodeId = raw.trim();
  if (!VIDEO_ID_SHAPE.test(episodeId)) {
    throw new DomainError(
      "INVALID_INPUT",
      "episodeId must be an 11-character id",
    );
  }
  return episodeId;
}
