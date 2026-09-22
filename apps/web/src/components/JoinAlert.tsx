import { useLocation } from "preact-iso";
import { PUBLIC_INVITE_COPY, PUBLIC_JOIN_COPY } from "../lib/copy";
import { useSession } from "../session";

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
 *
 * **It decides for itself whether to render.** A caller that had to ask the session first would be
 * a caller that can forget to, and one did within minutes: `Page` renders this for every screen
 * that goes through it, and `Reading` builds its own frame and goes through nothing.
 */
export function JoinAlert() {
  const { path } = useLocation();
  const { state } = useSession();
  if (state.status !== "none") return null;
  // Side by side only from `md`. At `sm` the sentence and the button share 640 px and the result
  // is a cramped row; below that they stack, which reads better than either folding.
  return (
    <div class="alert alert-vertical mb-8 md:alert-horizontal">
      <span class="font-reading text-body text-ink">{PUBLIC_INVITE_COPY}</span>
      {/* `shrink-0` and `whitespace-nowrap` together: in the horizontal layout the sentence takes
          the free space and the button is what gives, which folded "Sign up / Sign in" onto two
          lines. The sentence may wrap — it is prose; the control may not. */}
      <a
        class="btn btn-quiet shrink-0 whitespace-nowrap"
        href={`/sign-in?next=${encodeURIComponent(path)}`}
      >
        {PUBLIC_JOIN_COPY}
      </a>
    </div>
  );
}
