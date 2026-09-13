import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type {
  AttemptOutcomeCode,
  AttemptStatus,
  AttemptTrigger,
  RecoveryMode,
  Takeaway,
} from "@media-digest/shared";
import { expect } from "vitest";
import { z } from "zod";
import { getRegistry } from "../src/do/registry";
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

// 11-character video ids.
export const VIDEO_A = "aaaaaaaaaaa";
export const VIDEO_B = "bbbbbbbbbbb";
export const VIDEO_C = "ccccccccccc";

/** `count` distinct valid video ids, for exercising parameter chunking. */
export function videoIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `v${String(i).padStart(10, "0")}`,
  );
}

export function registry() {
  return getRegistry(env);
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
  return (await stub.approveChannel(OWNER, channelId)).channel;
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
         reviewed_by_email = COALESCE(reviewed_by_email, 'owner@example.com'),
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

const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

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
  /** An active recovery window: `publication` needs `pending`, `replacement` needs `available`. */
  recovery?: {
    mode: "publication" | "replacement";
    startedAt?: number;
    deadlineAt?: number;
    nextAttemptAt?: number;
  };
};

export async function seedEpisode(
  videoId: string,
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
  const recovery = seed.recovery ?? null;
  const recoveryStart = recovery ? (recovery.startedAt ?? at) : null;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO episodes
         (video_id, channel_id, discovered_by_run_id, title, published_at, status,
          recovery_mode, recovery_started_at, recovery_deadline_at, next_attempt_at, attempt_count,
          failure_code, failure_detail, skip_reason, skipped_at, skipped_by_email, transcript_checked_at,
          chunk_count, vectorized_at, processed_at, active_vector_generation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      videoId,
      channelId,
      runId,
      seed.title ?? `Episode ${videoId}`,
      seed.publishedAt ?? 1,
      status,
      recovery?.mode ?? null,
      recoveryStart,
      recovery && recoveryStart !== null
        ? (recovery.deadlineAt ?? recoveryStart + RECOVERY_WINDOW_MS)
        : null,
      recovery ? (recovery.nextAttemptAt ?? recoveryStart) : null,
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
      available ? `gen-${videoId}` : null,
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
      relatedVideoIds?: string[];
    }
  | { format: "raw_fallback"; rawText?: string; relatedVideoIds?: string[] };

export async function seedSummary(
  videoId: string,
  seed: SummarySeed = {},
): Promise<void> {
  const related = JSON.stringify(seed.relatedVideoIds ?? []);
  await runInDurableObject(registry(), (_, ctx) => {
    if (seed.format === "raw_fallback") {
      ctx.storage.sql.exec(
        `INSERT INTO episode_summaries
           (video_id, format, raw_text, related_video_ids_json, model, prompt_version, created_at)
         VALUES (?, 'raw_fallback', ?, ?, 'test-model', 'v0', 1)`,
        videoId,
        seed.rawText ?? `Raw summary of ${videoId}`,
        related,
      );
      return;
    }
    ctx.storage.sql.exec(
      `INSERT INTO episode_summaries
         (video_id, format, executive_summary, takeaways_json, topic_tags_json,
          related_video_ids_json, model, prompt_version, created_at)
       VALUES (?, 'structured', ?, ?, ?, ?, 'test-model', 'v0', 1)`,
      videoId,
      seed.executiveSummary ?? `Summary of ${videoId}`,
      JSON.stringify(seed.takeaways ?? [{ text: "takeaway", startSec: 12 }]),
      JSON.stringify(seed.topicTags ?? ["tag"]),
      related,
    );
  });
}

type AttemptSeed = {
  attemptId?: string;
  trigger?: AttemptTrigger;
  recoveryMode?: RecoveryMode;
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
  videoId: string,
  seed: AttemptSeed = {},
): Promise<string> {
  const attemptId = seed.attemptId ?? crypto.randomUUID();
  const status = seed.status ?? "waiting";
  const trigger = seed.trigger ?? "channel_ingestion";
  const startedAt = seed.startedAt ?? 1;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO episode_ingestion_attempts
         (attempt_id, video_id, trigger, recovery_mode, staged_chunk_count, workflow_id,
          requested_by_email, status, outcome_code, failure_detail, started_at, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attemptId,
      videoId,
      trigger,
      seed.recoveryMode ?? "publication",
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
