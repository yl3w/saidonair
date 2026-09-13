import { DurableObject } from "cloudflare:workers";
import type { EpisodeCounts } from "@media-digest/shared";
import { registryMigrations } from "../../migrations/registry";
import type { Env } from "../env";
import { normalizeEmail } from "../lib/email";
import { DomainError } from "../lib/errors";
import {
  requireChannelId,
  requireChannelIds,
  requireVideoId,
} from "../lib/youtube/ids";
import { applyMigrations } from "./migrations";
import * as catalog from "./registry/catalog";
import * as channels from "./registry/channels";
import * as episodes from "./registry/episodes";
import * as followers from "./registry/followers";
import * as runs from "./registry/runs";
import type {
  CatalogChannel,
  CatalogSummary,
  ChannelManagementRecord,
  CreateChannelInput,
  EpisodeRecord,
  FollowerRecord,
  IngestionRunRecord,
  ListEpisodesOptions,
  RegistryUser,
  ReviewInput,
} from "./registry/types";
import * as users from "./registry/users";

/** There is exactly one Registry; every caller addresses it by this name. */
const REGISTRY_NAME = "global";

export function getRegistry(env: Env): DurableObjectStub<RegistryDO> {
  return env.REGISTRY_DO.getByName(REGISTRY_NAME);
}

/**
 * Global Registry Durable Object: identities, the shared channel catalog, episodes with their
 * shared summaries, and discovery runs (reads only until M3 writes them).
 *
 * Every public method is an RPC endpoint, and none checks a role: the API enforces no
 * authorization (docs/PRD.md §2, §9). Methods that record who acted (approve, decline, skip) take
 * the acting email first and store it, whoever it is. Read methods are scoped by the channel ids
 * the caller passes; the routes compose them with the caller's follows. Methods are synchronous:
 * DO input gates make each call atomic against other callers, and multi-statement writes are
 * additionally wrapped in `transactionSync`.
 */
