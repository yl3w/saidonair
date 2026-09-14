import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import type { EpisodeIngestionAttempt } from "@media-digest/shared";
import { getRegistry } from "../do/registry";
import type {
  AttemptContext,
  AttemptOutcome,
  EpisodeSummaryInput,
  PublicationResult,
  StagedGeneration,
} from "../do/registry/types";
import type { Env } from "../env";
import { ai, EMBEDDING_BATCH, SUMMARY_MODEL } from "../lib/ai";
import { chunkTranscript, type TranscriptChunk } from "../lib/chunk";
import { domainErrorCode } from "../lib/errors";
import {
  allocateTakeaways,
  formatSectionSummary,
  formatTranscript,
  parseSummary,
  parseSynthesis,
  type StructuredSummary,
  sectionize,
  takeawayCount,
} from "../lib/summary";
import { transcriptSource } from "../lib/transcripts";
import {
  type TranscriptFailure,
  type TranscriptResult,
  type TranscriptSegment,
  transcriptFailure,
} from "../lib/transcripts/types";
import {
  type ChunkMetadata,
  generationIds,
  SHARED_NAMESPACE,
  vectorId,
  vectorStore,
} from "../lib/vectorize";
import type { IngestParams } from "../lib/workflows";
import {
  mapPrompt,
  PROMPT_VERSION,
  STRICTER_RETRY_SUFFIX,
  synthesisPrompt,
} from "../prompts/summary";

/**
 * One Workflow instance per episode attempt (docs/PRD.md §4.2 rules 6–7, 24–26; docs/specs/m3-ingestion.md §3;
 * docs/specs/m3-5-episode-workflow.md §3.4). The class is a shell: `ingestAttempt` does the work over a
 * `StepLike`, so tests drive the same pipeline with an inline step runner. Every external call is its own
 * step with its own retries; step results stay small and serialisable. The instance never reads RSS, the
 * channel, or the run: it validates its own ledger row and writes through the attempt gate, so a stale
 * instance can never publish.
 */

/** The two step primitives the pipeline uses, so a test can run it without the engine. */
export type StepLike = {
  do<T>(
    name: string,
    config: WorkflowStepConfig,
    fn: () => Promise<T>,
  ): Promise<T>;
  sleep(name: string, seconds: number): Promise<void>;
};

export function adaptStep(step: WorkflowStep): StepLike {
  return {
    // The engine requires serialisable step results; every result the pipeline returns is a plain
    // object, so the bound is met at every call site and only the adapter needs the cast.
    do: <T>(name: string, config: WorkflowStepConfig, fn: () => Promise<T>) =>
      step.do(name, config, fn as () => Promise<never>) as Promise<T>,
    sleep: (name, seconds) =>
      step.sleep(name, `${seconds} second${seconds === 1 ? "" : "s"}`),
  };
}

export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: Readonly<WorkflowEvent<IngestParams>>, step: WorkflowStep) {
    return ingestAttempt(adaptStep(step), this.env, event.payload);
  }
}

// --- step policies (spec §2 "Step retries and timeouts") -----------------------------------------

export const TRANSCRIPT_STEP: WorkflowStepConfig = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "2 minutes",
};
export const AI_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
  timeout: "3 minutes",
};
export const UPSERT_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
  timeout: "1 minute",
};
/** One check per step, no retries of its own: the schedule below sleeps between checks. */
export const VERIFY_STEP: WorkflowStepConfig = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "1 minute",
};
/**
 * Seconds to wait between verify checks: every 10 s for three minutes, then backing off. M3.3's probe
 * measured 10–80 s before a Vectorize write is readable, so most episodes publish within two minutes of
 * their last upsert; the tail covers a slow index before `VECTORIZE_INCOMPLETE`.
 */
export const VERIFY_DELAYS_SEC: readonly number[] = [
  ...Array.from({ length: 17 }, () => 10),
  30,
  60,
  120,
  240,
  480,
  960,
];
export const REGISTRY_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
  timeout: "30 seconds",
};
export const RELATED_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
  timeout: "1 minute",
};
export const CLEANUP_STEP: WorkflowStepConfig = {
  retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
  timeout: "1 minute",
};

