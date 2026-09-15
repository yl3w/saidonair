# Feature spec — M3.2 The attempt ledger

**Written:** 2026-09-13, against `main` at `e37181c`. The second of seven M3 child specs; roadmap
`docs/specs/m3-ingestion-plan.md`.
**Parent:** `docs/specs/m3-ingestion.md` §2 (Attempt gate, Universal recovery rule, Pre-flight gate, Owner episode
actions, Publishing) and §3.3–3.4; PRD §4.2 rules 1–3, 5–7, 9–18, 24–26. This spec restates none of them; it fixes
the Registry contract that implements them.
**Status:** implemented 2026-09-13 on `main`, committed as `620fe88`; `pnpm check` green. Plan and
record: `docs/specs/m3-2-attempt-ledger-plan.md`. Depends on nothing in M3: the schema, read model, and route-driven
writes landed in `4871782` (`docs/specs/api-reference-plan.md` Step 4). No new dependencies.
**Superseded in part 2026-09-14** by `docs/specs/discovery-long-form-feed.md`: discovery reads the long-form uploads
playlist feed, live content is never discovered, and `LIVE_OR_UPCOMING` is retired from every enum, the
`outcome_code` CHECK, `classify()`, and the web copy. Edited below where it said otherwise.

## 1. Summary

The Registry learns to write what it already reads. `4871782` gave it the rewritten `0001`, the read model for runs,
episodes, and attempts, and the writes the routes perform today (channel transitions, follows, Retry's window,
Skip). The ingestion writes do not exist. This chunk adds them as store functions and facade methods:
`recordDiscovery` for a completed feed check and the episodes it creates, and the attempt writes `beginAttempt`,
`markStaged`, `finishAttempt`, `recordBlockedAttempt`, and `completeAttempt`, with every state-machine rule of PRD
§4.2 enforced inside the Durable Object. Nothing calls them yet: each rule is proven in real Durable Object SQLite
under the pool, and no product behaviour changes until M3.4. The chunk creates no table and changes no column.

## 2. Decisions this spec makes

| Question | Decision | Why |
|---|---|---|
| Who decides a run's kind and selection | `recordDiscovery(channelId, feed, now)` takes the whole `ChannelFeed`, or `null` for an unreadable feed, and the Registry decides `initial` versus `scheduled`, applies the selection rule, and writes run and episodes in one transaction. | The rule needs `initial_import_count`, `approved_at`, and the existing episode set, all Registry rows; deciding outside would take three reads and could race. |
| Channel rules inside `recordDiscovery` | `NOT_FOUND` for an unknown channel; `INVALID_STATE` unless `approved`. Pause is not checked. | The discovery cron selects unpaused channels and first approval and Start ignore pause by design (PRD rule 4): one rule per layer. |
| A running attempt is an answer, not an error | `beginAttempt` returns `{ kind: "started", … }` or `{ kind: "running", attempt }`. | Retry's inline reconciliation (M3.5) needs the running attempt's id and age; a `DomainError` carries only a code across RPC. |
| What "current attempt" means | An attempt is current while it is `running` and its `generation_id` equals the episode's `staged_vector_generation`. Every later write checks both or throws `INVALID_STATE`. | The schema has no `current_attempt_id`; the staged generation already names the attempt at work (parent §2 "Attempt gate"). |
| Finishing at or after the deadline | `finishAttempt`, and `recordBlockedAttempt` for an automatic trigger, treat `now ≥ window_deadline_at` as the final result: publication → `failed INGESTION_TIMEOUT` with the attempt's code as `failure_detail`; replacement → window closed, episode unchanged. Before the deadline, `next_attempt_at = min(now + 6 h, deadline)`. | PRD rule 14. An attempt started just before the deadline and finished after it would otherwise schedule a due time already in the past and spend one more attempt for the same answer. |
| `transcript_checked_at` | Set by `markStaged` and by a `finishAttempt` whose code came from the transcript step (`CAPTIONS`, `SHORT`, `NON_ENGLISH`, `UNPLAYABLE`; the set is derived from `WAITING_CODES` and `DETERMINISTIC_SKIP_CODES`, so retiring `LIVE_OR_UPCOMING` on 2026-09-14 needed no edit here). | The column means "when the provider last answered about this video"; nothing else defines it. |
| Related ids are validated at publication | `completeAttempt` keeps, from the candidate list in order, only ids of `available` episodes other than the video itself, at most five. | PRD §5.1: `related_episode_ids_json` is validated in the Registry. The instance needs no second round trip. |
| Generation ids | `crypto.randomUUID()`, minted by `beginAttempt`. | Opaque, contains no `:` (the vector-id separator), needs no coordination. |
| Interval constant | `RETRY_INTERVAL_MS = 6 h` beside `PROCESSING_WINDOW_MS` in `episodes.ts`. | One place for both numbers of the universal rule. |

