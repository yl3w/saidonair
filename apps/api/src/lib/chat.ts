import type { RegistryDO } from "../do/registry";
import type { UserDO } from "../do/user";
import type { ChatMessageSourceInput, Exchange } from "../do/user/types";
import type { PromptChunk } from "../prompts/chat";
import { CHAT_PROMPT_VERSION, chatPrompt } from "../prompts/chat";
import type { AiClient } from "./ai";
import { DomainError } from "./errors";
import {
  parseVectorId,
  QUERY_TOP_K_MAX,
  type QueryFilter,
  SHARED_NAMESPACE,
  type VectorMatch,
  type VectorStore,
} from "./vectorize";
import { requireEpisodeId } from "./youtube/ids";

/**
 * Answering a chat question (docs/PRD.md §4.5, §6; docs/specs/m4-2-chat-answering.md §3).
 * Five outcomes in a fixed order, each returning early; the order is the contract, not an
 * implementation detail. Runs inline in the request that asked, so nothing polls and the reader
 * gets a finished reply in one round trip.
 */

/** Depth follows the question's scope (docs/PRD.md §6, decided 2026-09-16). */
export const SCOPED_KEEP = 8;
export const SCOPED_CANDIDATES = 16;
export const UNSCOPED_KEEP = 6;
export const UNSCOPED_CANDIDATES = 24;
/** Exchanges of this chat's history in the prompt; the successor is a context budget (PRD §11). */
export const HISTORY_EXCHANGES = 10;

// Vectorize returns at most 50 matches when metadata is requested, and chat always requests it
// because the metadata is the citation. A future edit past the ceiling fails here, loudly, rather
// than at the first real question.
if (
  SCOPED_CANDIDATES > QUERY_TOP_K_MAX ||
  UNSCOPED_CANDIDATES > QUERY_TOP_K_MAX
) {
  throw new Error("chat: candidate counts must not exceed QUERY_TOP_K_MAX");
}

/** Stored verbatim, because a reader rereading next week must see the same sentence. */
export const NO_FOLLOWS_REPLY =
  "Chat requires following at least one approved channel.";
export const SCOPE_INELIGIBLE_REPLY =
  "That episode's channel is no longer one you follow, so it cannot be searched. Remove the episode to ask across everything you follow.";
export const NOTHING_FOUND_REPLY = "Nothing in what you follow covers that.";

export type ChatDeps = {
  user: DurableObjectStub<UserDO>;
  registry: DurableObjectStub<RegistryDO>;
  ai: AiClient;
  vectors: VectorStore;
  /**
   * The caller's eligible channels, from `lib/eligibility.ts`. Passed in rather than computed here:
   * one definition of eligibility serves the digest, receipts and chat alike, and this module has no
   * request to read an identity from.
   */
  eligible: ReadonlySet<string>;
};

export type ChatInput = {
  chatId: string;
  message: string;
  aboutEpisodeId?: string | null;
};

export async function answer(
  deps: ChatDeps,
  input: ChatInput,
): Promise<Exchange> {
  const scope =
    input.aboutEpisodeId == null
      ? null
      : requireEpisodeId(input.aboutEpisodeId);

  // Outcome 1: an episode the catalog does not hold. Before appendExchange, so a malformed hint
  // never leaves an orphan question behind.
  const scopeState = scope === null ? null : await requireScope(deps, scope);

  const exchange = await deps.user.appendExchange(
    input.chatId,
    input.message,
    scope,
  );
  const replyId = exchange.assistantMessage.messageId;

  const eligible = deps.eligible;

  // Outcome 2: nothing to search. No AI, no Vectorize.
  if (eligible.size === 0) return settle(deps, exchange, NO_FOLLOWS_REPLY, []);

  // Outcome 3: a scope that has fallen out of eligibility. Said out loud, never widened silently.
  if (scopeState !== null && !eligible.has(scopeState.channelId)) {
    return settle(deps, exchange, SCOPE_INELIGIBLE_REPLY, []);
  }

  const keep = scope === null ? UNSCOPED_KEEP : SCOPED_KEEP;
  const candidates = scope === null ? UNSCOPED_CANDIDATES : SCOPED_CANDIDATES;
  const filter: QueryFilter =
    scope === null
      ? { channelId: { $in: [...eligible] } }
      : { episodeId: { $eq: scope } };

  let matches: VectorMatch[];
  try {
    const [vector] = await deps.ai.embed([input.message]);
    if (!vector)
      throw new Error("EMBEDDING_FAILED: no vector for the question");
    matches = await deps.vectors.query(SHARED_NAMESPACE, vector, {
      topK: candidates,
      filter,
    });
  } catch (error) {
    return fail(deps, exchange, codeFor(error));
  }

  const kept = await validate(deps, matches, eligible, keep);

  // Outcome 4: nothing survived validation. Vectorize was called; the model is not.
  if (kept.length === 0) {
    return settle(deps, exchange, NOTHING_FOUND_REPLY, []);
  }

  // Outcome 5: an answer.
  const [preferences, recent] = await Promise.all([
    deps.user.getPreferences(),
    // Two extra: this exchange is already stored and is the question, not history.
    deps.user.getMessages(input.chatId, HISTORY_EXCHANGES * 2 + 2),
  ]);
  const asked = new Set([exchange.userMessage.messageId, replyId]);
  const prompt = chatPrompt({
    systemRules: preferences.systemRules,
    history: recent.filter((m) => !asked.has(m.messageId)),
    chunks: kept.map(toPromptChunk),
    question: input.message,
  });

  let text: string;
  let truncated: boolean;
  try {
    ({ text, truncated } = await deps.ai.answer(prompt));
  } catch {
    return fail(deps, exchange, "MODEL_FAILED");
  }

  return settle(
    deps,
    exchange,
    truncated ? trimToSentence(text) : text,
    dedupeByEpisode(kept),
    truncated,
  );
}

