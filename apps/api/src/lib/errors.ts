import { type ErrorCode, ErrorCodeSchema } from "@media-digest/shared";

/**
 * The codes a `DomainError` may carry are exactly the wire enum (`ErrorCode` in packages/shared), so
 * the document and the thrown errors cannot drift: add a code to the schema and it exists here.
 */
export type DomainErrorCode = ErrorCode;

const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = ErrorCodeSchema.options;

/**
 * Thrown by Durable Object methods. Custom properties are not guaranteed to survive the
 * DO RPC boundary, so the code is also the message prefix; callers use `domainErrorCode`.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DomainError";
    this.code = code;
  }
}

/** Recovers the code from a DomainError, including one that crossed an RPC boundary. */
export function domainErrorCode(error: unknown): DomainErrorCode | null {
  if (error instanceof DomainError) return error.code;
  if (!(error instanceof Error)) return null;
  const prefix = error.message.split(":", 1)[0]?.trim();
  return DOMAIN_ERROR_CODES.find((code) => code === prefix) ?? null;
}