## 3. Contract (RPC facade, `do/registry.ts`)

| Method | Semantics |
|---|---|
| `recordDiscovery(channelId, feed: ChannelFeed \| null, now): { run: IngestionRun; created: EpisodeRecord[] }` | Requires `approved`. `feed === null`: one run with `feed_status = unavailable`, `discovered_count = 0`, `episode_limit` null; `last_checked_at` unchanged; no episodes. Otherwise `feed_status = read`, `last_checked_at = now`; kind is `initial` when the channel has no episode row, else `scheduled`; `initial` selects the newest `initial_import_count` entries whatever their dates and records `episode_limit`; `scheduled` selects entries with `publishedAt > approved_at`; in both, entries whose `episode_id` already exists anywhere are excluded. Each created episode is `pending`, `intent = publish`, `window_started_at = next_attempt_at = now`, `window_deadline_at = now + 48 h`, `attempt_count = 0`, `discovered_by_run_id = run.runId`. Unselected entries are not remembered. One transaction. |
| `beginAttempt(episodeId, trigger, requestedByEmail, now): AttemptStart` | `NOT_FOUND` unknown episode; `INVALID_STATE` when no window is open. An attempt still `running` → `{ kind: "running", attempt }`. Otherwise mint a generation id; insert a `running` attempt with `workflow_id = attempt_id`, the episode's `intent`, and the requester exactly for `owner_retry`; set `episodes.staged_vector_generation`, `attempt_count += 1`; return `{ kind: "started", attempt, abandonedGeneration }`, where `abandonedGeneration` is `{ generationId, chunkCount }` of the episode's previous attempt when it recorded a `staged_chunk_count` and its generation never became active, else null. |
| `markStaged(attemptId, chunkCount, now): EpisodeIngestionAttempt` | Current attempt only. Sets `staged_chunk_count` and `episodes.transcript_checked_at`. |
| `finishAttempt(attemptId, outcome, now): { attempt; episode }` | `outcome` is one of `{ status: "waiting", code: CAPTIONS \| PROVIDER_LIMIT }`, `{ status: "failed", code: PROVIDER_AUTH \| PROVIDER_RATE_LIMIT \| PROVIDER_HTTP \| PROVIDER_PARSE \| TRANSCRIPT_TOO_LARGE \| EMBEDDING_FAILED \| VECTORIZE_INCOMPLETE \| SUMMARY_FAILED \| WORKFLOW_LOST, detail? }`, or `{ status: "skipped", code: SHORT \| NON_ENGLISH \| UNPLAYABLE }`. Current attempt only. The attempt takes status, code, detail, `finished_at`. The episode, by case: skipped under `publish` → `skipped`, `skip_reason = code`, `skipped_at = now`, window and staged generation cleared; skipped under `replace` → window and staged generation cleared, nothing else; waiting or failed before the deadline → `next_attempt_at = min(now + 6 h, deadline)`, staged generation kept so the next attempt can discard it; waiting or failed at or after the deadline under `publish` → `failed`, `failure_code = INGESTION_TIMEOUT`, `failure_detail = code`, window and staged generation cleared; under `replace` → window and staged generation cleared, episode stays `available`. |
| `recordBlockedAttempt(episodeId, trigger, reason, requestedByEmail, now): { attempt; episode }` | `reason` is `PROVIDER_AUTH` or `PROVIDER_LIMIT`. Inserts a finished `blocked` attempt: no `workflow_id`, `started_at = finished_at = now`, the episode's intent (`replace` when the episode is `available`, else `publish`), the requester exactly for `owner_retry`. `attempt_count` unchanged. `owner_retry` → the episode is untouched. An automatic trigger requires an open window: before the deadline `next_attempt_at = min(now + 6 h, deadline)`; at or after it, the timeout rule of `finishAttempt` with `failure_detail = reason`. |
| `completeAttempt(attemptId, chunkCount, summary: EpisodeSummaryInput, relatedCandidates: string[], now): { attempt; episode; previousGeneration }` | Current attempt only; `chunkCount > 0`. One transaction: upsert `episode_summaries` (format, fields, `related_episode_ids_json` filtered per §2, `model`, `prompt_version`); episode `available`, `chunk_count`, `vectorized_at = now`, `processed_at` only when null, `active_vector_generation = staged_vector_generation`, window and staged generation cleared, `failure_*` and `skip_*` null; attempt `available`, `finished_at`. Returns `previousGeneration = { generationId, chunkCount }` of the generation active before this write, or null on first publication. |

