import { hydrate, render } from "preact";
import { App } from "./app";
import { Bootstrap, type BootstrapData } from "./lib/bootstrap";
import { applyReaderSettings, readSettings } from "./lib/settings";
import "./styles.css";

// The theme is already on `<html>` from index.html's pre-paint script; this re-applies it from the
// same source so a stale or hand-edited attribute cannot outlive what is stored.
applyReaderSettings(readSettings());

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing app root");
}

/**
 * What the Worker rendered this page from, if it rendered it at all
 * (src/server/worker.tsx). Hydrating over server markup keeps the first paint the reader already
 * has; rendering from scratch is for a guarded screen, a page the Worker served as the bare shell
 * because the API was down, and for `wrangler dev`'s client-only mode.
 */
const boot = (window as { __BOOT__?: BootstrapData }).__BOOT__;
const tree = (
  <Bootstrap value={boot ?? null}>
    <App />
  </Bootstrap>
);

if (boot !== undefined && root.firstChild !== null) hydrate(tree, root);
else render(tree, root);
