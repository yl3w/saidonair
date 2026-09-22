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
import { Landing } from "./screens/Landing";
import { Queue } from "./screens/Queue";
import { Reading } from "./screens/Reading";
import { Settings } from "./screens/Settings";
import { SignIn } from "./screens/SignIn";
import { Source } from "./screens/Source";
import { Sources } from "./screens/Sources";
import { SessionProvider } from "./session";

/** Renders nothing: it exists so a screen with its own bar knows whether back stays in the app. */
function TrackNavigation() {
  useTrackNavigation();
  return null;
}

/** Unknown paths go to the queue; the session guard sends anyone without a session to `/sign-in`. */
function NotFound() {
  const { route } = useLocation();
  useEffect(() => route("/queue", true), [route]);
  return null;
}

/**
 * The application tree, with no side effects on import. It lives apart from `main.tsx` because the
 * Worker renders this same tree on the server (src/server/worker.tsx), and `main.tsx` calls
 * `render()` as soon as it is loaded — importing that on the server would try to mount the app
 * into a document that does not exist.
 *
 * The reader's spine (docs/specs/design-phase.md §4.2): sign in — really sign in, since
 * 2026-09-20 — then the queue, one summary at a
 * time, history, sources, account — and Curate for the owner, one extra destination rather than a
 * mode. Since 2026-09-21 four of these are reachable without a session, and the screens themselves
 * decide what a visitor is shown (docs/specs/public-reading.md). The paths M2 and M3 used are gone rather than redirected: `/home`, `/channel/:id`,
 * `/owner` and `/owner/channels/:id` named a shape the product no longer has.
 *
 * `/chats` became a route when M4 built the screen; the comment here said otherwise until
 * 2026-09-20, three lines above the route itself.
 *
 * History-mode routing: the Worker's assets binding answers an unknown path with index.html
 * (`not_found_handling: "single-page-application"`), so deep links and reloads work. Verify both
 * under `wrangler dev` when a route is added.
 */
export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <TrackNavigation />
        <Router>
          {/* `/` is the landing page a stranger browses, and `/sign-in` is the door
              (docs/specs/public-reading.md §4.1, §4.3). Until 2026-09-21 `/` was the door itself. */}
          <Route path="/" component={Landing} />
          <Route path="/sign-in" component={SignIn} />
          {/* Where the sign-in handoff lands with its one-time code. It must be a real route: the
              fallback below replaces the URL, which would discard the fragment and lose the code
              (A5, docs/specs/auth-phase-plan.md). */}
          <Route path="/auth/callback" component={AuthCallback} />
          <Route path="/queue" component={Queue} />
          <Route path="/queue/:day" component={Queue} />
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