`EpisodeSummaryInput` is `{ format: "structured", executiveSummary, takeaways: { text, startSec: number | null }[],
topicTags, model, promptVersion } | { format: "raw_fallback", rawText, model, promptVersion }`. `AttemptStart` is the
union above. All timestamps are Unix milliseconds passed in by the caller, as `retryEpisode` takes `now` today.

## 4. Acceptance criteria

1. Provenance: `discovered_by_run_id` is set at creation and no method changes it.
2. Feed history: an unavailable read records `unavailable`, zero, and leaves `last_checked_at`; a read with nothing
   new records `read`, zero, and moves it. After an initial import of five from fifteen entries, the other ten exist
   nowhere; a scheduled run over the same feed creates nothing; an entry newer than `approved_at` is created and one
   older is not; a channel whose history is only unavailable or empty runs still selects `initial`.
3. Window: every created episode has the 48-hour window from `now`; an unfinished result at `deadline − 1 ms`
   schedules `next_attempt_at = deadline`; one at `deadline` times out. Both boundaries exact.
4. Attempts: a fourth and fifth launched attempt inside one window increment `attempt_count` and change no status; a
   blocked one does not increment it.
5. Every technical code and every waiting code leaves `failure_code` null before the deadline and writes
   `INGESTION_TIMEOUT` with that code as `failure_detail` at it; the episode counts stay four (no `waiting`).
6. An episode blocked at every automatic start for its whole window times out with `PROVIDER_LIMIT` in
   `failure_detail` and `attempt_count = 0`.
7. Deterministic skips under `publish` set the episode `skipped` with the reason; under `replace` the episode stays
   `available` with summary, `active_vector_generation`, `processed_at`, and `chunk_count` intact while the attempt
   reads `skipped` with the code.
8. `retryEpisode` then `beginAttempt` works under requested, approved, paused, and declined channels; `skipEpisode`
   likewise (existing behaviour, re-asserted beside the new writes).
9. Replacement: `completeAttempt` preserves `processed_at`, swaps summary and generation in one transaction, and
   returns the previous generation and its chunk count; a first publication returns null and sets `processed_at`.
10. Stale refusal: after `finishAttempt`, a second `finishAttempt`, `markStaged`, or `completeAttempt` for the same
    id is `INVALID_STATE`; so is any write by an attempt whose generation is no longer the staged one.
11. `beginAttempt` returns the abandoned generation and its chunk count after a failed attempt that reached
    `markStaged`, and null after one that did not.
12. Related candidates: ids of unavailable episodes and the video's own id are dropped, order is kept, at most five
    are stored.
13. No method writes a channel column other than `last_checked_at`, asserted by comparing the channel row before and
    after each write.
14. `pnpm check` green.

## 5. Out of scope

Fetching RSS (M3.4); pre-flight, launching, the Workflow (M3.5); the due-episode and stale-attempt selection reads
(M3.6); any route change; any web change.

## 6. `AGENTS.md` and PRD alignment

No PRD change: PRD §4.2 already states every rule this chunk enforces. `AGENTS.md` → repo layout: the `do/registry/`
line names `runs` (feed history and `recordDiscovery`), `attempts` (ledger rows), `processing` (the state machine and
the one implementation of the six-hour/deadline rule), and `summaries` (publication write and related-id validation).
