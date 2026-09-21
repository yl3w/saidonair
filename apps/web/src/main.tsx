import { render } from "preact";
import { useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { useTrackNavigation } from "./lib/back";
import { applyReaderSettings, readSettings } from "./lib/settings";
import { AuthCallback } from "./screens/AuthCallback";
import { Chat } from "./screens/Chat";
import { Chats } from "./screens/Chats";
import { Curate } from "./screens/Curate";
import { CurateChannel } from "./screens/CurateChannel";
import { History } from "./screens/History";
import { Queue } from "./screens/Queue";
import { Reading } from "./screens/Reading";
import { Settings } from "./screens/Settings";
import { SignIn } from "./screens/SignIn";
import { Source } from "./screens/Source";
import { Sources } from "./screens/Sources";
import { SessionProvider } from "./session";
import "./styles.css";

/** Renders nothing: it exists so a screen with its own bar knows whether back stays in the app. */
function TrackNavigation() {
  useTrackNavigation();
  return null;
}

/** Unknown paths go to the queue; the session guard sends anyone without an account to `/`. */
function NotFound() {
  const { route } = useLocation();
  useEffect(() => route("/queue", true), [route]);
  return null;
}

/**
 * The reader's spine (docs/specs/design-phase.md §4.2): sign in — really sign in, since
 * 2026-09-20 — then the queue, one summary at a
 * time, history, sources, account — and Curate for the owner, one extra destination rather than a
 * mode. The paths M2 and M3 used are gone rather than redirected: `/home`, `/channel/:id`,
 * `/owner` and `/owner/channels/:id` named a shape the product no longer has.
 *
 * `/chats` became a route when M4 built the screen; the comment here said otherwise until
 * 2026-09-20, three lines above the route itself.
 *
 * History-mode routing: Pages serves index.html for unknown paths, so deep links and reloads work.
 * Verify both under `wrangler pages dev` when a route is added.
 */
export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <TrackNavigation />
        <Router>
          {/* `/sign-in` is the door since 2026-09-21 (docs/specs/public-reading.md §4.3). `/` still
              renders it TEMPORARILY, until step 4 of `public-reading-plan.md` puts the landing page
              there; that route goes with the same commit. */}
          <Route path="/" component={SignIn} />
          <Route path="/sign-in" component={SignIn} />
          {/* Where the sign-in handoff lands with its one-time code. It must be a real route: the
              fallback below replaces the URL, which would discard the fragment and lose the code
              (A5, docs/specs/auth-phase-plan.md). */}
          <Route path="/auth/callback" component={AuthCallback} />
          <Route path="/queue" component={Queue} />
          <Route path="/read/:episodeId" component={Reading} />
          <Route path="/history" component={History} />
          <Route path="/history/:day" component={History} />
          {/* `/chats/new` is declared before the parameterised route, or preact-iso matches "new"
              as a chat id. It is the composer before a chat exists: Ask lands here with its scope in
              `?about=`, and the first question mints the id (docs/specs/m4-3-chat-web.md §2). */}
          <Route path="/chats" component={Chats} />
          <Route path="/chats/new" component={Chat} />
          <Route path="/chats/:chatId" component={Chat} />
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
