// What names a screen when the screen does not name itself.
//
// `index.html` sets `<title>` once, to the product, and no route has ever changed it — so every tab,
// every bookmark and every entry in the browser's own history menu reads "Said on Air" and says
// nothing about which screen it is. That was survivable while each screen printed its name in a
// 27 px heading. It stopped being survivable when Queue, Sources and Curate gave that heading up to
// the nav, which already names them (docs/design.md §3): a name has to live somewhere, and for those
// three the tab is now the only place outside assistive technology.
//
// So every route names itself here, including the ones that kept a visible heading — a history menu
// is a list of screens and cannot have three of them called the same thing.

import { useEffect } from "preact/hooks";

const PRODUCT = "Said on Air";

/**
 * Name this screen in the tab: `Queue · Said on Air`, in the separator a meta line uses.
 *
 * `null` means the name is not known yet — an episode's title, a channel's, both a fetch away — and
 * leaves the product's own name standing. Never the screen before's: a tab that still says the last
 * channel's name while this one loads is worse than one that says nothing, because it is wrong
 * rather than incomplete.
 */
export function useDocumentTitle(name: string | null): void {
  useEffect(() => {
    document.title =
      name === null || name.trim() === "" ? PRODUCT : `${name} · ${PRODUCT}`;
  }, [name]);
}
