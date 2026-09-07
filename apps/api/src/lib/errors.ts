export type RegistryErrorCode =
  | "INVALID_INPUT"
  | "NOT_OWNER"
  | "NOT_FOUND"
  | "INVALID_STATE";

const REGISTRY_ERROR_CODES: readonly RegistryErrorCode[] = [
  "INVALID_INPUT",
  "NOT_OWNER",
  "NOT_FOUND",
  "INVALID_STATE",
];

/**
 * Thrown by Registry DO methods. Custom properties are not guaranteed to survive the
 * DO RPC boundary, so the code is also the message prefix; callers use `registryErrorCode`.
 */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;

  constructor(code: RegistryErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "RegistryError";
    this.code = code;
  }
}

/** Recovers the code from a RegistryError, including one that crossed an RPC boundary. */
export function registryErrorCode(error: unknown): RegistryErrorCode | null {
  if (error instanceof RegistryError) return error.code;
  if (!(error instanceof Error)) return null;
  const prefix = error.message.split(":", 1)[0]?.trim();
  return REGISTRY_ERROR_CODES.find((code) => code === prefix) ?? null;
}
