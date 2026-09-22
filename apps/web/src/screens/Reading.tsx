import type { Episode } from "@media-digest/shared";
import { ArrowLeft, ExternalLink, MessageSquare } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { Choice } from "../components/Choice";
import { Icon } from "../components/Icon";
import { MetaLine } from "../components/MetaLine";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import { Sheet } from "../components/Sheet";
import { setAskScope } from "../lib/ask-scope";
import {
  ASK_COPY,
  ASK_HINT_COPY,
  actionErrorCopy,
  BACK_TO_CHANNELS_COPY,
  backToCopy,
  EXTERNAL_EPISODE_COPY,
  EXTERNAL_HINT_COPY,
  FONT_LABELS,
  momentCopy,
  READING_PANEL_CLOSE,
  READING_PANEL_TITLE,
  RELATED_HEADING,
  runtimeCopy,
  SIZE_LABELS,
  TAKEAWAYS_HEADING,
  THEME_LABELS,
  TOPICS_HEADING,
} from "../lib/copy";
import { readOrigin } from "../lib/reading-origin";
import {
  READING_FONTS,
  READING_SIZES,
  READING_THEMES,
  type ReaderSettings,
  readSettings,
  writeSettings,
} from "../lib/settings";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { useMediaQuery, WIDE } from "../lib/use-media-query";
import { useSession } from "../session";

export function Reading() {
  return <ReadingScreen />;
}

/**
 * One summary, in one column (docs/specs/design-phase.md §4.5). The reading column is the only part
 * of this product a person is glad to be in, so it carries no chrome it can live without: a way
 * back, the type controls, the video, and Done.
 *
 * **Nothing here writes anything until Done.** Opening this screen, arriving by deep link, and
 * reading to the end all record nothing; Done records the receipt and hands the reader back to the
 * list they came from, at the row they left.
 *
 * **Public since 2026-09-21** (docs/specs/public-reading.md §4.1), and it is the screen the whole
 * feature exists for: a shared summary is how this product travels. A visitor gets the summary
 * entire — the lede, every takeaway with its timestamp into YouTube, the topics — and the type and
 * theme controls, which live in their browser and need nobody.
 *
 * `Done`, `Ask` and Related need no new condition to disappear. Each already depends on something
 * the API omits for an anonymous caller: `read` is absent, so both controls fall away, and
 * `related` comes back empty because the API filters it to the caller's eligible channels. The
 * shape of the response does the work, which is worth knowing before someone "fixes" it by adding
 * a session check beside conditions that already say the same thing.
 */
