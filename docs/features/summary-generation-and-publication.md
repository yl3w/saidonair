# Summary generation and publication

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and content hierarchy

The system creates one shared episode summary and one active vector generation.
Every follower reads that shared content. The hierarchy is:

```text
transcript segments → retrieval chunks → summarization sections
                    → section summaries → one episode summary
                    → inclusion in each eligible reader's digest
```

Chunks are embedded individually; they are not independently summarized. A digest
is a selection of already published episode summaries, not another AI synthesis.

## Generation flow

1. Record the staged chunk count before vector writes. Embed chunks in batches of
   20 with `@cf/baai/bge-base-en-v1.5` (768 dimensions).
2. Upsert vectors in `shared-catalog`, with IDs shaped as
   `episodeId:generationId:chunkIndex`. Metadata includes transcript text,
   episode/channel identifiers and titles, timestamps, and publication time.
3. Read every expected ID back until the generation is visible, using Workflow
   sleeps and bounded checks. Exhaustion produces `VECTORIZE_INCOMPLETE`; no
   partial generation is published as active.
4. Group chunks into approximately balanced sections using `SECTION_MAX_SEC =
   20 * 60`. Each section is summarized by the configured Llama 3.3 Workers AI model
   using JSON schema output and a 1,024-token output cap.
5. Parse each response. Invalid structured output receives one stricter prompt
   retry in addition to infrastructure-level step retries.
6. A single valid section is the episode summary. For multiple sections, code
   allocates takeaways across parsed sections; the model synthesizes executive
   prose and topic tags from that material.

The multi-section takeaway target is approximately one per eight runtime minutes,
rounded and clamped to 5–20. Allocation rotates across sections and spreads choices
within each, subject to available takeaways. Validation accepts 3–20 takeaways and
1–8 tags per parsed section. It does not enforce exactly three executive-summary
sentences. Missing, malformed, or out-of-duration timestamp markers become null.

## Fallbacks and publication

If no section parses, the first section's final raw response is published as
`raw_fallback`. If some sections parse, only those structured sections contribute.
If synthesis output remains invalid, their selected takeaways survive, with the
first parsed section's executive summary and tags as fallback. A model call that
throws after step retries is a processing failure, not that parse fallback.

A centroid query supplies related candidates. Publication validates candidates
against available catalog episodes and stores at most five. Related lookup failure
allows publication with none; personalized reads subsequently filter related
episodes by eligibility.

`completeAttempt` atomically writes the summary, marks the episode available,
activates its staged generation, closes the window, and completes the attempt.
`processed_at` is set only on first publication and exposed as
`summaryAvailableAt`. Replacing content does not move it to a new digest day or
clear read receipts. Until publication, previous available content remains active.

After publication, the Workflow deletes recorded superseded generations, including
ones earlier cleanup missed. Before new staging it can discard an abandoned
generation. Cleanup errors are logged and do not undo publication. All vector
operations explicitly name the shared namespace; ID-based deletion first confirms
namespace ownership by reading IDs back.

## Implementation and storage

- [Workflow](../../apps/api/src/workflows/ingest.ts): `embedAndStage`, `verify`,
  `summarize`, `relatedCandidates`, and `discard`.
- [Summary algorithms](../../apps/api/src/lib/summary.ts),
  [prompts](../../apps/api/src/prompts/summary.ts), and
  [AI wrapper](../../apps/api/src/lib/ai.ts): formatting, selection, validation,
  model names, and call limits.
- [Vector store](../../apps/api/src/lib/vectorize.ts): namespace and ID ownership.
- [Publication state machine](../../apps/api/src/do/registry/processing.ts) and
  [summary store](../../apps/api/src/do/registry/summaries.ts): transactional
  Registry content and related-ID validation.

Summaries, content metadata, and generation pointers live in the Registry;
retrieval chunk text is stored in Vectorize metadata. These are shared resources,
not User DO data.

## Tests, limitations, and PRD differences

[Workflow tests](../../apps/api/test/workflow-ingest.test.ts) cover parsing
fallbacks, verified publication, replacements, and cleanup.
[Summary tests](../../apps/api/test/summary.test.ts),
[vector tests](../../apps/api/test/vectorize.test.ts), and
[quality-evaluation tests](../../apps/api/test/summary-eval.test.ts) cover pure
rules and adapter behavior. Faked outputs do not establish live model quality.

[PRD §4.4, §6, and later summary decisions](../../docs/PRD.md) provide context.
Older 45-minute section comments and prose are superseded by the executable
20-minute constant. Partial parse failure can omit sections; an entirely raw
fallback is the first section's response, not a combined full-episode transcript.
The shared related-content query has no user filter; chat retrieval does, as
described in [Chat](chat-and-grounded-answers.md).
