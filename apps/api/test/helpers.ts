import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type {
  AttemptOutcomeCode,
  AttemptStatus,
  AttemptTrigger,
  ProcessingIntent,
  Takeaway,
} from "@media-digest/shared";
import { expect } from "vitest";
import { z } from "zod";
import { getRegistry } from "../src/do/registry";
import { upsertSummary } from "../src/do/registry/summaries";
import { getUserDO } from "../src/do/user";
import { type DomainErrorCode, domainErrorCode } from "../src/lib/errors";

/** Must match `miniflare.bindings.OWNER_EMAIL` in vitest.config.ts. */
export const OWNER = "owner@example.com";
export const ALICE = "alice@example.com";
export const BOB = "bob@example.com";

// Canonical-looking ids: "UC" + 22 URL-safe base64 characters.
export const CHANNEL_A = "UCAAAAAAAAAAAAAAAAAAAAAA";
export const CHANNEL_B = "UCBBBBBBBBBBBBBBBBBBBBBB";
export const CHANNEL_C = "UCCCCCCCCCCCCCCCCCCCCCCC";
export const CHANNEL_D = "UCDDDDDDDDDDDDDDDDDDDDDD";
export const CHANNEL_E = "UCEEEEEEEEEEEEEEEEEEEEEE";

/** `count` distinct valid channel ids, for exercising parameter chunking. */
export function channelIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `UC${String(i).padStart(22, "0")}`,
  );
}

// 11-character episode ids.
export const EPISODE_A = "aaaaaaaaaaa";
export const EPISODE_B = "bbbbbbbbbbb";
export const EPISODE_C = "ccccccccccc";

/** `count` distinct valid episode ids, for exercising parameter chunking. */
export function episodeIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `v${String(i).padStart(10, "0")}`,
  );
}

export function registry() {
  return getRegistry(env);
}

/**
 * Registers an address and returns its `user_id` — what the identity middleware does before any
 * route runs. Follows are keyed by the id (docs/specs/auth-2-registry-rekey.md), so a test that
 * wants to act as somebody has to become somebody first.
 */
export async function identityOf(email: string): Promise<string> {
  return (await registry().ensureUser(email)).userId;
}

/** Approve as an address: registers the identity first, exactly as a request would. */
export async function approveAs(
  email: string,
  channelId: string,
  input?: { title?: string; initialImportCount?: number; explanation?: string },
) {
  return registry().approveChannel(await identityOf(email), channelId, input);
}

/** Decline as an address. */
export async function declineAs(
  email: string,
  channelId: string,
  input?: { explanation?: string },
) {
  return registry().declineChannel(await identityOf(email), channelId, input);
}

/** Follow as an address: registers the identity first, exactly as a request would. */
export async function follow(email: string, channelId: string) {
  return registry().recordFollow(await identityOf(email), channelId);
}

/** Unfollow as an address. */
export async function unfollow(email: string, channelId: string) {
  return registry().recordUnfollow(await identityOf(email), channelId);
}

/**
 * Creates a channel and approves it as the owner: what most fixtures want. There is no owner add
 * shortcut in the API (PRD §9), so this is the two calls the web makes. Approval pauses a channel
 * nobody follows yet (system), exactly as the facade does.
 */
export async function seedApprovedChannel(
  channelId: string,
  title: string,
  input: { initialImportCount?: number } = {},
) {
  const stub = registry();
  await stub.createChannel({ channelId, title, ...input });
  return (await approveAs(OWNER, channelId)).channel;
}

export function userDO(email: string) {
  return getUserDO(env, email);
}

