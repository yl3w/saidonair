export type IngestionReason =
  | "channel_created"
  | "request_approved"
  | "owner_retry";

/**
 * The three places ingestion should start: owner add, approval that creates the channel, and
 * owner retry. The Workflow is M3; until then each start point is recorded as a structured log
 * line so the behaviour is visible under `wrangler dev` and the call sites are already in place.
 */
export function requestIngestion(
  channelId: string,
  reason: IngestionReason,
): void {
  console.log({ event: "ingestion.start_requested", channelId, reason });
}
