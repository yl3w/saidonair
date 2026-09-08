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
  status: "pending" | "available" | "failed";
  failureCode?: string;
  availableAt?: number;
};

/** Ingestion is not implemented yet, so tests drive processing state with real SQL. */
export async function setChannelState(
  channelId: string,
  state: ChannelState,
): Promise<void> {
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `UPDATE channels
       SET status = ?, failure_code = ?, available_at = COALESCE(?, available_at)
       WHERE channel_id = ?`,
      state.status,
      state.failureCode ?? null,
      state.availableAt ?? null,
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
  status?: "pending" | "processing" | "processed" | "no_transcript" | "failed";
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
  const status = seed.status ?? "processed";
  const processed = status === "processed";
  const at = seed.processedAt ?? seed.publishedAt ?? 1;
  await runInDurableObject(registry(), (_, ctx) => {
    ctx.storage.sql.exec(
      `INSERT INTO episodes
         (video_id, channel_id, title, published_at, status, attempt_count, failure_code,
          transcript_checked_at, chunk_count, vectorized_at, processed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      videoId,
      channelId,
      seed.title ?? `Episode ${videoId}`,
      seed.publishedAt ?? 1,
      status,
      seed.attemptCount ?? (status === "pending" ? 0 : 1),
      seed.failureCode ?? null,
      status === "pending" ? null : at,
      processed ? (seed.chunkCount ?? 3) : null,
      processed ? at : null,
      processed ? at : null,
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
      | "pending"
      | "processing"
      | "processed"
      | "no_transcript"
      | "failed"
      | "skipped";
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