export class RegistryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const applied = applyMigrations(ctx.storage, registryMigrations);
      if (applied.length > 0) {
        console.log({
          event: "registry.migrations_applied",
          versions: applied,
        });
      }
      this.#seedOwner();
    });
  }

  // --- identity -------------------------------------------------------------

  /** Auto-registers unknown emails and records last_seen_at. */
  ensureUser(email: string): RegistryUser {
    return users.ensureUser(this.#sql, users.requireEmail(email), Date.now());
  }

  getUser(email: string): RegistryUser | null {
    return users.getUser(this.#sql, users.requireEmail(email));
  }

  // --- catalog --------------------------------------------------------------

  /** The browsable catalog: requested and approved channels. */
  listCatalogChannels(): CatalogChannel[] {
    return channels.listCatalogChannels(this.#sql);
  }

  /** Any status, including declined; used for follows and channel views. */
  listChannelsByIds(channelIds: string[]): CatalogChannel[] {
    return channels.listChannelsByIds(this.#sql, requireChannelIds(channelIds));
  }

  getChannel(channelId: string): CatalogChannel | null {
    return channels.getChannel(this.#sql, requireChannelId(channelId));
  }

  /** Every channel in every status, newest first. */
  listChannels(): CatalogChannel[] {
    return channels.listChannels(this.#sql);
  }

  /**
   * Creates a `requested` channel for whoever asks: there is no owner shortcut, approval is always
   * `approveChannel` (owner decision 2026-09-12). Create-only: `INVALID_STATE` when the id exists,
   * which the route turns into follow or request-again.
   */
  createChannel(input: CreateChannelInput): CatalogChannel {
    return channels.createChannel(this.#sql, input, Date.now());
  }

  /**
   * `requested | declined → approved`, recording the caller as reviewer. `importStarts` is true when
   * approved_at was null before. A channel nobody actively follows is paused by the system at once,
   * so approving one with no followers never leaves it running unattended (Ruling R4).
   */
  approveChannel(
    actorEmail: string,
    channelId: string,
    input: ReviewInput = {},
  ): { channel: CatalogChannel; importStarts: boolean } {
    const reviewer = users.requireEmail(actorEmail);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, reviewer, now);
      const before = channels.requireChannel(
        this.#sql,
        requireChannelId(channelId),
      );
      let channel = channels.approveChannel(
        this.#sql,
        before.channelId,
        reviewer,
        input,
        now,
      );
      const active = followers.countActiveByChannel(this.#sql, [
        channel.channelId,
      ])[channel.channelId];
      if ((active ?? 0) === 0) {
        channel = channels.setPause(
          this.#sql,
          channel.channelId,
          "system",
          now,
        );
      }
      return { channel, importStarts: before.approvedAt === null };
    });
  }

  /** `requested | approved → declined`, recording the caller as reviewer. Existing episode recovery continues. */
  declineChannel(
    actorEmail: string,
    channelId: string,
    input: ReviewInput = {},
  ): CatalogChannel {
    const reviewer = users.requireEmail(actorEmail);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, reviewer, now);
      return channels.declineChannel(
        this.#sql,
        channelId,
        reviewer,
        input,
        now,
      );
    });
  }

  /** `declined → requested`, keeping the review fields. The route follows the caller afterwards. */
  requestChannel(channelId: string): CatalogChannel {
    return channels.requestChannel(this.#sql, channelId, Date.now());
  }

  pauseChannel(channelId: string): CatalogChannel {
    return channels.setPause(this.#sql, channelId, "owner", Date.now());
  }

  /** Resume clears either kind of pause. */
  resumeChannel(channelId: string): CatalogChannel {
    return channels.setPause(this.#sql, channelId, null, Date.now());
  }

  /** The catalog's aggregate state for the attention card and health strip; the route adds provider health. */
  getCatalogSummary(): CatalogSummary {
    return catalog.summarize(this.#sql);
  }

  /** The browsable catalog (requested and approved) with management facts, title order. */
  listCatalogManagement(): ChannelManagementRecord[] {
    return catalog.withManagement(
      this.#sql,
      channels.listCatalogChannels(this.#sql),
    );
  }

  /**
   * Channels with their management facts (episode counts, latest run, never-started flag): every
   * status by default, or just the given ids in any status; unknown ids are simply absent.
   */
  listChannelManagement(channelIds?: string[]): ChannelManagementRecord[] {
    const selected = channelIds
      ? channels.listChannelsByIds(this.#sql, requireChannelIds(channelIds))
      : channels.listChannels(this.#sql);
    return catalog.withManagement(this.#sql, selected);
  }

  // --- episodes -------------------------------------------------------------

  /** Available video ids for the given channels; routes derive counts and unread state. */
  listAvailableVideoIds(
    channelIds: string[],
  ): { channelId: string; videoId: string }[] {
    return episodes.listAvailableVideoIds(
      this.#sql,
      requireChannelIds(channelIds),
    );
  }

  countEpisodesByChannel(channelIds: string[]): Record<string, EpisodeCounts> {
    return episodes.countByChannel(this.#sql, requireChannelIds(channelIds));
  }

  /** Available episodes with summaries since `sinceMs` in the given channels, newest first. */
  listDigest(channelIds: string[], sinceMs: number): EpisodeRecord[] {
    if (!Number.isFinite(sinceMs) || sinceMs < 0) {
      throw new DomainError("INVALID_INPUT", "sinceMs must be a timestamp");
    }
    return episodes.listDigest(
      this.#sql,
      requireChannelIds(channelIds),
      sinceMs,
    );
  }

  /** One channel's episodes in every status, newest first, with summaries and processing detail. */
  listEpisodes(
    channelId: string,
    options: ListEpisodesOptions,
  ): EpisodeRecord[] {
    return episodes.listByChannel(this.#sql, requireChannelId(channelId), {
      limit: options.limit,
      relatedScope: requireChannelIds(options.relatedScope),
    });
  }

  /** Back to `pending` with attempts reset; the route starts a one-episode run. */
  retryEpisode(channelId: string, videoId: string): EpisodeRecord {
    const id = requireChannelId(channelId);
    const video = requireVideoId(videoId);
    return this.#transaction(() =>
      episodes.retryEpisode(this.#sql, id, video, Date.now()),
    );
  }

  /** `failed → skipped OWNER`, recording the caller's email as the skipper. */
  skipEpisode(
    actorEmail: string,
    channelId: string,
    videoId: string,
  ): EpisodeRecord {
    const email = users.requireEmail(actorEmail);
    const id = requireChannelId(channelId);
    const video = requireVideoId(videoId);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, email, now);
      return episodes.skipEpisode(this.#sql, id, video, email, now);
    });
  }

  // --- ingestion runs -------------------------------------------------------

  /** Every run of one channel, newest first. */
  listRuns(channelId: string): IngestionRunRecord[] {
    this.#requireChannel(channelId);
    return runs.listByChannel(this.#sql, requireChannelId(channelId));
  }

  // --- followers --------------------------------------------------------------

  /**
   * Records the caller's follow, keeping the Registry's follower record in step with the User DO's
   * own list. `ensureUser` runs first so the foreign key holds for a direct RPC caller that never
   * went through the identity middleware.
   */
  recordFollow(email: string, channelId: string): CatalogChannel {
    const actor = users.requireEmail(email);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, actor, now);
      return followers.recordFollow(this.#sql, channelId, actor, now);
    });
  }

  /** Records the caller's unfollow; the last follower leaving pauses an approved channel. */
  recordUnfollow(email: string, channelId: string): CatalogChannel {
    const actor = users.requireEmail(email);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, actor, now);
      return followers.recordUnfollow(this.#sql, channelId, actor, now);
    });
  }

  /** Active followers per channel, zero-filled. */
  countFollowers(channelIds: string[]): Record<string, number> {
    return followers.countActiveByChannel(
      this.#sql,
      requireChannelIds(channelIds),
    );
  }

  /** One channel's active followers, oldest first. */
  listFollowers(channelId: string): FollowerRecord[] {
    this.#requireChannel(channelId);
    return followers.listActive(this.#sql, requireChannelId(channelId));
  }

  // --- internals (not reachable over RPC) -----------------------------------

  get #sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  #transaction<T>(work: () => T): T {
    return this.ctx.storage.transactionSync(work);
  }

  #requireChannel(channelId: string): CatalogChannel {
    const channel = channels.getChannel(this.#sql, requireChannelId(channelId));
    if (!channel) throw new DomainError("NOT_FOUND", "channel not found");
    return channel;
  }

  #seedOwner(): void {
    const raw = this.env.OWNER_EMAIL;
    const email = normalizeEmail(raw);
    if (!email) {
      console.warn({
        event: "registry.owner_seed_skipped",
        reason: raw ? "malformed" : "unset",
      });
      return;
    }
    users.seedOwner(this.#sql, email, Date.now());
  }
}
