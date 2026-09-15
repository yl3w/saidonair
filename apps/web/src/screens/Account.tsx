import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { recentEmails } from "../account";
import { useSession } from "../session";

/**
 * "Who is this for?" — identity selection, never sign-in (docs/PRD.md §7). There is no password
 * because there is nothing to authenticate: the email names the reader whose follows and receipts
 * this tab acts on, and the API takes it at its word. The settings screen at `/account` is the only
 * other place an account is chosen.
 */
export function Account() {
  const { state, select } = useSession();
  const { route } = useLocation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recent = recentEmails();

  // This tab already acts for someone: the session says so, not storage, which another tab may
  // have changed since this one loaded.
  const selected = state.status !== "none";
  useEffect(() => {
    if (selected) route("/queue", true);
  }, [selected, route]);

  function choose(raw: string) {
    if (select(raw) === null) {
      setError("That doesn't look like an email address.");
      return;
    }
    route("/queue");
  }

  return (
    <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <h1 class="font-serif text-screen-title font-semibold tracking-tight text-ink">
        Said on Air
      </h1>
      <p class="mt-1 font-serif text-body text-ink-2">
        What was said on the air, in text, with the minute it was said.
      </p>

      <form
        class="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          choose(value);
        }}
      >
        <label class="block text-label uppercase text-ink-3" for="reader-email">
          Who is this for?
        </label>
        <div class="mt-2 flex gap-2">
          <input
            id="reader-email"
            type="email"
            class="input min-h-11 flex-1 border-edge bg-panel text-ui text-ink"
            value={value}
            placeholder="you@example.com"
            autoComplete="email"
            onInput={(event) => {
              setValue(event.currentTarget.value);
              setError(null);
            }}
          />
          <button
            type="submit"
            class="btn min-h-11 border-edge bg-panel text-ui text-primary"
            disabled={value.trim().length === 0}
          >
            Continue
          </button>
        </div>
        {error !== null && (
          <p class="mt-2 text-meta text-consequence">{error}</p>
        )}
      </form>

      {recent.length > 0 && (
        <section class="mt-8">
          <h2 class="text-label uppercase text-ink-3">Recently used</h2>
          <ul class="mt-2 divide-y divide-rule border-y border-rule">
            {recent.map((email) => (
              <li key={email}>
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center text-left text-ui text-primary"
                  onClick={() => choose(email)}
                >
                  {email}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
