import type { ChatMessage } from "../do/user/types";
import type { ChunkMetadata } from "../lib/vectorize";

/**
 * The chat answering prompt (docs/PRD.md §4.5; docs/specs/m4-2-chat-answering.md §3.4). Prose, not
 * JSON: there is nothing to parse, and the citations are attached by code from the chunks that fed
 * the answer. **This prompt never mentions a citation and never asks for a marker** — asking a model
 * that returned 0% named subjects with the names in its prompt to number its sources would produce
 * markers that do not resolve (docs/specs/summary-quality.md §4.3). `CHAT_PROMPT_VERSION` is stored
 * with every reply and names this text, so editing it bumps the version to the date of the edit.
 */
export const CHAT_PROMPT_VERSION = "2026-09-16";

export type PromptChunk = Pick<
  ChunkMetadata,
  "title" | "channelTitle" | "startSec" | "text"
>;

export function chatPrompt(input: {
  systemRules: string;
  history: readonly ChatMessage[];
  chunks: readonly PromptChunk[];
  question: string;
}): string {
  const parts: string[] = [
    "You are answering a question using only the transcript excerpts below, which come from podcast episodes the reader follows.",
    "",
    "STRICT REQUIREMENTS:",
    "- Answer only from the excerpts. If they do not cover the question, say so plainly.",
    "- Never invent a speaker, a number, or a claim that is not in an excerpt.",
    "- Write prose in short paragraphs. No headings, no bullet points, no markdown.",
  ];

  const rules = input.systemRules.trim();
  if (rules.length > 0) {
    parts.push("", "THE READER'S OWN RULES FOR ANSWERS:", rules);
  }

  if (input.history.length > 0) {
    parts.push("", "EARLIER IN THIS CONVERSATION:");
    for (const message of input.history) {
      const speaker = message.role === "user" ? "Reader" : "You";
      parts.push(`${speaker}: ${message.content}`);
    }
  }

  parts.push("", "EXCERPTS:");
  for (const chunk of input.chunks) {
    parts.push(
      `From "${chunk.title}" (${chunk.channelTitle}) at ${clock(chunk.startSec)}:`,
      chunk.text,
      "",
    );
  }

  parts.push("QUESTION:", input.question);
  return parts.join("\n");
}

/** `m:ss` or `h:mm:ss`, the shape the reader already sees on a summary's takeaways. */
function clock(startSec: number): string {
  const whole = Math.max(0, Math.floor(startSec));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}