/** Asserts a DO RPC call fails with the given typed code, whatever crosses the RPC boundary. */
export async function expectDomainError(
  call: Promise<unknown>,
  code: DomainErrorCode,
): Promise<void> {
  let caught: unknown;
  try {
    await call;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code} but the call succeeded`).toBeDefined();
  expect(domainErrorCode(caught)).toBe(code);
}

type ChannelState = {
  status: "requested" | "approved" | "declined";
};

/**
 * Drives channel status directly; the facade methods are exercised in registry-channels.test.ts.
 * Leaving `approved` clears any pause, as the facade's decline does, so the schema's
 * `paused_by IS NULL OR status = 'approved'` check always holds.
 */
export async function setChannelState(
  channelId: string,
  state: ChannelState,
): Promise<void> {
  const approved = state.status === "approved";
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `UPDATE channels SET status = ?, approved_at = ?, reviewed_at = COALESCE(reviewed_at, 1),
         reviewed_by_user_id = COALESCE(reviewed_by_user_id,
           (SELECT user_id FROM global_users WHERE email = 'owner@example.com')),
         paused_by = CASE WHEN ? THEN paused_by ELSE NULL END,
         paused_at = CASE WHEN ? THEN paused_at ELSE NULL END
       WHERE channel_id = ?`,
      state.status,
      approved ? 1 : null,
      approved ? 1 : 0,
      approved ? 1 : 0,
      channelId,
    );
  });
}

// --- ingestion fixtures ----------------------------------------------------------------------
// The pipeline (M3) does not exist yet, so tests seed runs, episodes, attempts, and summaries with
// real SQL, the same way `setChannelState` drives channel state. The channel row must already exist.

const RUN_COLUMNS = `run_id, channel_id, kind, feed_status, discovered_count, episode_limit,
  started_at, finished_at, created_at`;

type RunSeed = {
  runId?: string;
  kind?: "initial" | "scheduled";
  feedStatus?: "read" | "unavailable";
  discoveredCount?: number;
  episodeLimit?: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt?: number;
};

/** One completed discovery run. Defaults: scheduled, feed read, nothing discovered, at t=1. */
export async function seedRun(
  channelId: string,
  seed: RunSeed = {},
): Promise<string> {
  const runId = seed.runId ?? crypto.randomUUID();
  const createdAt = seed.createdAt ?? 1;
  const startedAt = seed.startedAt ?? createdAt;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO ingestion_runs (${RUN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runId,
      channelId,
      seed.kind ?? "scheduled",
      seed.feedStatus ?? "read",
      seed.discoveredCount ?? 0,
      seed.episodeLimit ?? null,
      startedAt,
      seed.finishedAt ?? startedAt,
      createdAt,
    );
  });
  return runId;
}

/**
 * Every episode names the run that discovered it. Seeds without a run share one per channel,
 * created at t=0 so an explicitly seeded run is always the newest.
 */
async function seedRunFor(channelId: string): Promise<string> {
  const runId = `seed-run-${channelId}`;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO ingestion_runs (${RUN_COLUMNS})
       VALUES (?, ?, 'initial', 'read', 0, 5, 0, 0, 0)`,
      runId,
      channelId,
    );
  });
  return runId;
}

const WINDOW_MS = 48 * 60 * 60 * 1000;

type EpisodeSeed = {
  title?: string;
  publishedAt?: number;
  status?: "pending" | "available" | "failed" | "skipped";
  skipReason?: "SHORT" | "NON_ENGLISH" | "UNPLAYABLE" | "OWNER";
  skippedByEmail?: string;
  attemptCount?: number;
  /** The latest attempt's reason a timed-out publication keeps; `failed` only. */
  failureDetail?: string;
  chunkCount?: number;
  processedAt?: number;
  runId?: string;
  /** An open processing window: `publish` needs `pending`, `replace` needs `available`. */
  window?: {
    intent: "publish" | "replace";
    startedAt?: number;
    deadlineAt?: number;
    nextAttemptAt?: number;
  };
};

export async function seedEpisode(
  episodeId: string,
  channelId: string,
  seed: EpisodeSeed = {},
): Promise<void> {
  const status = seed.status ?? "available";
  const available = status === "available";
  const pending = status === "pending";
  const failed = status === "failed";
  const skipped = status === "skipped";
  const skipReason = skipped ? (seed.skipReason ?? "SHORT") : null;
  const at = seed.processedAt ?? seed.publishedAt ?? 1;
  const runId = seed.runId ?? (await seedRunFor(channelId));
  const window = seed.window ?? null;
  const windowStart = window ? (window.startedAt ?? at) : null;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO episodes
         (episode_id, channel_id, discovered_by_run_id, title, published_at, status,
          intent, window_started_at, window_deadline_at, next_attempt_at, attempt_count,
          failure_code, failure_detail, skip_reason, skipped_at, skipped_by_email, transcript_checked_at,
          chunk_count, vectorized_at, processed_at, active_vector_generation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      episodeId,
      channelId,
      runId,
      seed.title ?? `Episode ${episodeId}`,
      seed.publishedAt ?? 1,
      status,
      window?.intent ?? null,
      windowStart,
      window && windowStart !== null
        ? (window.deadlineAt ?? windowStart + WINDOW_MS)
        : null,
      window ? (window.nextAttemptAt ?? windowStart) : null,
      seed.attemptCount ?? (pending ? 0 : 1),
      failed ? "INGESTION_TIMEOUT" : null,
      failed ? (seed.failureDetail ?? "PROVIDER_HTTP") : null,
      skipReason,
      skipped ? at : null,
      skipReason === "OWNER" ? (seed.skippedByEmail ?? OWNER) : null,
      pending ? null : at,
      available ? (seed.chunkCount ?? 3) : null,
      available ? at : null,
      available ? at : null,
      available ? `gen-${episodeId}` : null,
      at,
      at,
    );
  });
}

