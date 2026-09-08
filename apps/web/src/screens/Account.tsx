import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { recentEmails, selectedEmail } from "../account";
import { useSession } from "../session";

/** "Who is this for?" — identity selection, never sign-in (AGENTS.md → Screens). */
export function Account() {
  const { select } = useSession();
  const { route } = useLocation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recent = recentEmails();

  useEffect(() => {
    if (selectedEmail() !== null) route("/home", true);
  }, [route]);

  function choose(raw: string) {
    if (select(raw) === null) {
      setError("That doesn't look like an email address.");
      return;
    }
    route("/home");
  }

  return (
    <main>
      <h1>Media Digest</h1>
      <h2>Who is this for?</h2>
      <form
        class="inline"
        onSubmit={(event) => {
          event.preventDefault();
          choose(value);
        }}
      >
        <label>
          Email{" "}
          <input
            type="email"
            value={value}
            onInput={(e) => setValue(e.currentTarget.value)}
            autoComplete="email"
          />
        </label>
        <button type="submit" disabled={value.trim().length === 0}>
          Continue
        </button>
      </form>
      {error && <p class="error">{error}</p>}
      {recent.length > 0 && (
        <>
          <p class="muted">Recently used</p>
          <div class="choices">
            {recent.map((email) => (
              <button type="button" key={email} onClick={() => choose(email)}>
                {email}
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