/**
 * Cuts a truncated answer at its last complete sentence, dropping the dangling fragment. **Text with
 * no sentence boundary is returned unchanged**: a fragment beats an empty reply, and this is the case
 * that would otherwise blank an answer entirely (docs/PRD.md §9, 2026-09-16).
 */
export function trimToSentence(text: string): string {
  const end = Math.max(
    text.lastIndexOf("."),
    text.lastIndexOf("?"),
    text.lastIndexOf("!"),
  );
  return end === -1 ? text : text.slice(0, end + 1);
}

/** Several chunks from one episode are one citation, at its best-scoring start time. */
function dedupeByEpisode(matches: VectorMatch[]): ChatMessageSourceInput[] {
  const seen = new Set<string>();
  const sources: ChatMessageSourceInput[] = [];
  for (const match of matches) {
    if (seen.has(match.metadata.episodeId)) continue;
    seen.add(match.metadata.episodeId);
    sources.push({
      episodeId: match.metadata.episodeId,
      channelId: match.metadata.channelId,
      episodeTitle: match.metadata.title,
      channelTitle: match.metadata.channelTitle,
      startSec: match.metadata.startSec,
    });
  }
  return sources;
}

/**
 * Keeps matches in score order whose episode is still available, whose channel is still eligible,
 * and whose vector belongs to that episode's active generation (docs/PRD.md §6). An id that does not
 * parse is a rejection like any other.
 */
async function validate(
  deps: ChatDeps,
  matches: readonly VectorMatch[],
  eligible: ReadonlySet<string>,
  keep: number,
): Promise<VectorMatch[]> {
  if (matches.length === 0) return [];
  const states = await deps.registry.listEpisodeStates([
    ...new Set(matches.map((m) => m.metadata.episodeId)),
  ]);
  const byId = new Map(states.map((state) => [state.episodeId, state]));

  const kept: VectorMatch[] = [];
  for (const match of matches) {
    if (kept.length === keep) break;
    const state = byId.get(match.metadata.episodeId);
    // An episode the catalog no longer holds reads undefined here, which is a rejection like any
    // other: a vector can outlive the episode it came from.
    if (state?.status !== "available") continue;
    if (!eligible.has(state.channelId)) continue;
    const parsed = parseVectorId(match.id);
    if (parsed === null) continue;
    if (parsed.generationId !== state.activeVectorGeneration) continue;
    kept.push(match);
  }
  return kept;
}

function toPromptChunk(match: VectorMatch): PromptChunk {
  return {
    title: match.metadata.title,
    channelTitle: match.metadata.channelTitle,
    startSec: match.metadata.startSec,
    text: match.metadata.text,
  };
}

async function requireScope(deps: ChatDeps, episodeId: string) {
  const [state] = await deps.registry.listEpisodeStates([episodeId]);
  if (!state) {
    throw new DomainError(
      "INVALID_INPUT",
      "aboutEpisodeId is not a catalog episode",
    );
  }
  return state;
}

async function settle(
  deps: ChatDeps,
  exchange: Exchange,
  text: string,
  sources: ChatMessageSourceInput[],
  truncated = false,
): Promise<Exchange> {
  const assistantMessage = await deps.user.completeAssistantMessage(
    exchange.assistantMessage.messageId,
    text,
    sources,
    CHAT_PROMPT_VERSION,
    truncated,
  );
  return { userMessage: exchange.userMessage, assistantMessage };
}

async function fail(
  deps: ChatDeps,
  exchange: Exchange,
  code: string,
): Promise<Exchange> {
  const assistantMessage = await deps.user.failAssistantMessage(
    exchange.assistantMessage.messageId,
    code,
  );
  return { userMessage: exchange.userMessage, assistantMessage };
}

function codeFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("EMBEDDING_FAILED")
    ? "EMBEDDING_FAILED"
    : "RETRIEVAL_FAILED";
}
