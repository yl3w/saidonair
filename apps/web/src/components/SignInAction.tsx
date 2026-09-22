import { useLocation } from "preact-iso";
import { PUBLIC_SIGN_IN_COPY } from "../lib/copy";
import { useSession } from "../session";

/**
 * The way in, in the frame's top-right corner (owner decision 2026-09-21).
 *
 * That corner is the "who you are" slot: a reader's email and monogram sit there, and for a
 * visitor it holds the way to become one. Leaving it empty while the same job was done by a button
 * inside a promotional box put the control where a returning reader does not look — they look
 * top-right, without reading anything, which is the whole argument for this.
 *
 * It splits the two audiences by where each one looks: the bar is for somebody who already knows
 * what this is, and `JoinAlert` is for somebody who needs telling. So the alert keeps **Sign up**
 * and this is **Sign in**, and both land on `/sign-in`, because a first sign-in is what creates
 * the account.
 *
 * **It decides for itself whether to render**, like `JoinAlert`, because it belongs to three bars
 * — the public shell's, the channel's and the summary's — and a control each of them has to
 * remember to add is a control one of them will not have (four such bugs on 2026-09-21 alone).
 */
export function SignInAction() {
  const { path } = useLocation();
  const { state } = useSession();
  if (state.status !== "none") return null;
  return (
    <a
      class="btn btn-quiet btn-sm ml-auto shrink-0"
      href={`/sign-in?next=${encodeURIComponent(path)}`}
    >
      {PUBLIC_SIGN_IN_COPY}
    </a>
  );
}
