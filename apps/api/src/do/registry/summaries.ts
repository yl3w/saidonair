import { DomainError } from "../../lib/errors";
import { chunk, placeholders } from "../../lib/sql";
import type { EpisodeSummaryInput } from "./types";

/**
 * The shared summary an attempt publishes (docs/PRD.md §4.4, §5.3): one row per episode, replaced
 * whole by a replacement. The shape is validated here by hand, at the Registry boundary, because
 * `episodes.ts` treats a malformed column as corruption. Related ids are validated here too: only
 * other available episodes, in the order the attempt ranked them, at most five (PRD §5.1).
 */

export const MAX_RELATED = 5;

export function upsertSummary(
  sql: SqlStorage,
  videoId: string,
  input: EpisodeSummaryInput,
  relatedVideoIds: readonly string[],
  now: number,
): void {
  const summary = requireSummaryInput(input);
  const related = JSON.stringify(relatedVideoIds);
  if (summary.format === "structured") {
    sql.exec(
      `INSERT INTO episode_summaries
         (video_id, format, executive_summary, takeaways_json, topic_tags_json, raw_text,
          related_video_ids_json, model, prompt_version, created_at)
       VALUES (?, 'structured', ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT (video_id) DO UPDATE SET
         format = excluded.format, executive_summary = excluded.executive_summary,
         takeaways_json = excluded.takeaways_json, topic_tags_json = excluded.topic_tags_json,
         raw_text = NULL, related_video_ids_json = excluded.related_video_ids_json,
         model = excluded.model, prompt_version = excluded.prompt_version, created_at = excluded.created_at`,
      videoId,
      summary.executiveSummary,
      JSON.stringify(summary.takeaways),
      JSON.stringify(summary.topicTags),
      related,
      summary.model,
      summary.promptVersion,
      now,
    );
    return;
  }
  sql.exec(
    `INSERT INTO episode_summaries
       (video_id, format, executive_summary, takeaways_json, topic_tags_json, raw_text,
        related_video_ids_json, model, prompt_version, created_at)
     VALUES (?, 'raw_fallback', NULL, NULL, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT (video_id) DO UPDATE SET
       format = excluded.format, executive_summary = NULL, takeaways_json = NULL, topic_tags_json = NULL,
       raw_text = excluded.raw_text, related_video_ids_json = excluded.related_video_ids_json,
       model = excluded.model, prompt_version = excluded.prompt_version, created_at = excluded.created_at`,
    videoId,
    summary.rawText,
    related,
    summary.model,
    summary.promptVersion,
    now,
  );
}

/**
 * From the attempt's ranked candidates: other episodes only, each once, only those `available`
 * right now, in the given order, at most `MAX_RELATED`.
 */
export function relatedFromCandidates(
  sql: SqlStorage,
  videoId: string,
  candidates: readonly string[],
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>([videoId]);
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || seen.has(candidate)) continue;
    seen.add(candidate);
    ordered.push(candidate);
  }
  const available = new Set<string>();
  for (const batch of chunk(ordered)) {
    for (const row of sql.exec<{ video_id: string }>(
      `SELECT video_id FROM episodes WHERE status = 'available' AND video_id IN (${placeholders(batch.length)})`,
      ...batch,
    )) {
      available.add(row.video_id);
    }
  }
  return ordered.filter((id) => available.has(id)).slice(0, MAX_RELATED);
}

/** Shape validation, not schema validation: the caller already parsed the model's JSON (lib/summary.ts, M3.3). */
export function requireSummaryInput(input: unknown): EpisodeSummaryInput {
  const value = record(input);
  if (!value) throw invalid("summary must be an object");
  const model = nonEmpty(value.model, "summary.model");
  const promptVersion = nonEmpty(value.promptVersion, "summary.promptVersion");
  if (value.format === "raw_fallback") {
    return {
      format: "raw_fallback",
      rawText: nonEmpty(value.rawText, "summary.rawText"),
      model,
      promptVersion,
    };
  }
  if (value.format !== "structured") {
    throw invalid("summary.format must be structured or raw_fallback");
  }
  const takeaways = value.takeaways;
  if (!Array.isArray(takeaways) || !takeaways.every(isTakeaway)) {
    throw invalid("summary.takeaways must be an array of { text, startSec }");
  }
  const topicTags = value.topicTags;
  if (
    !Array.isArray(topicTags) ||
    !topicTags.every((tag) => typeof tag === "string" && tag.trim().length > 0)
  ) {
    throw invalid("summary.topicTags must be an array of non-empty strings");
  }
  return {
    format: "structured",
    executiveSummary: nonEmpty(
      value.executiveSummary,
      "summary.executiveSummary",
    ),
    takeaways: takeaways.map((t) => ({ text: t.text, startSec: t.startSec })),
    topicTags,
    model,
    promptVersion,
  };
}

function isTakeaway(
  item: unknown,
): item is { text: string; startSec: number | null } {
  const value = record(item);
  if (!value) return false;
  return (
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    (value.startSec === null ||
      (typeof value.startSec === "number" &&
        Number.isFinite(value.startSec) &&
        value.startSec >= 0))
  );
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`${name} is required`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function invalid(detail: string): DomainError {
  return new DomainError("INVALID_INPUT", detail);
}