/** The transcript step's result must stay under the engine's 1 MiB cap; PRD §4.2 leaves headroom. */
export const TRANSCRIPT_RESULT_LIMIT_BYTES = 700_000;
/** Under this many known seconds a video is a short (docs/PRD.md §4.2 rule 12). */
export const SHORT_UNDER_SEC = 180;
/** Related candidates asked of the index before deduping to at most five videos (spec §2). */
export const RELATED_TOP_K = 50;

// --- classification (parent §3.5), pure ---------------------------------------------------------

export type Classification =
  | {
      kind: "process";
      segments: TranscriptSegment[];
      durationSec: number | null;
    }
  | { kind: "finish"; outcome: AttemptOutcome };

export type TranscriptStepResult =
  | { result: TranscriptResult }
  | { failure: TranscriptFailure }
  | { tooLarge: true; durationSec: number | null };

/**
 * What one transcript answer means for the attempt: a deterministic skip, a wait, a technical
 * failure, or work. Duration is the first check, and an unknown duration never means short.
 */
export function classify(input: TranscriptStepResult): Classification {
  if ("tooLarge" in input) {
    return {
      kind: "finish",
      outcome: { status: "failed", code: "TRANSCRIPT_TOO_LARGE" },
    };
  }
  if ("failure" in input)
    return { kind: "finish", outcome: outcomeForFailure(input.failure) };
  const { result } = input;
  if (result.durationSec !== null && result.durationSec < SHORT_UNDER_SEC) {
    return { kind: "finish", outcome: { status: "skipped", code: "SHORT" } };
  }
  if (result.captionStatus === "non_english") {
    return {
      kind: "finish",
      outcome: { status: "skipped", code: "NON_ENGLISH" },
    };
  }
  if (
    result.captionStatus === "none" ||
    !result.segments ||
    result.segments.length === 0
  ) {
    return { kind: "finish", outcome: { status: "waiting", code: "CAPTIONS" } };
  }
  return {
    kind: "process",
    segments: result.segments,
    durationSec: result.durationSec,
  };
}

/** Provider failures by reason: exhausted credits are a wait, an unplayable video a skip, the rest failures. */
export function outcomeForFailure(failure: TranscriptFailure): AttemptOutcome {
  switch (failure) {
    case "UNPLAYABLE":
      return { status: "skipped", code: "UNPLAYABLE" };
    case "PROVIDER_LIMIT":
      return { status: "waiting", code: "PROVIDER_LIMIT" };
    default:
      return { status: "failed", code: failure };
  }
}

/** Failures the provider will answer the same way again, so the step must not spend retries on them. */
const DETERMINISTIC_FAILURES: ReadonlySet<TranscriptFailure> = new Set([
  "UNPLAYABLE",
  "PROVIDER_AUTH",
  "PROVIDER_LIMIT",
]);

// --- the pipeline --------------------------------------------------------------------------------

export type IngestResult =
  | { attemptId: string; ended: "stale" }
  | { attemptId: string; ended: "finished"; outcome: AttemptOutcome }
  | {
      attemptId: string;
      ended: "published";
      chunkCount: number;
      replaced: boolean;
    };

/** Which stage an error escaped from, so an unclassified error still gets the right code. */
type Stage = "transcript" | "embed" | "verify" | "summarize" | "publish";

