import { DomainError } from "../errors";

// Canonical YouTube channel ids: "UC" followed by 22 URL-safe base64 characters.
const CHANNEL_ID_SHAPE = /^UC[A-Za-z0-9_-]{22}$/;
// YouTube video ids: 11 URL-safe base64 characters.
const VIDEO_ID_SHAPE = /^[A-Za-z0-9_-]{11}$/;

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

export function requireVideoId(raw: string): string {
  const videoId = raw.trim();
  if (!VIDEO_ID_SHAPE.test(videoId)) {
    throw new DomainError(
      "INVALID_INPUT",
      "videoId must be an 11-character id",
    );
  }
  return videoId;
}
