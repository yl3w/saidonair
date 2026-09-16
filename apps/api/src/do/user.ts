import { DurableObject } from "cloudflare:workers";
import { userMigrations } from "../../migrations/user";
import type { Env } from "../env";
import { normalizeEmail } from "../lib/email";
import { DomainError } from "../lib/errors";
import { applyMigrations } from "./migrations";
import * as chats from "./user/chats";
import * as preferences from "./user/preferences";
import * as reads from "./user/reads";
import type {
  Chat,
  ChatMessage,
  ChatMessageSourceInput,
  Exchange,
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
 * Per-user Durable Object: read receipts, chats with messages and citation snapshots, and
 * chat preferences, the state that is private to one user. Follows are not here: the
 * Registry's follower record is their one record (docs/specs/follows-single-owner.md), and
 * it answers the user's list, `following`, and eligibility. The email is implicit in the
 * object's name and is never stored or logged here. Every method is scoped to that one user
 * by construction, so a chat that belongs to someone else is simply NOT_FOUND.
 *
 * Cross-DO rules (unread counts, chat retrieval scope) are composed by the routes against
 * the Registry; this object owns row semantics only. Methods are synchronous;
 * multi-statement writes run in `transactionSync`.
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

  // --- read receipts ----------------------------------------------------------

  /** Records receipts for summaries actually returned to the user; returns how many were new. */
  markRead(episodeIds: string[]): number {
    return this.#transaction(() =>
      reads.markRead(this.#sql, episodeIds, Date.now()),
    );
  }

  /** Removes receipts for the given summaries; returns how many rows went. */
  clearRead(episodeIds: string[]): number {
    return this.#transaction(() => reads.clearRead(this.#sql, episodeIds));
  }

  /** The already-read subset of `episodeIds`. */
  readEpisodeIds(episodeIds: string[]): string[] {
    return reads.readEpisodeIds(this.#sql, episodeIds);
  }

  // --- chats ------------------------------------------------------------------

  createChat(title?: string): Chat {
    return chats.createChat(this.#sql, title, Date.now());
  }

  listChats(): Chat[] {
    return chats.listChats(this.#sql);
  }

  getChat(chatId: string): Chat {
    return chats.getChat(this.#sql, chatId);
  }

  /**
   * Reconciles a reply that outlived its request before reading (docs/specs/m4-2-chat-answering.md
   * §3.7), so this is a write and takes the transaction the other writers take.
   */
  getMessages(chatId: string, limit?: number): ChatMessage[] {
    return this.#transaction(() => chats.getMessages(this.#sql, chatId, limit));
  }

  /**
   * Phase one of an exchange: completed question plus pending reply. `aboutEpisodeId`
   * scopes the question to one episode (docs/PRD.md §4.5).
   */
  appendExchange(
    chatId: string,
    content: string,
    aboutEpisodeId?: string | null,
  ): Exchange {
    return this.#transaction(() =>
      chats.appendExchange(
        this.#sql,
        chatId,
        content,
        Date.now(),
        aboutEpisodeId,
      ),
    );
  }

  /** Phase two, success: reply text and ordered citation snapshots. */
  completeAssistantMessage(
    messageId: string,
    content: string,
    sources: ChatMessageSourceInput[],
    promptVersion: string,
    truncated: boolean,
  ): ChatMessage {
    return this.#transaction(() =>
      chats.completeAssistantMessage(
        this.#sql,
        messageId,
        content,
        sources,
        Date.now(),
        promptVersion,
        truncated,
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