export async function ingestAttempt(
  step: StepLike,
  env: Env,
  params: IngestParams,
): Promise<IngestResult> {
  const { attemptId, videoId } = params;
  const registry = getRegistry(env);

  if (params.startDelaySec > 0)
    await step.sleep("stagger", params.startDelaySec);

  const context = await step.do("load", REGISTRY_STEP, () =>
    registry.describeAttempt(attemptId),
  );
  if (!context.current || context.generationId === null) {
    console.log({ event: "ingest.stale", attemptId, videoId });
    return { attemptId, ended: "stale" };
  }
  const generationId = context.generationId;

  let stage: Stage = "transcript";
  try {
    const transcript = await step.do("transcript", TRANSCRIPT_STEP, () =>
      fetchTranscript(env, videoId),
    );
    const classification = classify(transcript);
    if (classification.kind === "finish") {
      return await finish(step, registry, attemptId, classification.outcome);
    }
    const chunks = chunkTranscript(classification.segments);
    if (chunks.length === 0) {
      return await finish(step, registry, attemptId, {
        status: "waiting",
        code: "CAPTIONS",
      });
    }
    const durationSec =
      classification.durationSec ??
      Math.ceil(chunks[chunks.length - 1]?.endSec ?? 0);

    if (context.abandonedGeneration) {
      await discard(step, env, "discard", videoId, context.abandonedGeneration);
    }

    await step.do("stage", REGISTRY_STEP, () =>
      registry.markStaged(attemptId, chunks.length, durationSec),
    );

    stage = "embed";
    const centroid = await embedAndStage(
      step,
      env,
      context,
      generationId,
      chunks,
    );

    stage = "verify";
    await verify(step, env, videoId, generationId, chunks.length);

    stage = "summarize";
    const summary = await summarize(step, env, chunks, durationSec);

    const related = await relatedCandidates(step, env, videoId, centroid);

    stage = "publish";
    const published: PublicationResult = await step.do(
      "publish",
      REGISTRY_STEP,
      () =>
        registry.completeAttempt(attemptId, chunks.length, summary, related),
    );
    console.log({
      event: "ingest.published",
      attemptId,
      videoId,
      chunkCount: chunks.length,
      replaced: published.previousGeneration !== null,
    });
    if (published.previousGeneration) {
      await discard(
        step,
        env,
        "cleanup",
        videoId,
        published.previousGeneration,
      );
    }
    return {
      attemptId,
      ended: "published",
      chunkCount: chunks.length,
      replaced: published.previousGeneration !== null,
    };
  } catch (error) {
    // A refused Registry write means another actor finished or superseded this attempt: stop quietly.
    if (domainErrorCode(error) === "INVALID_STATE") {
      console.log({
        event: "ingest.stale",
        attemptId,
        videoId,
        stage,
        detail: messageOf(error),
      });
      return { attemptId, ended: "stale" };
    }
    if (stage === "publish") throw error;
    const outcome = outcomeForError(error, stage);
    console.log({
      event: "ingest.step_failed",
      attemptId,
      videoId,
      stage,
      code: outcome.code,
    });
    return await finish(step, registry, attemptId, outcome);
  }
}

async function finish(
  step: StepLike,
  registry: ReturnType<typeof getRegistry>,
  attemptId: string,
  outcome: AttemptOutcome,
): Promise<IngestResult> {
  try {
    await step.do("finish", REGISTRY_STEP, () =>
      registry.finishAttempt(attemptId, outcome),
    );
  } catch (error) {
    if (domainErrorCode(error) !== "INVALID_STATE") throw error;
    return { attemptId, ended: "stale" };
  }
  return { attemptId, ended: "finished", outcome };
}

/**
 * The transcript step's body: deterministic provider answers come back as values so the step spends
 * no retries on them; transient ones throw so the step retries with backoff. Oversized transcripts
 * never cross the step boundary.
 */
async function fetchTranscript(
  env: Env,
  videoId: string,
): Promise<TranscriptStepResult> {
  try {
    const result = await transcriptSource(env).fetch(videoId);
    if (
      result.segments &&
      JSON.stringify(result.segments).length > TRANSCRIPT_RESULT_LIMIT_BYTES
    ) {
      return { tooLarge: true, durationSec: result.durationSec };
    }
    return { result };
  } catch (error) {
    const failure = transcriptFailure(error);
    if (failure && DETERMINISTIC_FAILURES.has(failure)) return { failure };
    throw error;
  }
}

/**
 * One step per batch of chunks: embed, then upsert the batch's vectors under the staged generation.
 * Only the batch's vector sum crosses the boundary, so the related step can average a centroid.
 */
async function embedAndStage(
  step: StepLike,
  env: Env,
  context: AttemptContext,
  generationId: string,
  chunks: readonly TranscriptChunk[],
): Promise<number[]> {
  const sum: number[] = [];
  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH);
    const index = start / EMBEDDING_BATCH;
    const { partial } = await step.do(
      `stage:${index}`,
      UPSERT_STEP,
      async () => {
        let vectors: number[][];
        try {
          vectors = await ai(env).embed(batch.map((chunk) => chunk.text));
        } catch (error) {
          throw prefixed("EMBEDDING_FAILED", error);
        }
        try {
          await vectorStore(env).upsert(
            SHARED_NAMESPACE,
            batch.map((chunk, i) => ({
              id: vectorId(context.episode.videoId, generationId, chunk.index),
              values: vectors[i] ?? [],
              metadata: metadataFor(context, generationId, chunk),
            })),
          );
        } catch (error) {
          throw prefixed("VECTORIZE_INCOMPLETE", error);
        }
        const partial = new Array<number>(vectors[0]?.length ?? 0).fill(0);
        for (const vector of vectors) {
          for (let d = 0; d < partial.length; d++)
            partial[d] = (partial[d] ?? 0) + (vector[d] ?? 0);
        }
        return { partial };
      },
    );
    for (let d = 0; d < partial.length; d++)
      sum[d] = (sum[d] ?? 0) + (partial[d] ?? 0);
  }
  return sum.map((v) => v / chunks.length);
}

