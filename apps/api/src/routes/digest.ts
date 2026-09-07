import type { DigestResponse } from "@media-digest/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { eligibleChannels } from "../lib/eligibility";
import { toEpisode } from "../lib/episode-view";
import { DomainError } from "../lib/errors";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Show last 7 days" is the widest view; there is no paging beyond it in this slice. */
const MAX_WINDOW_MS = 7 * DAY_MS;

/**
 * The caller's digest: processed episodes with summaries from eligible follows, newest first.
 * Returning a summary records the caller's read receipt (AGENTS.md → Data & schema conventions);
 * `wasUnread` tells the UI which items were new before this response.
 */
export const digestRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const now = Date.now();
  const since = Math.max(
    parseSince(c.req.query("since"), now),
    now - MAX_WINDOW_MS,
  );

  const eligible = await eligibleChannels(c.var.registry, c.var.user);
  if (eligible.length === 0) {
    return c.json<DigestResponse>({ since, episodes: [] });
  }

  const records = await c.var.registry.listDigest(
    eligible.map((channel) => channel.channelId),
    since,
  );
  const returned = records.map((record) => record.videoId);
  let alreadyRead = new Set<string>();
  if (returned.length > 0) {
    alreadyRead = new Set(await c.var.user.readVideoIds(returned));
    await c.var.user.markRead(returned);
  }

  return c.json<DigestResponse>({
    since,
    episodes: records.map((record) =>
      toEpisode(record, {
        includeSummary: true,
        includeProcessing: false,
        wasUnread: !alreadyRead.has(record.videoId),
      }),
    ),
  });
});

function parseSince(raw: string | undefined, now: number): number {
  if (raw === undefined || raw === "") return now - DAY_MS;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new DomainError(
      "INVALID_INPUT",
      "since must be an ISO 8601 timestamp",
    );
  }
  return parsed;
}
