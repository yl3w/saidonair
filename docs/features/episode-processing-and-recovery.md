# Episode processing and recovery

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and units of work

Processing acquires a transcript and prepares an episode for publication.
Recovery gives unfinished episodes further attempts without rediscovering them.
An episode's settled content state and its attempt history are separate:

| Unit | States or intent |
|---|---|
| Episode | `pending`, `available`, `failed`, `skipped` |
| Processing window | `publish` for first content, `replace` for an available episode, or closed |
| Attempt | `running`, `blocked`, `waiting`, `available`, `failed`, `skipped` |

An attempt can fail while its episode remains pending for recovery. An available
episode can have a replacement running while its existing content remains usable.

## Start and transcript flow

`startEpisodeAttempts` performs one transcript-provider health preflight per
nonempty batch. A rejected key or exactly zero known credits blocks starts.
Unreachable/unknown health permits an attempt. Each block records a ledger row
but creates no Workflow and does not increment the launched-attempt count.

Otherwise, the Registry admits at most one running attempt per episode, assigns
a fresh staged generation, and the launcher creates one Workflow instance. Batch
launches start with delays of `k × 3` seconds. A launch error is settled as
`WORKFLOW_LOST`; other episodes in the batch can continue.

The Workflow loads its attempt and exits if it is no longer current. It retrieves
the transcript through DownSub: an authenticated public-video-URL request followed
by at most one unauthenticated download of the chosen VTT track. Manual English
captions are preferred to automatic English captions; translated tracks are not
used. Workflow steps, rather than the adapter, own retries and timeouts.

Classification determines the next step:

- Known duration below 180 seconds: deterministic `SHORT` skip. Unknown duration
  is not treated as short.
- Non-English captions: `NON_ENGLISH` skip; an unplayable video: `UNPLAYABLE` skip.
- Missing/empty captions: wait with `CAPTIONS`; exhausted credits during retrieval:
  wait with `PROVIDER_LIMIT`.
- Provider/parse/technical errors: failed attempt with the relevant code.
- Transcript results exceeding 700,000 serialized bytes: `TRANSCRIPT_TOO_LARGE`.

Usable segments become deterministic chunks targeting about 60 seconds of speech,
with a soft 400-token estimate and hard 480-token estimate. The estimate is four
characters per token. Adjacent chunks overlap one or two segments when progress
permits; oversized segments are split. Chunks feed
[summary/vector publication](summary-generation-and-publication.md).

## Recovery and owner actions

An initial publication window lasts 48 hours from discovery. Unsuccessful
nonterminal outcomes before the deadline schedule another attempt six hours later,
capped at the deadline. The recovery cron (`30 */6 * * *`, production only)
reconciles running attempts older than an hour, then starts due episodes regardless
of channel status or pause. It does not read RSS.

Engine status `active` keeps an attempt running. A gone/missing instance is settled
as `WORKFLOW_LOST`. A due episode at or after its deadline receives a final attempt;
an unsuccessful final result makes a first publication fail with
`INGESTION_TIMEOUT`, or closes a replacement window while preserving old content.
Automatic provider blocks also settle an expired window. Wall-clock expiry alone
does not schedule an exact-time callback: recovery ticks drive this work.

Owner Retry refuses a young running attempt; after an hour it checks the engine
before allowing takeover. A provider-blocked owner retry records a blocked attempt
and leaves the episode unchanged. A permitted retry opens a fresh 48-hour window,
using replacement intent for available content. Owner Skip applies only to failed
episodes. Stale attempts cannot publish because writes require a running attempt
whose generation still matches the episode's staged generation.

## Implementation and tests

- [Orchestration](../../apps/api/src/lib/ingestion.ts) and
  [Workflow launcher](../../apps/api/src/lib/workflows.ts) own starts/reconciliation.
- [IngestWorkflow](../../apps/api/src/workflows/ingest.ts) owns transcript
  classification and step policies.
- [Processing store](../../apps/api/src/do/registry/processing.ts),
  [attempt ledger](../../apps/api/src/do/registry/attempts.ts), and
  [episode store](../../apps/api/src/do/registry/episodes.ts) own durable transitions.
- [DownSub adapter](../../apps/api/src/lib/transcripts/downsub.ts),
  [VTT parser](../../apps/api/src/lib/transcripts/vtt.ts), and
  [chunker](../../apps/api/src/lib/chunk.ts) prepare content.

[Attempt tests](../../apps/api/test/registry-attempts.test.ts),
[recovery tests](../../apps/api/test/ingestion-recovery.test.ts), and
[Workflow tests](../../apps/api/test/workflow-ingest.test.ts) cover deadline
boundaries, blocked starts, stale writes, replacements, and failure paths. The
Workflow suite includes a real local Workflow binding test with external services
faked; it is not a live transcript-provider check.

## Limitations and PRD relationship

[PRD §4.2](../../docs/PRD.md) supplies the intent. This document follows
`settleUnfinished` for the deadline rule, not an assumed attempt-count cap or channel
pause rule. Recovery currently has no per-tick episode cap; staggering is the
implemented throttle. The transcript adapter does not generate missing captions.
A failed replacement does not erase a working summary.
