/**
 * The transcript seam (AGENTS.md → Transcript seam; docs/PRD.md §4.2 rules 19–23). Ingestion sees
 * only this contract; the provider behind it (DownSub today) is one file away and can change without
 * the Workflow noticing.
 */

export type TranscriptSegment = {
  text: string;
  startSec: number;
  durationSec: number;
};

export type TranscriptResult = {
  /** Present only for `captionStatus: "english"`, and then never empty. */
  segments: TranscriptSegment[] | null;
  durationSec: number | null;
  captionStatus: "english" | "none" | "non_english";
};

export type TranscriptSource = {
  fetch(episodeId: string): Promise<TranscriptResult>;
};

export const TRANSCRIPT_FAILURES = [
  "UNPLAYABLE",
  "PROVIDER_AUTH",
  "PROVIDER_LIMIT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_HTTP",
  "PROVIDER_PARSE",
] as const;

export type TranscriptFailure = (typeof TRANSCRIPT_FAILURES)[number];

/**
 * A provider failure with its reason. The reason is also the message prefix, as `DomainError`'s
 * code is, so it survives a Workflow step boundary and `transcriptFailure(error)` recovers it.
 */
export class TranscriptError extends Error {
  readonly reason: TranscriptFailure;

  constructor(reason: TranscriptFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "TranscriptError";
    this.reason = reason;
  }
}

/** Recovers the reason from a `TranscriptError`, including one that crossed a step boundary. */
export function transcriptFailure(error: unknown): TranscriptFailure | null {
  if (error instanceof TranscriptError) return error.reason;
  if (!(error instanceof Error)) return null;
  const prefix = error.message.split(":", 1)[0]?.trim();
  return TRANSCRIPT_FAILURES.find((reason) => reason === prefix) ?? null;
}
