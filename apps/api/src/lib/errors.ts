export type DomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_OWNER"
  | "NOT_FOUND"
  | "INVALID_STATE"
  /** YouTube (the only upstream) did not answer usably; distinct from bad input. Maps to 502. */
  | "UPSTREAM_UNAVAILABLE";

const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = [
  "INVALID_INPUT",
  "NOT_OWNER",
  "NOT_FOUND",
  "INVALID_STATE",
  "UPSTREAM_UNAVAILABLE",
];

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
