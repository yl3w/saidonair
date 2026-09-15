import { requireEpisodeId } from "../youtube/ids";
import {
  TranscriptError,
  type TranscriptResult,
  type TranscriptSource,
} from "./types";
import { parseVtt } from "./vtt";

/**
 * The DownSub adapter (docs/PRD.md §4.2 rules 19–23; docs/specs/m3-1-transcripts-chunking.md §3.3).
 * One call per video to `GET /download?url=<public watch URL>` with the key as a bearer token, then
 * at most one unauthenticated GET of the chosen track's VTT. The adapter never retries and sets no
 * timeout: the Workflow step owns both, because the provider's error states are slow (up to a
 * minute). Nothing but the watch URL and the key leaves the Worker; transcript text is never logged.
 *
 * Response shape, confirmed against the live endpoint on 2026-09-13: `{ status, data: { state,
 * duration, metadata, subtitles: [{ language, code, formats: [{ format, url }] }],
 * translatedSubtitles } }`. `state` is `subtitles_found`, `no_subtitles`, or `error`. An unplayable
 * video's `error` sometimes carries `metadata.playabilityReason` and sometimes an empty `metadata`
 * (both seen for one bogus id within minutes on 2026-09-13); a live stream's `error` carries no
 * reason but does carry the video's title, duration, and channel. Since 2026-09-14 every `error`
 * throws `UNPLAYABLE` and those signals only choose the detail, because live content is no longer
 * discovered (docs/specs/discovery-long-form-feed.md).
 */

export const DOWNSUB_DOWNLOAD_URL = "https://api.downsub.com/download";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type DownsubTrack = { code: string; vttUrl: string | null };

export type TrackChoice =
  | { kind: "english"; track: DownsubTrack }
  | { kind: "non_english" }
  | { kind: "none" };

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function downsubSource(
  apiKey: string | undefined,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): TranscriptSource {
  return {
    async fetch(episodeId) {
      const id = requireEpisodeId(episodeId);
      const key = apiKey?.trim();
      if (!key) {
        throw new TranscriptError(
          "PROVIDER_AUTH",
          "DOWNSUB_API_KEY is not configured",
        );
      }
      const body = await download(fetchImpl, key, id);
      return classify(body, fetchImpl);
    },
  };
}

/**
 * English by `code`, never by label (labels read "undefined" for some tracks): a manual `en` or
 * `en-*` track first, then `en_auto` or `en-*_auto`. Tracks that exist but are not English mean
 * `non_english`; no tracks at all mean `none`.
 */
export function chooseTrack(tracks: readonly DownsubTrack[]): TrackChoice {
  if (tracks.length === 0) return { kind: "none" };
  const manual = tracks.find((track) =>
    /^en(-[A-Za-z0-9]+)?$/.test(track.code),
  );
  if (manual) return { kind: "english", track: manual };
  const auto = tracks.find((track) =>
    /^en(-[A-Za-z0-9]+)?_auto$/.test(track.code),
  );
  if (auto) return { kind: "english", track: auto };
  return { kind: "non_english" };
}

type DownloadBody = {
  state: string;
  durationSec: number | null;
  isLiveContent: boolean;
  playabilityReason: string | null;
  /** The body describes a real video: a title, a duration, or a channel id. */
  describesVideo: boolean;
  /** YouTube's live thumbnails end in `_live.jpg`. */
  liveThumbnail: boolean;
  tracks: DownsubTrack[];
};

async function download(
  fetchImpl: FetchLike,
  key: string,
  episodeId: string,
): Promise<DownloadBody> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${DOWNSUB_DOWNLOAD_URL}?url=${encodeURIComponent(watchUrl(episodeId))}`,
      {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      },
    );
  } catch (error) {
    throw new TranscriptError(
      "PROVIDER_HTTP",
      `request failed: ${messageOf(error)}`,
    );
  }
  if (response.status === 401)
    throw new TranscriptError("PROVIDER_AUTH", "HTTP 401");
  if (response.status === 403)
    throw new TranscriptError("PROVIDER_LIMIT", "HTTP 403");
  if (response.status === 429) {
    throw new TranscriptError("PROVIDER_RATE_LIMIT", "HTTP 429");
  }
  if (!response.ok) {
    throw new TranscriptError("PROVIDER_HTTP", `HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new TranscriptError("PROVIDER_PARSE", "body is not JSON");
  }
  return parseDownload(json);
}

