import { DurableObject } from "cloudflare:workers";
import { userMigrations } from "../../migrations/user";
import type { Env } from "../env";
import { normalizeEmail } from "../lib/email";
import { DomainError } from "../lib/errors";
import { applyMigrations } from "./migrations";
import * as chats from "./user/chats";
import * as follows from "./user/follows";
import * as preferences from "./user/preferences";
import * as reads from "./user/reads";
import type {
  ChannelFollow,
  Chat,
  ChatMessage,
  ChatMessageSourceInput,
  Exchange,
  ListFollowsOptions,
  UserPreferences,
} from "./user/types";

/**
 * One object per normalized email. Normalizes defensively so a single identity can never
 * be split across two objects by caller casing.
 */
export function getUserDO(env: Env, email: string): DurableObjectStub<UserDO> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new DomainError("INVALID_INPUT", "malformed email");
  return env.USER_DO.getByName(normalized);
}

/**
 * Per-user Durable Object: follows, read receipts, chats with messages and citation
 * snapshots, and chat preferences. The email is implicit in the object's name and is
 * never stored or logged here. Every method is scoped to that one user by construction,
 * so a chat or follow that belongs to someone else is simply NOT_FOUND.
 *
 * Cross-DO rules (follow eligibility, unread counts, chat retrieval scope) are composed by
 * `lib/` services against the Registry; this object owns row semantics only. Methods are
 * synchronous; multi-statement writes run in `transactionSync`.
 */
export class UserDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const applied = applyMigrations(ctx.storage, userMigrations);
      if (applied.length > 0) {
        console.log({ event: "user.migrations_applied", versions: applied });
      }
    });
  }

  // --- follows ----------------------------------------------------------------

  /** Explicit follow or refollow. The caller has already checked catalog eligibility. */
  follow(channelId: string): ChannelFollow {
    return follows.follow(this.#sql, channelId, Date.now());
  }

  /** Retains a tombstone that blocks automatic-follow replay. */
  unfollow(channelId: string): ChannelFollow {
    return follows.unfollow(this.#sql, channelId, Date.now());
  }

  /** Automatic follow for an approved request; inserts only when no row exists. */
  autoFollow(
    channelId: string,
    requestId: string,
  ): { follow: ChannelFollow; inserted: boolean } {
    return follows.autoFollow(this.#sql, channelId, requestId, Date.now());
  }

  listFollows(options: ListFollowsOptions = {}): ChannelFollow[] {
    return follows.listFollows(this.#sql, options);
  }

  activeChannelIds(): string[] {
    return follows.activeChannelIds(this.#sql);
  }

  // --- read receipts ----------------------------------------------------------

  /** Records receipts for summaries actually returned to the user; returns how many were new. */
  markRead(videoIds: string[]): number {
    return this.#transaction(() =>
      reads.markRead(this.#sql, videoIds, Date.now()),
    );
  }

  /** The already-read subset of `videoIds`. */
  readVideoIds(videoIds: string[]): string[] {
    return reads.readVideoIds(this.#sql, videoIds);
  }

  // --- chats ------------------------------------------------------------------

  createChat(title?: string): Chat {
    return chats.createChat(this.#sql, title, Date.now());
  }

  listChats(): Chat[] {
    return chats.listChats(this.#sql);
  }

  getMessages(chatId: string, limit?: number): ChatMessage[] {
    return chats.getMessages(this.#sql, chatId, limit);
  }

  /** Phase one of an exchange: completed question plus pending reply. */
  appendExchange(chatId: string, content: string): Exchange {
    return this.#transaction(() =>
      chats.appendExchange(this.#sql, chatId, content, Date.now()),
    );
  }

  /** Phase two, success: reply text and ordered citation snapshots. */
  completeAssistantMessage(
    messageId: string,
    content: string,
    sources: ChatMessageSourceInput[],
  ): ChatMessage {
    return this.#transaction(() =>
      chats.completeAssistantMessage(
        this.#sql,
        messageId,
        content,
        sources,
        Date.now(),
      ),
    );
  }

  /** Phase two, failure: the reply stays empty and records the reason code. */
  failAssistantMessage(messageId: string, failureCode: string): ChatMessage {
    return chats.failAssistantMessage(
      this.#sql,
      messageId,
      failureCode,
      Date.now(),
    );
  }

  // --- preferences ------------------------------------------------------------

  getPreferences(): UserPreferences {
    return preferences.getPreferences(this.#sql);
  }

  setPreferences(systemRules: string): UserPreferences {
    return preferences.setPreferences(this.#sql, systemRules, Date.now());
  }

  // --- internals (not reachable over RPC) -------------------------------------

  get #sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  #transaction<T>(work: () => T): T {
    return this.ctx.storage.transactionSync(work);
  }
}
