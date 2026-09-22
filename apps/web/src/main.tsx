import { render } from "preact";
import { App } from "./app";
import { applyReaderSettings, readSettings } from "./lib/settings";
import "./styles.css";

// The theme is already on `<html>` from index.html's pre-paint script; this re-applies it from the
// same source so a stale or hand-edited attribute cannot outlive what is stored.
applyReaderSettings(readSettings());

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing app root");
}

render(<App />, root);
