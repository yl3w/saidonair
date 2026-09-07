import type { ErrorResponse } from "@media-digest/shared";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { type DomainErrorCode, domainErrorCode } from "../lib/errors";

const STATUS_BY_CODE: Record<DomainErrorCode, ContentfulStatusCode> = {
  INVALID_INPUT: 400,
  NOT_OWNER: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  UPSTREAM_UNAVAILABLE: 502,
};

/** The single place typed Registry errors become HTTP responses. */
export const onError: ErrorHandler<AppEnv> = (error, c) => {
  const code = domainErrorCode(error);
  if (code) {
    return c.json<ErrorResponse>(
      { error: error.message, code },
      STATUS_BY_CODE[code],
    );
  }
  console.error({
    event: "request.unhandled_error",
    path: c.req.path,
    message: error.message,
  });
  return c.json<ErrorResponse>({ error: "internal error" }, 500);
};
