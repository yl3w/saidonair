import { useLocation } from "preact-iso";
import { PUBLIC_INVITE_COPY, PUBLIC_JOIN_COPY } from "../lib/copy";

/**
 * What an account adds, on every page a signed-out visitor can reach (owner decision 2026-09-21,
 * replacing the fixed invitation band that preceded it).
 *
 * A daisyUI `alert` rather than a bar of our own: it is the component the library already has for
 * "a line of text and an action", it inherits the theme in all three palettes, and it sits in the
 * column with the content instead of taking a permanent strip off the top of the window.
 *
 * **No `role="alert"`.** daisyUI's examples carry it and it would be wrong here: that role is a
 * live region, announced over whatever a screen reader is currently reading, and this is a standing
 * invitation rather than something that just happened. The class does the styling; the semantics
 * are an ordinary piece of the page.
 *
 * The long form always (owner, 2026-09-21). The shortened phrasing existed because a fixed bar had
 * one line to spend on a phone; in the column the sentence wraps instead.
 */
export function JoinAlert() {
  const { path } = useLocation();
  return (
    <div class="alert alert-vertical mb-8 sm:alert-horizontal">
      <span class="font-reading text-body text-ink">{PUBLIC_INVITE_COPY}</span>
      <a
        class="btn btn-quiet"
        href={`/sign-in?next=${encodeURIComponent(path)}`}
      >
        {PUBLIC_JOIN_COPY}
      </a>
    </div>
  );
}
