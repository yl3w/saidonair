import { render } from "preact";
import "./styles.css";

export function App() {
  return (
    <main>
      <h1>Media Digest</h1>
      <p>The workspace is ready for the first product slice.</p>
    </main>
  );
}

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing app root");
}

render(<App />, root);