type SummarySeed =
  | {
      format?: "structured";
      executiveSummary?: string;
      takeaways?: Takeaway[];
      topicTags?: string[];
      relatedEpisodeIds?: string[];
    }
  | { format: "raw_fallback"; rawText?: string; relatedEpisodeIds?: string[] };

export async function seedSummary(
  episodeId: string,
  seed: SummarySeed = {},
): Promise<void> {
  // The product's own write (do/registry/summaries.ts), so the seed and completeAttempt cannot drift.
  const related = seed.relatedEpisodeIds ?? [];
  await runInDurableObject(registry(), (_, ctx) => {
    if (seed.format === "raw_fallback") {
      upsertSummary(
        ctx.storage.sql,
        episodeId,
        {
          format: "raw_fallback",
          rawText: seed.rawText ?? `Raw summary of ${episodeId}`,
          model: "test-model",
          promptVersion: "v0",
        },
        related,
        1,
      );
      return;
    }
    upsertSummary(
      ctx.storage.sql,
      episodeId,
      {
        format: "structured",
        executiveSummary: seed.executiveSummary ?? `Summary of ${episodeId}`,
        takeaways: seed.takeaways ?? [{ text: "takeaway", startSec: 12 }],
        topicTags: seed.topicTags ?? ["tag"],
        model: "test-model",
        promptVersion: "v0",
      },
      related,
      1,
    );
  });
}

type AttemptSeed = {
  attemptId?: string;
  trigger?: AttemptTrigger;
  intent?: ProcessingIntent;
  status?: AttemptStatus;
  /** Defaults per status: waiting CAPTIONS, failed PROVIDER_HTTP, skipped SHORT, blocked PROVIDER_LIMIT, else null. */
  outcomeCode?: AttemptOutcomeCode | null;
  failureDetail?: string;
  workflowId?: string | null;
  requestedByEmail?: string;
  stagedChunkCount?: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt?: number;
};

const DEFAULT_OUTCOME: Record<AttemptStatus, AttemptOutcomeCode | null> = {
  running: null,
  available: null,
  waiting: "CAPTIONS",
  failed: "PROVIDER_HTTP",
  skipped: "SHORT",
  blocked: "PROVIDER_LIMIT",
};

/** One row of the attempt ledger. The episode row must already exist. */
export async function seedAttempt(
  episodeId: string,
  seed: AttemptSeed = {},
): Promise<string> {
  const attemptId = seed.attemptId ?? crypto.randomUUID();
  const status = seed.status ?? "waiting";
  const trigger = seed.trigger ?? "channel_ingestion";
  const startedAt = seed.startedAt ?? 1;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO episode_ingestion_attempts
         (attempt_id, episode_id, trigger, intent, staged_chunk_count, workflow_id,
          requested_by_email, status, outcome_code, failure_detail, started_at, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attemptId,
      episodeId,
      trigger,
      seed.intent ?? "publish",
      seed.stagedChunkCount ?? null,
      seed.workflowId === undefined
        ? status === "blocked"
          ? null
          : `wf-${attemptId}`
        : seed.workflowId,
      trigger === "owner_retry" ? (seed.requestedByEmail ?? OWNER) : null,
      status,
      seed.outcomeCode === undefined
        ? DEFAULT_OUTCOME[status]
        : seed.outcomeCode,
      seed.failureDetail ?? null,
      startedAt,
      status === "running" ? null : (seed.finishedAt ?? startedAt),
      seed.createdAt ?? startedAt,
    );
  });
  return attemptId;
}

/** Asserts a response body matches the shared schema that documents it, i.e. the API does what `/docs` says. */
export function expectShape(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  expect(
    result.success,
    result.success ? "" : z.prettifyError(result.error),
  ).toBe(true);
}
