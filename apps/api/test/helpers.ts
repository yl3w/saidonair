import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
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
// Ingestion (M3) does not exist yet, so tests seed episodes, summaries, and runs with real SQL,
// the same way `setChannelState` drives channel state. The channel row must already exist.

type EpisodeSeed = {
  title?: string;
  publishedAt?: number;
  status?: "pending" | "available" | "failed" | "skipped";
  waitingCode?: "CAPTIONS" | "LIVE_OR_UPCOMING" | "PROVIDER_LIMIT";
  skipReason?:
    | "SHORT"
    | "NON_ENGLISH"
    | "NO_CAPTIONS"
    | "LIVE_OR_UPCOMING"
    | "UNPLAYABLE"
    | "OWNER";
  skippedByEmail?: string;
  attemptCount?: number;
  failureCode?: string;
  chunkCount?: number;
  processedAt?: number;
};

export async function seedEpisode(
  videoId: string,
  channelId: string,
  seed: EpisodeSeed = {},
): Promise<void> {
  const status = seed.status ?? "available";
  const available = status === "available";
  const failed = status === "failed";
  const skipped = status === "skipped";
  const skipReason = skipped ? (seed.skipReason ?? "SHORT") : null;
  const at = seed.processedAt ?? seed.publishedAt ?? 1;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO episodes
         (video_id, channel_id, title, published_at, status, waiting_code, attempt_count,
          failure_code, skip_reason, skipped_at, skipped_by_email, transcript_checked_at,
          chunk_count, vectorized_at, processed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      videoId,
      channelId,
      seed.title ?? `Episode ${videoId}`,
      seed.publishedAt ?? 1,
      status,
      status === "pending" ? (seed.waitingCode ?? null) : null,
      seed.attemptCount ?? (status === "pending" ? 0 : 1),
      failed
        ? (seed.failureCode ?? "PROVIDER_HTTP")
        : (seed.failureCode ?? null),
      skipReason,
      skipped ? at : null,
      skipReason === "OWNER" ? (seed.skippedByEmail ?? OWNER) : null,
      status === "pending" ? null : at,
      available ? (seed.chunkCount ?? 3) : null,
      available ? at : null,
      available ? at : null,
      at,
      at,
    );
  });
}

type SummarySeed =
  | {
      format?: "structured";
      executiveSummary?: string;
      takeaways?: string[];
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
      JSON.stringify(seed.takeaways ?? ["takeaway"]),
      JSON.stringify(seed.topicTags ?? ["tag"]),
      related,
    );
  });
}

type RunSeed = {
  runId?: string;
  kind?: "initial" | "scheduled" | "owner_retry";
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  lifecycleVersion?: number;
  episodeLimit?: number;
  startedAt?: number;
  finishedAt?: number;
  failureCode?: string;
  createdAt?: number;
  episodes?: {
    videoId: string;
    status:
      | "selected"
      | "available"
      | "failed"
      | "skipped"
      | "waiting"
      | "not_attempted";
    failureCode?: string;
  }[];
};

export async function seedRun(
  channelId: string,
  seed: RunSeed = {},
): Promise<string> {
  const runId = seed.runId ?? crypto.randomUUID();
  const createdAt = seed.createdAt ?? 1;
  await runInDurableObject(registry(), (_, ctx) => {
    const sql = ctx.storage.sql;
    sql.exec(
      `INSERT INTO ingestion_runs
         (run_id, channel_id, workflow_id, kind, status, lifecycle_version, episode_limit,
          started_at, finished_at, failure_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runId,
      channelId,
      `wf-${runId}`,
      seed.kind ?? "initial",
      seed.status ?? "completed",
      seed.lifecycleVersion ?? 1,
      seed.episodeLimit ?? null,
      seed.startedAt ?? null,
      seed.finishedAt ?? null,
      seed.failureCode ?? null,
      createdAt,
    );
    for (const episode of seed.episodes ?? []) {
      sql.exec(
        `INSERT INTO ingestion_run_episodes
           (run_id, video_id, status, failure_code, started_at, finished_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        runId,
        episode.videoId,
        episode.status,
        episode.failureCode ?? null,
        createdAt,
        createdAt,
        createdAt,
      );
    }
  });
  return runId;
}

/** Asserts a response body matches the shared schema that documents it, i.e. the API does what `/docs` says. */
export function expectShape(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  expect(
    result.success,
    result.success ? "" : z.prettifyError(result.error),
  ).toBe(true);
}