function metadataFor(
  context: AttemptContext,
  generationId: string,
  chunk: TranscriptChunk,
): ChunkMetadata {
  return {
    videoId: context.episode.videoId,
    channelId: context.episode.channelId,
    generationId,
    channelTitle: context.episode.channelTitle,
    title: context.episode.title,
    startSec: chunk.startSec,
    endSec: chunk.endSec,
    text: chunk.text,
    publishedAt: context.episode.publishedAt,
  };
}

/**
 * Reads the whole generation back until every id is present, on the schedule above; only the count
 * of missing ids crosses each boundary. Still missing after the last check is `VECTORIZE_INCOMPLETE`.
 */
async function verify(
  step: StepLike,
  env: Env,
  videoId: string,
  generationId: string,
  chunkCount: number,
): Promise<void> {
  const ids = generationIds(videoId, generationId, chunkCount);
  for (let check = 0; ; check++) {
    const { missing } = await step.do(
      `verify:${check}`,
      VERIFY_STEP,
      async () => {
        const present = new Set(
          await vectorStore(env).getByIds(SHARED_NAMESPACE, ids),
        );
        return { missing: ids.filter((id) => !present.has(id)).length };
      },
    );
    if (missing === 0) return;
    const delay = VERIFY_DELAYS_SEC[check];
    if (delay === undefined) {
      throw new Error(
        `VECTORIZE_INCOMPLETE: ${missing} of ${ids.length} vectors never became readable`,
      );
    }
    await step.sleep(`verify-wait:${check}`, delay);
  }
}

/**
 * Map over sections of at most 45 minutes, reduce when there is more than one; each call its own
 * step. Invalid JSON is retried once with the stricter suffix, then the raw text is published as a
 * fallback (docs/PRD.md §4.4).
 */
async function summarize(
  step: StepLike,
  env: Env,
  chunks: readonly TranscriptChunk[],
  durationSec: number,
): Promise<EpisodeSummaryInput> {
  const client = ai(env);
  const sections = sectionize(chunks);
  const answers: { structured: StructuredSummary | null; raw: string }[] = [];
  for (const [i, section] of sections.entries()) {
    answers.push(
      await answer(
        step,
        `summarize:${i}`,
        (p) => client.summarizeSection(p),
        mapPrompt(formatTranscript(section)),
        durationSec,
      ),
    );
  }
  const structured = answers
    .map((a) => a.structured)
    .filter((a): a is StructuredSummary => a !== null);

  // Nothing parsed: there is no structured summary to publish, so the reader gets the raw text.
  if (structured.length === 0) {
    const first = answers[0];
    if (!first) throw new Error("SUMMARY_FAILED: no section to summarise");
    return {
      format: "raw_fallback",
      rawText: first.raw,
      model: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION,
    };
  }

  const single = sections.length === 1 ? structured[0] : undefined;
  if (single) {
    return {
      format: "structured",
      executiveSummary: single.executiveSummary,
      takeaways: single.takeaways,
      topicTags: single.topicTags,
      model: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION,
    };
  }

  // The takeaways are ours, not the model's: it fills from the earliest sections and stops
  // (docs/specs/summary-coverage.md §2). The synthesis call writes the prose over what we chose.
  const takeaways = allocateTakeaways(structured, takeawayCount(durationSec));
  const synthesis = await synthesise(
    step,
    (p) => client.synthesise(p),
    synthesisPrompt(structured.map(formatSectionSummary), takeaways),
  );
  // A failed synthesis costs the three sentences, never the takeaways: they never depended on it.
  const fallback = structured[0];
  return {
    format: "structured",
    executiveSummary:
      synthesis?.executiveSummary ?? fallback?.executiveSummary ?? "",
    takeaways,
    topicTags: synthesis?.topicTags ?? fallback?.topicTags ?? [],
    model: SUMMARY_MODEL,
    promptVersion: PROMPT_VERSION,
  };
}

