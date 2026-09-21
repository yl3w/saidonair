import type { ErrorResponse } from "@media-digest/shared";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

/**
 * Authorization, after `requireIdentity` has established who is asking (docs/PRD.md §2, rewritten
 * 2026-09-20). It guards nine operations: the seven that change the catalog — approve, decline,
 * pause, resume, Start, episode retry, episode skip — and two reads.
 *
 * Until A8 the API enforced none of this and the web's rendering was the only gate (owner decision
 * 2026-09-12, reversed). Authentication alone did not close it: a stranger with a valid Google
 * account has a valid session, and could approve channels with it. Knowing who someone is and
 * deciding what they may do are different questions, and this answers the second.
 *
 * The two reads joined on 2026-09-21 (docs/specs/route-visibility.md §3). `GET /catalog` is an
 * operations dashboard — what needs the owner, and the transcript provider's billing state about
 * the owner's account. `GET /channels/{id}/followers` hands one reader another reader's address,
 * which PRD §8 named as its one deliberate exception to privacy; the exception was written when
 * identity was a self-asserted header, and a verified session is what withdrew it.
 *
 * The rest of reading is not merely untouched: five reads become public in the same spec, so this
 * file guards less of the catalog than it does more of it.
 */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.identity.role !== "owner") {
    return c.json<ErrorResponse>(
      {
        error: "only the owner may do this",
        code: "FORBIDDEN",
      },
      403,
    );
  }
  await next();
});
