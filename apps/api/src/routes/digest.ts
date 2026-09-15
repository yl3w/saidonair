import {
  type DigestQuery,
  DigestQuerySchema,
  type DigestResponse,
  DigestResponseSchema,
} from "@media-digest/shared";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { DigestPosition, DigestSelection } from "../do/registry/types";
import type { AppEnv } from "../env";
import { toEpisode } from "../lib/episode-view";
import { DomainError } from "../lib/errors";
import { errorResponses, jsonResponse } from "../lib/openapi";
import { validate } from "../lib/validation";

type Ctx = Context<AppEnv>;

const DEFAULT_LIMIT = 50;
/**
 * Read receipts live in the User DO, so `unread` is filtered outside the Registry: a page may need
 * several passes over the range before it fills. This bounds the work one request may do; a page
 * that stops short still carries a `nextCursor`, so the client simply asks again.
 */
const MAX_PASSES = 10;

/**
 * The caller's digest: the one route behind Queue, History and the calendar. A range of first
 * availability, newest first, paged by cursor, with no default window and no clamp — the client
 * works out its own local day boundaries and the API never takes a timezone (docs/PRD.md §4.4).
 * A pure read: it records nothing, and `read` reports the receipt each row already carries.
 */
export const digestRoutes = new Hono<AppEnv>().get(
  "/",
  describeRoute({
    tags: ["digest"],
    summary: "The caller's digest",
    description:
      "Available episodes with summaries from eligible follows (active follows on approved channels), selected and ordered by `summaryAvailableAt`, newest first. `from` and `to` bound the range (inclusive and exclusive); omitting both asks for everything. `unread=true` is the queue and omitting it is History; `channelId` repeats to narrow the range; `cursor` and `limit` page it; `compact=true` answers rows rather than episodes. There is no default window and no clamp: day grouping is the client's, from its own local boundaries. A pure read — `POST /channels/{id}/episodes/{videoId}/read` is the only thing that records a receipt.",
    responses: {
      200: jsonResponse(
        DigestResponseSchema,
        "One page of the range, and the cursor for the next.",
      ),
      ...errorResponses(),
    },
  }),
  validate("query", DigestQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    // Every bound is checked before anything is read, so a caller who follows nothing still hears
    // that their range or cursor was malformed rather than an empty page.
    const range = requireRange(query);
    const start =
      query.cursor === undefined ? null : decodeCursor(query.cursor);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const unread = query.unread === true;
    const compact = query.compact === true;

    const eligible = (
      await c.var.registry.listEligibleChannels(c.var.identity.email)
    ).map((channel) => channel.channelId);
    const wanted = query.channelId;
    const channelIds =
      wanted === undefined
        ? eligible
        : eligible.filter((id) => wanted.includes(id));
    if (channelIds.length === 0) {
      return c.json<DigestResponse>(
        compact
          ? { compact: true, rows: [], nextCursor: null }
          : { compact: false, episodes: [], nextCursor: null },
      );
    }

    const select = (after: DigestPosition | null): DigestSelection => ({
      ...range,
      after,
      limit: limit + 1,
    });
    if (compact) {
      const page = await pageThrough(
        c,
        (after) => c.var.registry.listDigestRows(channelIds, select(after)),
        { limit, unread, start },
      );
      const read = await readState(c, page.items, unread);
      return c.json<DigestResponse>({
        compact: true,
        rows: page.items.map((row) => ({
          ...row,
          read: read.has(row.videoId),
        })),
        nextCursor: page.nextCursor,
      });
    }

    const page = await pageThrough(
      c,
      (after) => c.var.registry.listDigest(channelIds, select(after)),
      { limit, unread, start },
    );
    const read = await readState(c, page.items, unread);
    return c.json<DigestResponse>({
      compact: false,
      episodes: page.items.map((record) =>
        toEpisode(record, { read: read.has(record.videoId) }),
      ),
      nextCursor: page.nextCursor,
    });
  },
);

