import { DurableObject } from "cloudflare:workers";
import { registryMigrations } from "../../migrations/registry";
import type { Env } from "../env";
import { normalizeEmail } from "../lib/email";
import { requireChannelId } from "../lib/youtube/ids";
import { applyMigrations } from "./migrations";
import * as channels from "./registry/channels";
import * as requests from "./registry/requests";
import type {
  ApproveRequestInput,
  CatalogChannel,
  ChannelRequest,
  ConfigureChannelInput,
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
 * and (schema only for now) episodes, summaries, and ingestion runs.
 *
 * Every public method is an RPC endpoint. Owner-only methods take the acting email first and
 * verify the `owner` role here, so a route bug can never grant catalog management to a user.
 * Methods are synchronous: DO input gates make each call atomic against other callers, and
 * multi-statement writes are additionally wrapped in `transactionSync`.
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

  getChannel(channelId: string): CatalogChannel | null {
    return channels.getChannel(this.#sql, requireChannelId(channelId));
  }

  /** Owner: every channel in every state, including deleted. */
  listChannels(actorEmail: string): CatalogChannel[] {
    this.#assertOwner(actorEmail);
    return channels.listChannels(this.#sql);
  }

  /** Owner: create a pending channel or update an existing one's configuration. */
  configureChannel(
    actorEmail: string,
    input: ConfigureChannelInput,
  ): { channel: CatalogChannel; created: boolean } {
    this.#assertOwner(actorEmail);
    return this.#transaction(() =>
      channels.configureChannel(this.#sql, input, Date.now()),
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

  /**
   * Owner: approve a pending request, creating or reusing the shared channel.
   * `channelCreated` signals that initial ingestion should be started by the caller.
   */
  approveRequest(
    actorEmail: string,
    requestId: string,
    input: ApproveRequestInput,
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
