# Chat and grounded answers

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and conversation flow

Signed-in readers ask questions against an episode or across their currently
eligible channels. Conversations and source snapshots remain private in their
User DO. The owner role does not grant access to another reader's chats.

The web's offered entry is Ask on a summary. It hands an episode ID through an
in-memory module variable to `/chats/new`. The first submitted question creates
the chat and then sends the message; opening or abandoning the composer alone
creates nothing. Creation and sending are separate API requests, so a failed
first send can leave an empty chat after creation succeeds.

The scope chip can be cleared to search across follows. Scope is stored on each
question, not in the URL or a mutable chat-wide field. Existing conversations
restore it from their last loaded question. Reloading an empty composer or opening
Ask in another tab loses the in-memory scope and starts unscoped. An authenticated
caller can also navigate directly to `/chats/new`; the API permits chat creation
without an originating episode.

`/chats` lists conversations by latest activity, grouped by local day. Rows derive
their display name and excerpt from messages. A conversation has its own bar,
message list, scope control, and composer. There is no search, rename, deletion,
streaming, or background polling flow in these screens/routes.

## Answering pipeline

`POST /chats/:chatId/messages` completes the answering work within the request:

1. Validate an optional episode scope against the catalog. An unknown scope is
   rejected before appending the exchange.
2. Store the question as completed and an assistant placeholder as pending.
3. If no channels are eligible, store the fixed follow-required answer. If a
   scoped episode's channel is ineligible, store the fixed scope-unavailable answer.
   Neither path calls AI or Vectorize.
4. Embed the question. Query `shared-catalog` with an `episodeId` filter when
   scoped, otherwise a `channelId` filter containing eligible channels. There is
   no unfiltered fallback.
5. Validate every returned candidate against Registry episode state: available,
   eligible channel, parseable vector ID, and active generation.
6. Rerank the validated text with `@cf/baai/bge-reranker-base`. Retain scores at
   least `0.01`, up to the scope's limit. Reranker failure falls back to validated
   vector order and the same keep limit, without applying a relevance floor.
7. If nothing remains, store the appropriate episode/follows “nothing covers
   that” answer without calling the answering model. Otherwise build the prompt
   from excerpts, recent messages, and the user's saved chat rules, then answer
   with the configured Llama 3.3 Workers AI model.
8. Persist the response and code-generated source snapshots together.

| Search | Candidates requested | Maximum chunks kept |
|---|---:|---:|
| One episode | 16 | 8 |
| Eligible follows | 24 | 6 |

The model output cap is 1,024 tokens. A detected truncated response is stored
completed with `truncated: true`, trimmed to the last sentence where possible.
It does not become a failed answer merely for reaching the cap.

## Sources, failures, and retention

Each kept chunk becomes a stored source containing episode/channel IDs, title
snapshots, timestamp, and position. Code attaches these from retrieved evidence;
the model is not asked to generate citation markers. The UI groups sources by
episode and sorts timestamps within groups. This identifies supplied evidence,
not a verified sentence-by-sentence proof of the generated answer.

Embedding, retrieval, and answering-model failures settle the assistant message
as failed while retaining the question. On a later message read, pending replies
older than 120 seconds are reconciled to `ANSWER_TIMEOUT`. This is read-time
reconciliation, not a timer that aborts the model request. Try again submits another
exchange using the earlier question and scope. Existing messages/snapshots survive
unfollow and channel decline; new questions use current eligibility.

## API, storage, and source map

`POST /chats`, `GET /chats`, and `GET`/`POST /chats/:chatId/messages` are defined
in [chat routes](../../apps/api/src/routes/chats.ts).
[Answering](../../apps/api/src/lib/chat.ts) owns retrieval and settlement;
[chat prompts](../../apps/api/src/prompts/chat.ts) and
[AI wrappers](../../apps/api/src/lib/ai.ts) own model inputs/calls.
[User chat storage](../../apps/api/src/do/user/chats.ts) owns `chats`,
`chat_messages`, and `chat_message_sources`.

[Chat](../../apps/web/src/screens/Chat.tsx),
[Chats](../../apps/web/src/screens/Chats.tsx),
[row projection](../../apps/web/src/lib/chat-rows.ts), and
[source cards](../../apps/web/src/components/SourceCards.tsx) implement presentation.

## Tests, limitations, and PRD differences

[Answering tests](../../apps/api/test/chat.test.ts) cover filtering, validation,
reranking/fallback, fixed answers, truncation, and errors.
[Route tests](../../apps/api/test/routes-chats.test.ts),
[storage tests](../../apps/api/test/user-chats.test.ts), and
[scope rendering tests](../../apps/web/test/scope-chip.test.tsx) cover persistence
and presentation decisions. Fakes do not establish factual model quality.

Messages default to the latest 50 and are capped at 200, returned in ascending
sequence with no older-page cursor. The web conversation uses the default; list
previews fetch bounded message sets. Long conversations can therefore lose their
true opening question from the visible/name derivation even though it remains
stored. The list also performs per-chat message reads.

[PRD §4.5, §6, and §7](../../docs/PRD.md) contain historical M4-future language;
chat is implemented. “Starts only from Ask” is a UI entry convention, not an API
requirement. Answer rendering linkifies both `youtube.com` and `youtu.be`, despite
older text naming only `youtube.com`. Retrieval requires live Vectorize metadata
indexes for `channelId` and `episodeId`; repository tests do not verify those
remote indexes.
