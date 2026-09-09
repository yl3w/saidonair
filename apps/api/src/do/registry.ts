import { DurableObject } from "cloudflare:workers";
import type { Catalog, EpisodeCounts } from "@media-digest/shared";
import { registryMigrations } from "../../migrations/registry";
import type { Env } from "../env";
import { normalizeEmail } from "../lib/email";
import { DomainError } from "../lib/errors";
import { requireChannelId, requireChannelIds } from "../lib/youtube/ids";
import { applyMigrations } from "./migrations";
import * as catalog from "./registry/catalog";
import * as channels from "./registry/channels";
import * as episodes from "./registry/episodes";
import * as requests from "./registry/requests";
import * as runs from "./registry/runs";
import type {
  ApproveRequestInput,
  CatalogChannel,
  ChannelManagementRecord,
  ChannelRequest,
  CreateChannelInput,
  EpisodeRecord,
  IngestionRunRecord,
  ListEpisodesOptions,
  RegistryUser,
  RejectRequestInput,
  SubmitRequestInput,
} from "./registry/types";
import * as users from "./registry/users";

/** There is exactly one Registry; every caller addresses it by this name. */
const REGISTRY_NAME = "global";

export function getRegistry(env: Env): DurableObjectStub<RegistryDO> {
  return env.REGISTRY_DO.getByName(REGISTRY_NAME);
}

/**
 * Global Registry Durable Object: identities, the shared channel catalog, approval requests,
 * episodes with their shared summaries, and ingestion runs (reads only until M3 writes them).
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

  listAvailableChannels(): CatalogChannel[] {
    return channels.listAvailableChannels(this.#sql);
  }

  /** Any state, including deleted; used for follows, request outcomes, and channel views. */
  listChannelsByIds(channelIds: string[]): CatalogChannel[] {
    return channels.listChannelsByIds(this.#sql, requireChannelIds(channelIds));
  }

  getChannel(channelId: string): CatalogChannel | null {
    return channels.getChannel(this.#sql, requireChannelId(channelId));
  }

  /** Owner: every channel in every state, including deleted. */
  listChannels(actorEmail: string): CatalogChannel[] {
    this.#assertOwner(actorEmail);
    return channels.listChannels(this.#sql);
  }

  /** Owner: create a pending channel; `INVALID_STATE` when the id is already in the catalog. */
  createChannel(actorEmail: string, input: CreateChannelInput): CatalogChannel {
    this.#assertOwner(actorEmail);
    return this.#transaction(() =>
      channels.createChannel(this.#sql, input, Date.now()),
    );
  }

  /** Owner: `failed → pending`, clearing the failure and fencing stale runs. */
  retryChannel(actorEmail: string, channelId: string): CatalogChannel {
    this.#assertOwner(actorEmail);
    return channels.retryChannel(this.#sql, channelId, Date.now());
  }

  /** Owner: soft delete; follows, episodes, summaries, and vectors are all retained. */
  deleteChannel(actorEmail: string, channelId: string): CatalogChannel {
    this.#assertOwner(actorEmail);
    return channels.deleteChannel(this.#sql, channelId, Date.now());
  }

  /** Owner: undo soft delete without changing processing state. */
  restoreChannel(actorEmail: string, channelId: string): CatalogChannel {
    this.#assertOwner(actorEmail);
    return channels.restoreChannel(this.#sql, channelId, Date.now());
  }

  /** Owner: the catalog's aggregate state for the attention card and health strip. */
  getCatalogSummary(actorEmail: string): Catalog {
    this.#assertOwner(actorEmail);
    return catalog.summarize(this.#sql);
  }

  /**
   * Owner: channels with their management facts (episode counts, latest run, requester count,
   * stuck flag). All channels in every state by default, or just the given ids.
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

  /** Processed video ids for the given channels; routes derive counts and unread state. */
  listProcessedVideoIds(
    channelIds: string[],
  ): { channelId: string; videoId: string }[] {
    return episodes.listProcessedVideoIds(
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

  // --- ingestion runs -------------------------------------------------------

  /** Owner: every run of one channel with per-episode outcomes, newest first. */
  listRuns(actorEmail: string, channelId: string): IngestionRunRecord[] {
    this.#assertOwner(actorEmail);
    this.#requireChannel(channelId);
    return runs.listByChannel(this.#sql, requireChannelId(channelId));
  }

  // --- channel requests -----------------------------------------------------

  submitRequest(email: string, input: SubmitRequestInput): ChannelRequest {
    return this.#transaction(() =>
      requests.submitRequest(
        this.#sql,
        users.requireEmail(email),
        input,
        Date.now(),
      ),
    );
  }

  listOwnRequests(email: string): ChannelRequest[] {
    return requests.listOwnRequests(this.#sql, users.requireEmail(email));
  }

  /** Owner: the review queue across all users. */
  listAllRequests(actorEmail: string): ChannelRequest[] {
    this.#assertOwner(actorEmail);
    return requests.listAllRequests(this.#sql);
  }

  /** Owner: every requester's request for one channel, newest first. */
  listRequestsForChannel(
    actorEmail: string,
    channelId: string,
  ): ChannelRequest[] {
    this.#assertOwner(actorEmail);
    return requests.listByChannel(this.#sql, requireChannelId(channelId));
  }

  /**
   * Owner: approve a pending request, creating or reusing the shared channel; refused while
   * the channel is deleted. `channelCreated` signals that initial ingestion should start.
   */
  approveRequest(
    actorEmail: string,
    requestId: string,
    input: ApproveRequestInput = {},
  ): {
    request: ChannelRequest;
    channel: CatalogChannel;
    channelCreated: boolean;
  } {
    const reviewer = this.#assertOwner(actorEmail);
    return this.#transaction(() =>
      requests.approveRequest(
        this.#sql,
        reviewer,
        requestId,
        input,
        Date.now(),
      ),
    );
  }

  rejectRequest(
    actorEmail: string,
    requestId: string,
    input: RejectRequestInput = {},
  ): ChannelRequest {
    const reviewer = this.#assertOwner(actorEmail);
    return requests.rejectRequest(
      this.#sql,
      reviewer,
      requestId,
      input,
      Date.now(),
    );
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
