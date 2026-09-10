import { DurableObject } from "cloudflare:workers";
import type { Catalog, EpisodeCounts } from "@media-digest/shared";
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
 * shared summaries, and ingestion runs (reads only until M3 writes them).
 *
 * Every public method is an RPC endpoint. Owner-only methods take the acting email first and
 * verify the `owner` role here, so a route bug can never grant catalog management to a user.
 * Read methods that any caller may use are scoped by the channel ids the caller passes; the
 * routes compose them with the caller's follows. Methods are synchronous: DO input gates make
 * each call atomic against other callers, and multi-statement writes are additionally wrapped
 * in `transactionSync`.
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

  /** Owner: every channel in every status. */
  listChannels(actorEmail: string): CatalogChannel[] {
    this.#assertOwner(actorEmail);
    return channels.listChannels(this.#sql);
  }

  /**
   * Anyone creates a `requested` channel; only the owner creates an `approved` one. Create-only:
   * `INVALID_STATE` when the id exists, which the route turns into follow or request-again.
   */
  createChannel(email: string, input: CreateChannelInput): CatalogChannel {
    const actor = users.requireEmail(email);
    if (input.status === "approved") this.#assertOwner(actor);
    return this.#transaction(() =>
      channels.createChannel(
        this.#sql,
        {
          ...input,
          reviewer: input.status === "approved" ? actor : undefined,
        },
        Date.now(),
      ),
    );
  }

  /**
   * Owner: `requested | declined → approved`. `importStarts` is true when approved_at was null
   * before. A channel nobody actively follows is paused by the system at once, so approving one
   * with no followers never leaves it running unattended (Ruling R4).
   */
  approveChannel(
    actorEmail: string,
    channelId: string,
    input: ReviewInput = {},
  ): { channel: CatalogChannel; importStarts: boolean } {
    const reviewer = this.#assertOwner(actorEmail);
    return this.#transaction(() => {
      const before = channels.requireChannel(
        this.#sql,
        requireChannelId(channelId),
      );
      const now = Date.now();
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

  /** Owner: `requested | approved → declined`; from approved the fence is bumped. */
  declineChannel(
    actorEmail: string,
    channelId: string,
    input: ReviewInput = {},
  ): CatalogChannel {
    const reviewer = this.#assertOwner(actorEmail);
    return channels.declineChannel(
      this.#sql,
      channelId,
      reviewer,
      input,
      Date.now(),
    );
  }

  /** Anyone: `declined → requested`. The route follows the caller afterwards. */
  requestChannel(email: string, channelId: string): CatalogChannel {
    users.requireEmail(email);
    return channels.requestChannel(this.#sql, channelId, Date.now());
  }

  pauseChannel(actorEmail: string, channelId: string): CatalogChannel {
    this.#assertOwner(actorEmail);
    return channels.setPause(this.#sql, channelId, "owner", Date.now());
  }

  /** Owner resume clears either kind of pause. */
  resumeChannel(actorEmail: string, channelId: string): CatalogChannel {
    this.#assertOwner(actorEmail);
    return channels.setPause(this.#sql, channelId, null, Date.now());
  }

  /** Owner: the catalog's aggregate state for the attention card and health strip. */
  getCatalogSummary(actorEmail: string): Catalog {
    this.#assertOwner(actorEmail);
    return catalog.summarize(this.#sql);
  }

  /**
   * Owner: channels with their management facts (episode counts, latest run, never-started flag).
   * All channels in every status by default, or just the given ids.
   */
  listChannelManagement(
    actorEmail: string,
    channelIds?: string[],
  ): ChannelManagementRecord[] {
    this.#assertOwner(actorEmail);
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

  /** Processed episodes with summaries since `sinceMs` in the given channels, newest first. */
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

  /** One channel's episodes in every status, newest first; the route decides what the caller sees. */
  listEpisodes(
    channelId: string,
    options: ListEpisodesOptions,
  ): EpisodeRecord[] {
    return episodes.listByChannel(this.#sql, requireChannelId(channelId), {
      limit: options.limit,
      relatedScope: requireChannelIds(options.relatedScope),
    });
  }

  /** Owner: back to `pending` with attempts reset; the route starts a one-episode run. */
  retryEpisode(
    actorEmail: string,
    channelId: string,
    videoId: string,
  ): EpisodeRecord {
    this.#assertOwner(actorEmail);
    const id = requireChannelId(channelId);
    const video = requireVideoId(videoId);
    return this.#transaction(() =>
      episodes.retryEpisode(this.#sql, id, video, Date.now()),
    );
  }

  /** Owner: `failed → skipped OWNER`. */
  skipEpisode(
    actorEmail: string,
    channelId: string,
    videoId: string,
  ): EpisodeRecord {
    const email = this.#assertOwner(actorEmail);
    const id = requireChannelId(channelId);
    const video = requireVideoId(videoId);
    return this.#transaction(() =>
      episodes.skipEpisode(this.#sql, id, video, email, Date.now()),
    );
  }

  // --- ingestion runs -------------------------------------------------------

  /** Owner: every run of one channel with per-episode outcomes, newest first. */
  listRuns(actorEmail: string, channelId: string): IngestionRunRecord[] {
    this.#assertOwner(actorEmail);
    this.#requireChannel(channelId);
    return runs.listByChannel(this.#sql, requireChannelId(channelId));
  }

  // --- followers --------------------------------------------------------------

  /**
   * Anyone: records the caller's follow, keeping the Registry's follower record in step with the
   * User DO's own list. `ensureUser` runs first so the foreign key holds for a direct RPC caller
   * that never went through the identity middleware.
   */
  recordFollow(email: string, channelId: string): CatalogChannel {
    const actor = users.requireEmail(email);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, actor, now);
      return followers.recordFollow(this.#sql, channelId, actor, now);
    });
  }

  /** Anyone: records the caller's unfollow; the last follower leaving pauses an approved channel. */
  recordUnfollow(email: string, channelId: string): CatalogChannel {
    const actor = users.requireEmail(email);
    return this.#transaction(() => {
      const now = Date.now();
      users.ensureUser(this.#sql, actor, now);
      return followers.recordUnfollow(this.#sql, channelId, actor, now);
    });
  }

  /** Active followers per channel, zero-filled; any caller may check counts for channels they can see. */
  countFollowers(channelIds: string[]): Record<string, number> {
    return followers.countActiveByChannel(
      this.#sql,
      requireChannelIds(channelIds),
    );
  }

  /** Owner: one channel's active followers, oldest first. */
  listFollowers(actorEmail: string, channelId: string): FollowerRecord[] {
    this.#assertOwner(actorEmail);
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

  /** Returns the normalized actor email once the owner role is confirmed. */
  #assertOwner(actorEmail: string): string {
    const email = users.requireEmail(actorEmail);
    users.assertOwner(this.#sql, email);
    return email;
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
