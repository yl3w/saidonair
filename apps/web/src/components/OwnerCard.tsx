import type { Catalog } from "@media-digest/shared";

/** One line, the facts that need the owner, one link (spec §6.2). Renders nothing when quiet. */
export function OwnerCard({ catalog }: { catalog: Catalog }) {
  const parts: string[] = [];
  const pending = catalog.requests.pending;
  if (pending > 0) {
    parts.push(
      `${pending} request${pending === 1 ? "" : "s"} waiting for review`,
    );
  }
  const failed = catalog.channels.failed;
  if (failed > 0) {
    parts.push(`${failed} channel${failed === 1 ? "" : "s"} failed`);
  }
  const stuck = catalog.channels.stuckPending;
  if (stuck > 0) {
    parts.push(`${stuck} channel${stuck === 1 ? "" : "s"} pending with no run`);
  }
  if (parts.length === 0) return null;
  return (
    <aside class="card" aria-label="Owner attention">
      <span>
        <strong>Owner</strong> · {parts.join(" · ")}
      </span>
      <a href="/owner#attention">Review →</a>
    </aside>
  );
}
