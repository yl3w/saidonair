import type { Env, ValidationTargets } from "hono";
import { validator } from "hono-openapi";
import type { z } from "zod";
import type { AppEnv } from "../env";
import { DomainError } from "./errors";

/**
 * Request validation and its OpenAPI description from one schema. `validate(target, schema)` is
 * hono-openapi's `validator` with this project's failure contract: the first issue becomes an
 * `INVALID_INPUT` DomainError naming the field, which `middleware/errors.ts` turns into the 400 body
 * every client already understands. Handlers read the narrowed value with `c.req.valid(target)`.
 */
export function validate<
  Target extends keyof ValidationTargets,
  Schema extends z.ZodType,
  E extends Env = AppEnv,
  P extends string = string,
>(target: Target, schema: Schema) {
  return validator<Schema, Target, E, P>(target, schema, invalidInput);
}

/** Structural view of a Standard Schema issue, so no direct dependency on the spec package. */
type Issue = {
  readonly message: string;
  readonly path?:
    | ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
    | undefined;
};

function invalidInput(result: {
  success: boolean;
  error?: readonly Issue[];
}): void {
  if (result.success) return;
  const issue = result.error?.[0];
  throw new DomainError(
    "INVALID_INPUT",
    issue ? describeIssue(issue) : "invalid input",
  );
}

function describeIssue(issue: Issue): string {
  const path = (issue.path ?? [])
    .map((segment) =>
      typeof segment === "object" ? String(segment.key) : String(segment),
    )
    .join(".");
  return path.length > 0 ? `${path} ${issue.message}` : issue.message;
}