/** A row the page can resume from. Every row the digest selects carries both fields. */
type Positioned = { videoId: string; summaryAvailableAt: number | null };

/**
 * One page of the range. The Registry answers `limit + 1` rows at a time so the end of the range is
 * visible; `unread` then drops the ones the caller has already dealt with, and another pass runs if
 * the page is not full. `nextCursor` is the last row whose fate was decided, so a following page
 * neither repeats a row nor steps over one — including the read rows that were skipped.
 */
async function pageThrough<T extends Positioned>(
  c: Ctx,
  fetch: (after: DigestPosition | null) => Promise<T[]>,
  options: { limit: number; unread: boolean; start: DigestPosition | null },
): Promise<{ items: T[]; nextCursor: string | null }> {
  const items: T[] = [];
  let after = options.start;
  let exhausted = false;

  for (
    let pass = 0;
    pass < MAX_PASSES && items.length < options.limit;
    pass++
  ) {
    const batch = await fetch(after);
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    const read = options.unread ? await readVideoIds(c, batch) : null;
    let consumed = 0;
    for (const row of batch) {
      if (items.length === options.limit) break;
      consumed++;
      after = positionOf(row);
      if (read === null || !read.has(row.videoId)) items.push(row);
    }
    // The Registry was asked for one more than the page needs, so a short batch is the end.
    if (consumed === batch.length && batch.length <= options.limit) {
      exhausted = true;
    }
  }

  return {
    items,
    nextCursor: exhausted || after === null ? null : encodeCursor(after),
  };
}

/** The caller's receipts among the returned rows; an `unread` page has none by construction. */
async function readState(
  c: Ctx,
  items: readonly Positioned[],
  unread: boolean,
): Promise<ReadonlySet<string>> {
  if (unread || items.length === 0) return new Set<string>();
  return readVideoIds(c, items);
}

async function readVideoIds(
  c: Ctx,
  items: readonly Positioned[],
): Promise<Set<string>> {
  return new Set(
    await c.var.user.readVideoIds(items.map((item) => item.videoId)),
  );
}

/** The selection guarantees `processed_at IS NOT NULL`, so the fallback is unreachable. */
function positionOf(row: Positioned): DigestPosition {
  return {
    summaryAvailableAt: row.summaryAvailableAt ?? 0,
    videoId: row.videoId,
  };
}

/** `from` and `to` as instants, rejecting a range that can hold nothing. */
function requireRange(query: DigestQuery): {
  fromMs: number | null;
  toMs: number | null;
} {
  const fromMs = query.from === undefined ? null : Date.parse(query.from);
  const toMs = query.to === undefined ? null : Date.parse(query.to);
  if (fromMs !== null && toMs !== null && fromMs >= toMs) {
    throw new DomainError("INVALID_INPUT", "from must be before to");
  }
  return { fromMs, toMs };
}

/**
 * The cursor is the last row's `(summaryAvailableAt, videoId)` as opaque base64url (plan decision,
 * docs/specs/design-phase-plan.md §2.2): the client never composes one, so changing the key is not
 * a breaking change.
 */
function encodeCursor(position: DigestPosition): string {
  return btoa(`${position.summaryAvailableAt}.${position.videoId}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeCursor(raw: string): DigestPosition {
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
  let decoded: string;
  try {
    decoded = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  } catch {
    throw invalidCursor();
  }
  const separator = decoded.indexOf(".");
  const summaryAvailableAt = Number(decoded.slice(0, separator));
  const videoId = decoded.slice(separator + 1);
  if (separator < 1 || !Number.isInteger(summaryAvailableAt) || !videoId) {
    throw invalidCursor();
  }
  return { summaryAvailableAt, videoId };
}

function invalidCursor(): DomainError {
  return new DomainError(
    "INVALID_INPUT",
    "cursor is not a position this route issued",
  );
}
