import type { Catalog } from "@media-digest/shared";
import { attentionCount } from "./CatalogHealth";

/**
 * One line, the facts that need the owner, one link (spec §6.2). Renders nothing when quiet.
 */
export function OwnerCard({ catalog }: { catalog: Catalog }) {
  if (attentionCount(catalog) === 0) return null;
  const { requested, failedEpisodes, neverStarted } = catalog.attention;
  const facts = [
    requested > 0 &&
      `${requested} channel${requested === 1 ? "" : "s"} waiting for review`,
    failedEpisodes > 0 &&
      `${failedEpisodes} episode${failedEpisodes === 1 ? "" : "s"} failed`,
    neverStarted > 0 &&
      `${neverStarted} channel${neverStarted === 1 ? "" : "s"} approved but never started`,
  ].filter((fact): fact is string => typeof fact === "string");
  return (
    <p class="note">
      {facts.join(" · ")} <a href="/owner#attention">Review</a>
    </p>
  );
}