/** One model call as a step, and one stricter retry as a second step when the JSON does not parse. */
async function answer(
  step: StepLike,
  name: string,
  call: (prompt: string) => Promise<string>,
  prompt: string,
  durationSec: number,
): Promise<{ structured: StructuredSummary | null; raw: string }> {
  const first = await step.do(name, AI_STEP, () => call(prompt));
  const structured = parseSummary(first, durationSec);
  if (structured) return { structured, raw: first };
  const second = await step.do(`${name}:retry`, AI_STEP, () =>
    call(prompt + STRICTER_RETRY_SUFFIX),
  );
  return { structured: parseSummary(second, durationSec), raw: second };
}

/**
 * The synthesis call and its one stricter retry. Null when neither answer parses, which costs the
 * episode its three sentences and nothing else: the takeaways were chosen before this ran.
 */
async function synthesise(
  step: StepLike,
  call: (prompt: string) => Promise<string>,
  prompt: string,
): Promise<{ executiveSummary: string; topicTags: string[] } | null> {
  const first = await step.do("synthesise", AI_STEP, () => call(prompt));
  const parsed = parseSynthesis(first);
  if (parsed) return parsed;
  const second = await step.do("synthesise:retry", AI_STEP, () =>
    call(prompt + STRICTER_RETRY_SUFFIX),
  );
  return parseSynthesis(second);
}

/** Related candidates by centroid; a failure here publishes with none (docs/PRD.md §4.4). */
async function relatedCandidates(
  step: StepLike,
  env: Env,
  videoId: string,
  centroid: readonly number[],
): Promise<string[]> {
  try {
    const { candidates } = await step.do("related", RELATED_STEP, async () => {
      const matches = await vectorStore(env).query(SHARED_NAMESPACE, centroid, {
        topK: RELATED_TOP_K,
      });
      const seen = new Set<string>([videoId]);
      const candidates: string[] = [];
      for (const match of matches) {
        const id = match.metadata.videoId;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push(id);
      }
      return { candidates };
    });
    return candidates;
  } catch (error) {
    console.log({
      event: "ingest.related_failed",
      videoId,
      detail: messageOf(error),
    });
    return [];
  }
}

/** Deletes a whole generation by count; a failure is logged and never changes the attempt's outcome. */
async function discard(
  step: StepLike,
  env: Env,
  name: "discard" | "cleanup",
  videoId: string,
  generation: StagedGeneration,
): Promise<void> {
  try {
    await step.do(name, CLEANUP_STEP, async () => {
      await vectorStore(env).deleteByIds(
        SHARED_NAMESPACE,
        generationIds(videoId, generation.generationId, generation.chunkCount),
      );
      return { deleted: generation.chunkCount };
    });
  } catch (error) {
    console.log({
      event: `ingest.${name}_failed`,
      videoId,
      generationId: generation.generationId,
      detail: messageOf(error),
    });
  }
}

/** The failure code for an error that escaped a stage, by its prefix when it carries one. */
function outcomeForError(error: unknown, stage: Stage): AttemptOutcome {
  const message = messageOf(error);
  const transcript = transcriptFailure(error);
  if (transcript) return outcomeForFailure(transcript);
  for (const code of [
    "EMBEDDING_FAILED",
    "VECTORIZE_INCOMPLETE",
    "SUMMARY_FAILED",
  ] as const) {
    if (message.startsWith(code))
      return { status: "failed", code, detail: detailOf(message) };
  }
  switch (stage) {
    case "transcript":
      return { status: "failed", code: "PROVIDER_HTTP", detail: message };
    case "embed":
      return { status: "failed", code: "EMBEDDING_FAILED", detail: message };
    case "verify":
      return {
        status: "failed",
        code: "VECTORIZE_INCOMPLETE",
        detail: message,
      };
    default:
      return { status: "failed", code: "SUMMARY_FAILED", detail: message };
  }
}

function prefixed(code: string, error: unknown): Error {
  const message = messageOf(error);
  return new Error(message.startsWith(code) ? message : `${code}: ${message}`);
}

function detailOf(message: string): string | undefined {
  const colon = message.indexOf(":");
  return colon === -1
    ? undefined
    : message.slice(colon + 1).trim() || undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { EpisodeIngestionAttempt };
