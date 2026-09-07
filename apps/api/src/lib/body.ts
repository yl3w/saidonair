import type { Context } from "hono";
import { DomainError } from "./errors";

/**
 * Request-body and query helpers. Everything a client sends is `unknown` until narrowed here;
 * every failure is `INVALID_INPUT` (400) with a message naming the field.
 */
export async function readJsonObject(
  c: Context,
): Promise<Record<string, unknown>> {
  return parseJsonObject(await c.req.text());
}

/** For actions whose fields are all optional: no body at all reads as `{}`. */
export async function readOptionalJsonObject(
  c: Context,
): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  return text.trim().length === 0 ? {} : parseJsonObject(text);
}

function parseJsonObject(text: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new DomainError("INVALID_INPUT", "body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("INVALID_INPUT", "body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError("INVALID_INPUT", `${key} is required`);
  }
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function optionalPositiveInt(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new DomainError("INVALID_INPUT", `${key} must be a positive integer`);
  }
  return value;
}

/** `?limit=` as an integer, or undefined when absent; range checks belong to the callee. */
export function optionalIntQuery(
  raw: string | undefined,
  key: string,
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^-?\d+$/.test(raw)) {
    throw new DomainError("INVALID_INPUT", `${key} must be an integer`);
  }
  return Number.parseInt(raw, 10);
}

/** `?scope=` is either absent (the caller's own view) or exactly `all` (the owner's view). */
export function parseScope(raw: string | undefined): "default" | "all" {
  if (raw === undefined) return "default";
  if (raw === "all") return "all";
  throw new DomainError("INVALID_INPUT", "scope must be omitted or 'all'");
}
