import { render } from "preact";
import { useEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { Account } from "./screens/Account";
import { Channel } from "./screens/Channel";
import { Home } from "./screens/Home";
import { Owner } from "./screens/Owner";
import { OwnerChannel } from "./screens/OwnerChannel";
import { SessionProvider } from "./session";
import "./styles.css";

/** Unknown paths go Home; the session guard sends anyone without an account to `/`. */
function NotFound() {
  const { route } = useLocation();
  useEffect(() => route("/home", true), [route]);
  return null;
}

// History-mode routing (spec decision 8): Pages serves index.html for unknown paths, so deep links
// and reloads work; verified under `wrangler pages dev` in plan step 2.8.
export function App() {
  return (
    <LocationProvider>
      <SessionProvider>
        <Router>
          <Route path="/" component={Account} />
          <Route path="/home" component={Home} />
          <Route path="/channel/:id" component={Channel} />
          <Route path="/owner" component={Owner} />
          <Route path="/owner/channels/:id" component={OwnerChannel} />
          <Route default component={NotFound} />
        </Router>
      </SessionProvider>
    </LocationProvider>
  );
}

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing app root");
}

render(<App />, root);