/** Hand-validated by name; everything else in the ~400 KB body is ignored unread. */
function parseDownload(json: unknown): DownloadBody {
  const data = record(record(json)?.data);
  const state = data?.state;
  if (!data || typeof state !== "string") {
    throw new TranscriptError("PROVIDER_PARSE", "body has no data.state");
  }
  const metadata = record(data.metadata);
  const duration = data.duration;
  const reason = metadata?.playabilityReason;
  const durationSec =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? duration
      : null;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const channelId = metadata?.channelId;
  const thumbnail = data.thumbnail;
  const tracks: DownsubTrack[] = [];
  if (Array.isArray(data.subtitles)) {
    for (const entry of data.subtitles) {
      const track = record(entry);
      if (!track || typeof track.code !== "string") continue;
      let vttUrl: string | null = null;
      if (Array.isArray(track.formats)) {
        for (const format of track.formats) {
          const f = record(format);
          if (f?.format === "vtt" && typeof f.url === "string") vttUrl = f.url;
        }
      }
      tracks.push({ code: track.code, vttUrl });
    }
  }
  return {
    state,
    durationSec,
    isLiveContent: metadata?.isLiveContent === true,
    playabilityReason:
      typeof reason === "string" && reason.length > 0 ? reason : null,
    describesVideo:
      title.length > 0 ||
      durationSec !== null ||
      (typeof channelId === "string" && channelId.length > 0),
    liveThumbnail:
      typeof thumbnail === "string" && /_live\.jpg/.test(thumbnail),
    tracks,
  };
}

async function classify(
  body: DownloadBody,
  fetchImpl: FetchLike,
): Promise<TranscriptResult> {
  const base = { durationSec: body.durationSec } as const;
  switch (body.state) {
    case "error":
      // All four branches are UNPLAYABLE (PRD §4.2 rule 12) and differ only in the detail. They
      // stay textually separate because the last is a catch-all for provider flakiness, not a live
      // detector: a transient error whose body happens to describe a video lands there and is
      // skipped permanently, and that is the branch to split back out if it bites
      // (docs/specs/discovery-long-form-feed.md §5).
      if (body.isLiveContent || body.liveThumbnail) {
        throw new TranscriptError("UNPLAYABLE", "live or upcoming");
      }
      if (body.playabilityReason) {
        throw new TranscriptError("UNPLAYABLE", body.playabilityReason);
      }
      if (!body.describesVideo) {
        throw new TranscriptError(
          "UNPLAYABLE",
          "provider reported an error and no video metadata",
        );
      }
      throw new TranscriptError(
        "UNPLAYABLE",
        "provider reported an error with no reason",
      );
    case "no_subtitles":
      return { ...base, segments: null, captionStatus: "none" };
    case "subtitles_found": {
      const choice = chooseTrack(body.tracks);
      if (choice.kind === "none") {
        return { ...base, segments: null, captionStatus: "none" };
      }
      if (choice.kind === "non_english") {
        return { ...base, segments: null, captionStatus: "non_english" };
      }
      const segments = await downloadVtt(fetchImpl, choice.track);
      // An empty caption file is no captions in every sense a reader cares about (decided 2026-09-11).
      if (segments.length === 0) {
        return { ...base, segments: null, captionStatus: "none" };
      }
      return { ...base, segments, captionStatus: "english" };
    }
    default:
      throw new TranscriptError(
        "PROVIDER_PARSE",
        `unexpected state ${body.state}`,
      );
  }
}

async function downloadVtt(fetchImpl: FetchLike, track: DownsubTrack) {
  if (!track.vttUrl) {
    throw new TranscriptError(
      "PROVIDER_PARSE",
      `track ${track.code} has no VTT url`,
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(track.vttUrl, {
      headers: { accept: "text/vtt" },
    });
  } catch (error) {
    throw new TranscriptError(
      "PROVIDER_PARSE",
      `caption file request failed: ${messageOf(error)}`,
    );
  }
  if (!response.ok) {
    throw new TranscriptError(
      "PROVIDER_PARSE",
      `caption file HTTP ${response.status}`,
    );
  }
  return parseVtt(await response.text());
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
