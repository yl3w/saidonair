import type { ErrorResponse } from "@media-digest/shared";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import {
  DomainError,
  type DomainErrorCode,
  domainErrorCode,
} from "../lib/errors";

const STATUS_BY_CODE: Record<DomainErrorCode, ContentfulStatusCode> = {
  // The middleware answers this directly rather than throwing, but the map is exhaustive over the
  // shared union on purpose: a new code cannot be added without deciding what it means in HTTP.
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  UPSTREAM_UNAVAILABLE: 502,
};

/** The single place typed Registry errors become HTTP responses. */
export const onError: ErrorHandler<AppEnv> = (error, c) => {
  // Hono's JSON validator raises a 400 HTTPException for a body that is not JSON. Everything else
  // Hono raises this way is rare; it keeps its status and message, in this API's JSON shape.
  if (error instanceof HTTPException) {
    const failure =
      error.status === 400
        ? new DomainError("INVALID_INPUT", "body must be JSON")
        : error;
    const code = domainErrorCode(failure);
    return c.json<ErrorResponse>(
      code ? { error: failure.message, code } : { error: failure.message },
      error.status as ContentfulStatusCode,
    );
  }

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
