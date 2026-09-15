import { render } from "preact";
import { useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { applyReaderSettings, readSettings } from "./lib/settings";
import { Account } from "./screens/Account";
import { Curate } from "./screens/Curate";
import { CurateChannel } from "./screens/CurateChannel";
import { History } from "./screens/History";
import { Queue } from "./screens/Queue";
import { Reading } from "./screens/Reading";
import { Settings } from "./screens/Settings";
import { Source } from "./screens/Source";
import { Sources } from "./screens/Sources";
import { SessionProvider } from "./session";
import "./styles.css";

/** Unknown paths go to the queue; the session guard sends anyone without an account to `/`. */
function NotFound() {
  const { route } = useLocation();
  useEffect(() => route("/queue", true), [route]);
  return null;
}

/**
 * The reader's spine (docs/specs/design-phase.md §4.2): sign in, then the queue, one summary at a
 * time, history, sources, account — and Curate for the owner, one extra destination rather than a
 * mode. The paths M2 and M3 used are gone rather than redirected: `/home`, `/channel/:id`,
 * `/owner` and `/owner/channels/:id` named a shape the product no longer has.
 *
 * `/chats` is not a route until M4 builds the screen, so it falls to the redirect above like any
 * other unknown path and a stale bookmark lands on the queue (owner decision 2026-09-15, PRD §9).
 *
 * History-mode routing: Pages serves index.html for unknown paths, so deep links and reloads work.
 * Verify both under `wrangler pages dev` when a route is added.
 */
export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <Router>
          <Route path="/" component={Account} />
          <Route path="/queue" component={Queue} />
          <Route path="/read/:episodeId" component={Reading} />
          <Route path="/history" component={History} />
          <Route path="/history/:day" component={History} />
          <Route path="/sources" component={Sources} />
          <Route path="/sources/:id" component={Source} />
          <Route path="/account" component={Settings} />
          <Route path="/curate" component={Curate} />
          <Route path="/curate/:id" component={CurateChannel} />
          <Route default component={NotFound} />
        </Router>
      </SessionProvider>
    </LocationProvider>
  );
}

// The theme is already on `<html>` from index.html's pre-paint script; this re-applies it from the
// same source so a stale or hand-edited attribute cannot outlive what is stored.
applyReaderSettings(readSettings());

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing app root");
}

render(<App />, root);
