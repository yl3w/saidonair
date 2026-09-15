import { Page } from "./Page";

/**
 * A screen the Design phase has designed but not yet built. It says which one and what will be
 * here, because a blank page with a working URL is indistinguishable from a broken one. Every use
 * of this is deleted by the step that builds the screen; `/chats` keeps it until M4
 * (docs/specs/design-phase.md §4.9).
 */
export function Unbuilt({ title, note }: { title: string; note: string }) {
  return (
    <Page>
      <h1 class="font-reading text-screen-title font-semibold text-ink">
        {title}
      </h1>
      <p class="mt-3 font-reading text-body text-ink-2">{note}</p>
    </Page>
  );
}