function ReadingScreen() {
  const { params } = useRoute();
  const { route } = useLocation();
  const { state } = useSession();
  const signedIn = state.status === "ready";
  const episodeId = params.episodeId ?? "";
  const [settings, setSettings] = useState<ReaderSettings>(readSettings);
  const [panelOpen, setPanelOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useScrollProgress();
  const wide = useMediaQuery(WIDE);
  const panel = useRef<HTMLDivElement>(null);

  // A tap anywhere else, or Escape, closes the desktop popover: one that only closes by its own
  // button is a trap (docs/design.md §3). The phone's sheet is a native `<dialog>` and has both.
  useEffect(() => {
    if (!panelOpen || !wide) return;
    function onPointerDown(event: MouseEvent) {
      if (!panel.current?.contains(event.target as Node)) setPanelOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPanelOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen, wide]);

  // Read once, on the way in: a related title moves within this column without changing where the
  // reader came from, so the way back stays the list they actually opened a summary from.
  const origin = useMemo(readOrigin, []);

  const [load, reload] = useLoad(
    () => api.getEpisodeById(episodeId),
    [episodeId],
  );

  useDocumentTitle(load.status === "ready" ? load.data.episode.title : null);

  function change(patch: Partial<ReaderSettings>) {
    setSettings(writeSettings(patch));
  }

  /**
   * Type, size and theme, identical in both shapes. They apply as they are tapped rather than on a
   * footer button, because the page behind is the preview — which is also why the sheet's closing
   * button says where it goes rather than "Cancel", there being nothing to cancel.
   */
  const controls = (
    <div class="flex flex-col gap-3">
      <Choice
        legend="Type"
        value={settings.readingFont}
        options={READING_FONTS.map((font) => ({
          value: font,
          label: FONT_LABELS[font],
        }))}
        onChange={(readingFont) => change({ readingFont })}
      />
      <Choice
        legend="Size"
        value={settings.readingSize}
        options={READING_SIZES.map((size) => ({
          value: size,
          label: SIZE_LABELS[size],
        }))}
        onChange={(readingSize) => change({ readingSize })}
      />
      <Choice
        legend="Theme"
        value={settings.readingTheme}
        options={READING_THEMES.map((theme) => ({
          value: theme,
          label: THEME_LABELS[theme],
        }))}
        onChange={(readingTheme) => change({ readingTheme })}
      />
    </div>
  );

  /**
   * Done: the receipt, then back to the list, at the row (owner decision 2026-09-15, PRD §9,
   * withdrawing the advance to the next unread). One rule wherever a summary was opened from, and
   * the queue getting shorter is the progress an auto-advance never let anyone see.
   */
  async function done(episode: Episode) {
    setFinishing(true);
    setError(null);
    try {
      await api.markRead(episode.channelId, episode.episodeId);
      route(back.href);
    } catch (caught) {
      setError(actionErrorCopy(caught));
      setFinishing(false);
    }
  }

  const episode = load.status === "ready" ? load.data.episode : null;
  const summary = episode?.summary ?? null;

  // A visitor arriving on a shared link has no origin and no queue to be sent to, so their way out
  // is this episode's own channel — the most useful next page, and the one they can actually see
  // (docs/specs/public-reading-plan.md, plan decision 8). A visitor who *did* come from a list
  // keeps that list, exactly as a reader does.
  const fallback = signedIn
    ? { href: "/queue", label: backToCopy(null) }
    : episode === null
      ? { href: "/", label: BACK_TO_CHANNELS_COPY }
      : {
          href: `/sources/${episode.channelId}`,
          label: `Back to ${episode.channelTitle}`,
        };
  const back =
    origin === null
      ? fallback
      : { href: origin.href, label: backToCopy(origin) };

  return (
    <Page
      measure="reading"
      overlay={
        <>
          <div
            class="fixed inset-x-0 top-0 z-30 h-0.5 bg-primary"
            style={{ width: `${progress}%` }}
            role="presentation"
          />
          {/* On a phone the popover is a bottom sheet (docs/design.md §3): a 288 px box under the
              bar covers three quarters of the screen, and covers the article whose type it is
              changing. One shape is in the document at a time — `Choice` groups its radios by
              `name`, so two copies would be one group and the visible half would render with
              nothing selected. */}
          {!wide && (
            <Sheet
              open={panelOpen}
              title={READING_PANEL_TITLE}
              dismiss={READING_PANEL_CLOSE}
              onClose={() => setPanelOpen(false)}
            >
              {controls}
            </Sheet>
          )}
        </>
      }
      bar={
        <header class="sticky top-0 z-20 border-b border-rule bg-ground">
          <div class="bar-column flex h-14 items-center gap-2">
            <a href={back.href} class="btn btn-ghost btn-square -ml-3">
              <Icon of={ArrowLeft} size={20} label={back.label} />
            </a>

            <div class="relative ml-auto" ref={panel}>
              <button
                type="button"
                class="btn btn-ghost btn-secondary font-reading"
                aria-expanded={panelOpen}
                aria-haspopup="true"
                onClick={() => setPanelOpen(!panelOpen)}
              >
                Aa
              </button>
              {panelOpen && wide && (
                <div class="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-3 rounded border border-edge bg-panel p-3 shadow-lg">
                  {controls}
                </div>
              )}
            </div>

            {episode !== null && (
              <a
                class="flex min-h-11 items-center gap-1.5 px-2 text-ui link link-hover link-primary"
                href={`https://youtu.be/${episode.episodeId}`}
                title={EXTERNAL_HINT_COPY}
              >
                {EXTERNAL_EPISODE_COPY}
                <Icon of={ExternalLink} size={16} />
              </a>
            )}

            {/* The only way into a chat (docs/specs/chat-origin-scope.md §4.1). It renders where the
              episode can answer — a published summary, vectors to search, and a caller eligible to
              read it, which `read` reports by being present at all — and is absent otherwise rather
              than disabled. It writes nothing: the chat is minted by the first question, so an
              abandoned Ask leaves no empty chat behind. */}
            {episode !== null &&
              summary !== null &&
              (episode.processing?.vectorizedAt ?? null) !== null &&
              episode.read !== undefined && (
                <a
                  class="flex min-h-11 items-center gap-1.5 px-2 text-ui link link-hover link-primary"
                  href="/chats/new"
                  title={ASK_HINT_COPY}
                  onClick={() => setAskScope(episode.episodeId)}
                >
                  {ASK_COPY}
                  <Icon of={MessageSquare} size={16} />
                </a>
              )}

            {/* Only on a summary that still needs dealing with. A read one carries no receipt control
              at all: undo lives in History, where the row is and where it says "Read"
              (docs/design.md §4). */}
            {episode !== null && summary !== null && episode.read === false && (
              <button
                type="button"
                class="btn btn-quiet"
                disabled={finishing}
                onClick={() => done(episode)}
              >
                {finishing ? "…" : "Done"}
              </button>
            )}
          </div>
        </header>
      }
    >
      {load.status === "loading" && (
        <>
          <div class="skeleton h-4 w-40" />
          <div class="skeleton mt-4 h-10 w-full" />
          <div class="skeleton mt-6 h-32 w-full" />
        </>
      )}

      {load.status === "error" && (
        <p class="text-ui text-consequence">
          Couldn't load this summary: {actionErrorCopy(load.error)}.{" "}
          <Retry onClick={reload} />
        </p>
      )}

      {error !== null && <p class="mb-4 text-ui text-consequence">{error}</p>}

      {episode !== null && (
        <article class="font-reading">
          <p class="text-label uppercase text-ink-3">
            <a href={`/sources/${episode.channelId}`}>{episode.channelTitle}</a>
          </p>
          <h1 class="mt-2 font-reading text-reading-title-sm font-semibold text-ink md:text-reading-title">
            {episode.title}
          </h1>
          {/* The episode, not the reader's relationship to it: where someone stands with a
                summary is a triage fact and lives where they triage, on the History row that says
                "Read" and carries the Undo (owner decision 2026-09-15, docs/PRD.md §9). Assembled
                rather than written out, so the separator belongs to the line. */}
          <MetaLine
            class="mt-3"
            items={[
              longDate(episode.publishedAt),
              runtimeCopy(episode.processing?.durationSec ?? null),
            ].filter((item): item is string => item !== null)}
          />

          {summary === null ? (
            <p class="mt-6 border-t border-rule pt-6 text-body text-ink-2">
              This episode has no summary yet.
            </p>
          ) : summary.format === "raw_fallback" ? (
            <p class="mt-6 border-t border-rule pt-6 text-body whitespace-pre-wrap text-ink">
              {summary.rawText}
            </p>
          ) : (
            <>
              <p class="mt-6 border-t border-rule pt-6 text-lede text-ink-2">
                {summary.executiveSummary}
              </p>

              {/* Named, like Related below: the lede is the opening and needs no heading, but
                    three flowing sentences running into a timestamped list is a change of kind, and
                    "takeaways" is the word the queue row already used to promise them. */}
              {summary.takeaways.length > 0 && (
                <section class="mt-8 border-t border-rule pt-5">
                  <h2 class="text-label uppercase text-ink-3">
                    {TAKEAWAYS_HEADING}
                  </h2>
                  <ol class="mt-2">
                    {summary.takeaways.map((takeaway) => (
                      <li
                        key={takeaway.text}
                        class="mt-5 md:grid md:grid-cols-[4rem_1fr] md:gap-4"
                      >
                        <span class="block text-meta text-ink-3 md:pt-1 md:text-right">
                          {takeaway.startSec === null ? (
                            "—"
                          ) : (
                            <a
                              class="inline-flex min-h-11 items-center link link-hover link-primary md:justify-end"
                              href={`https://youtu.be/${episode.episodeId}?t=${Math.floor(takeaway.startSec)}`}
                            >
                              {momentCopy(takeaway.startSec)}
                            </a>
                          )}
                        </span>
                        <span class="block text-body text-ink">
                          {takeaway.text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {summary.topicTags.length > 0 && (
                <section class="mt-8 border-t border-rule pt-5">
                  <h2 class="text-label uppercase text-ink-3">
                    {TOPICS_HEADING}
                  </h2>
                  <p class="mt-2 text-meta text-ink-3">
                    {summary.topicTags.join(" · ")}
                  </p>
                </section>
              )}
            </>
          )}

          {episode.related.length > 0 && (
            <section class="mt-8 border-t border-rule pt-5">
              <h2 class="text-label uppercase text-ink-3">{RELATED_HEADING}</h2>
              <ul class="mt-2">
                {episode.related.map((related) => (
                  <li key={related.episodeId} class="mt-1">
                    <a
                      class="inline-flex min-h-11 items-center font-reading text-excerpt link link-hover link-primary"
                      href={`/read/${related.episodeId}`}
                    >
                      {related.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </Page>
  );
}

function longDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** The rule at the top, as a percentage of how far down the page the reader is. */
function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    function onScroll() {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      setProgress(
        scrollable <= 0
          ? 0
          : Math.min(100, (window.scrollY / scrollable) * 100),
      );
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return progress;
}
