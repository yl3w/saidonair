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

/**
 * Depth follows the question's scope (docs/PRD.md §6, decided 2026-09-16). Since
 * `docs/specs/chat-relevance-rerank.md` these are **caps, not quotas**: the floor below decides how
 * many chunks a question deserves, and these decide how many it may have at most.
 */
export const SCOPED_KEEP = 8;
export const SCOPED_CANDIDATES = 16;
export const UNSCOPED_KEEP = 6;
export const UNSCOPED_CANDIDATES = 24;
/**
 * The cross-encoder score below which a chunk does not bear on the question
 * (docs/specs/chat-relevance-rerank.md §4.3). Measured, not guessed: at this value a question the
 * corpus answers kept six chunks, one it partly answers kept one, and one it does not answer at all
 * kept none — where the embedder's own cosine score had ranked the unanswerable question *highest*
 * of the three and could carry no floor at any value.
 *
 * Three questions is three. `chat.reranked` logs what real ones score, and this constant is the one
 * thing to move when they say it is wrong.
 */
export const RELEVANCE_FLOOR = 0.01;
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
/**
 * The same outcome for a scoped question, which needs its own words: the reader asked about one
 * episode, and "what you follow" names something they did not ask about — worse, it reads as though
 * the episode was never searched (owner decision 2026-09-17, choosing to floor scoped questions too).
 */
export const SCOPE_NOTHING_FOUND_REPLY = "Nothing in this episode covers that.";

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

  const validated = await validate(deps, matches, eligible);
  const kept = await rank(deps, input.message, validated, keep, scope !== null);

  // Outcome 4: nothing survived validation, or nothing cleared the floor. Vectorize was called; the
  // answering model is not.
  if (kept.length === 0) {
    // The reader sees one sentence either way, so these two are logged apart. A filter that matches
    // nothing is the signature of a metadata index that does not cover the property being filtered
    // on — Vectorize answers that with zero matches and no error (docs/PRD.md §9, 2026-09-16) — and
    // a run of them against a scoped filter while unscoped questions still answer is the shape of
    // infrastructure drift, not of an empty catalog. Counts and shapes only: no question text and
    // no transcript ever reaches a log (docs/PRD.md §1).
    console.log({
      event:
        matches.length === 0
          ? "chat.no_matches"
          : validated.length === 0
            ? "chat.none_validated"
            : "chat.below_floor",
      filter: scope === null ? "channelId" : "episodeId",
      candidates,
      matched: matches.length,
      validated: validated.length,
      eligibleChannels: eligible.size,
    });
    return settle(
      deps,
      exchange,
      scope === null ? NOTHING_FOUND_REPLY : SCOPE_NOTHING_FOUND_REPLY,
      [],
    );
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
    kept.map(toSource),
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

/**
 * The chunks that bear on the question, best first, capped at `keep`
 * (docs/specs/chat-relevance-rerank.md §4.2).
 *
 * **Vector similarity ranks; the cross-encoder decides.** The embedder compares two independently
 * made vectors, and its score answers "is this text like that text" — which is not the question
 * being asked of it. Measured on 2026-09-17: a question the corpus could not answer at all scored
 * *higher* than one it answered well, so no floor on that score is expressible at any value, and a
 * chunk about Steve Jobs outranked three passages about the subject actually asked after. The
 * cross-encoder reads the pair together and put that same chunk 22nd of 24.
 *
 * A failure here costs ordering, never an answer: the vector order and the cap are exactly what this
 * function did before the reranker existed, so the fallback is the old behaviour rather than a
 * degraded one.
 */
async function rank(
  deps: ChatDeps,
  question: string,
  validated: readonly VectorMatch[],
  keep: number,
  scoped: boolean,
): Promise<VectorMatch[]> {
  if (validated.length === 0) return [];

  let scores: number[];
  try {
    scores = await deps.ai.rerank(
      question,
      validated.map((match) => match.metadata.text),
    );
  } catch (error) {
    console.log({
      event: "chat.rerank_failed",
      validated: validated.length,
      detail: error instanceof Error ? error.message : String(error),
    });
    return [...validated].slice(0, keep);
  }

  // Sorted on score alone, and `sort` is stable, so chunks scoring exactly alike keep the order the
  // vector query gave them. Ties are not hypothetical: a duplicated vector scores identically to its
  // twin, and an arbitrary order between equals would make a test flaky for no reason.
  const ranked = validated
    .map((match, index) => ({ match, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const above = ranked.filter((row) => row.score >= RELEVANCE_FLOOR);

  console.log({
    event: "chat.reranked",
    scoped,
    validated: validated.length,
    aboveFloor: above.length,
    kept: Math.min(above.length, keep),
    topScore: round(ranked[0]?.score),
    keptFloor: round(above[Math.min(above.length, keep) - 1]?.score),
  });

  return above.slice(0, keep).map((row) => row.match);
}

/** Four places is enough to tune a floor by and short enough to read in a log line. */
function round(score: number | undefined): number | null {
  return score === undefined ? null : Math.round(score * 10000) / 10000;
}

/**
 * Every validated chunk is its own source, in score order, including several from one episode.
 * **Grouping is the reader's view, not the record** (decided 2026-09-16): unscoped, the unit of
 * citation is the episode; scoped, every chunk is that same episode and the only thing a citation
 * can carry is *when*. Collapsing here would throw the timestamps away before the web could choose,
 * and a scoped answer would show one jump point for evidence drawn from eight.
 */
function toSource(match: VectorMatch): ChatMessageSourceInput {
  return {
    episodeId: match.metadata.episodeId,
    channelId: match.metadata.channelId,
    episodeTitle: match.metadata.title,
    channelTitle: match.metadata.channelTitle,
    startSec: match.metadata.startSec,
  };
}

/**
 * Every match whose episode is still available, whose channel is still eligible, and whose vector
 * belongs to that episode's active generation (docs/PRD.md §6), in the order Vectorize returned
 * them. An id that does not parse is a rejection like any other.
 *
 * **Every candidate, not the first few.** It stopped at the keep count until
 * `docs/specs/chat-relevance-rerank.md`, which is the wrong shape once something downstream reorders:
 * the chunk that turned out to matter most for the question that occasioned that spec sat at
 * candidate 7 of 24 and was never validated at all.
 */
async function validate(
  deps: ChatDeps,
  matches: readonly VectorMatch[],
  eligible: ReadonlySet<string>,
): Promise<VectorMatch[]> {
  if (matches.length === 0) return [];
  const states = await deps.registry.listEpisodeStates([
    ...new Set(matches.map((m) => m.metadata.episodeId)),
  ]);
  const byId = new Map(states.map((state) => [state.episodeId, state]));

  const kept: VectorMatch[] = [];
  for (const match of matches) {
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
