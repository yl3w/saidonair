import type { Episode } from "@media-digest/shared";
import { ArrowLeft, ExternalLink } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { Choice } from "../components/Choice";
import { Icon } from "../components/Icon";
import { Retry } from "../components/Retry";
import {
  actionErrorCopy,
  backToCopy,
  momentCopy,
  readStateCopy,
  runtimeCopy,
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
import { useLoad } from "../lib/use-load";
import { Guard } from "../session";

export function Reading() {
  return (
    <Guard>
      <ReadingScreen />
    </Guard>
  );
}

/**
 * One summary, in one column (docs/specs/design-phase.md §4.5). The reading column is the only part
 * of this product a person is glad to be in, so it carries no chrome it can live without: a way
 * back, the type controls, the video, and Done.
 *
 * **Nothing here writes anything until Done.** Opening this screen, arriving by deep link, and
 * reading to the end all record nothing; Done records the receipt and hands the reader back to the
 * list they came from, at the row they left.
 */
function ReadingScreen() {
  const { params } = useRoute();
  const { route } = useLocation();
  const episodeId = params.episodeId ?? "";
  const [settings, setSettings] = useState<ReaderSettings>(readSettings);
  const [panelOpen, setPanelOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useScrollProgress();

  // Read once, on the way in: a related title moves within this column without changing where the
  // reader came from, so the way back stays the list they actually opened a summary from.
  const origin = useMemo(readOrigin, []);
  const back = { href: origin?.href ?? "/queue", label: backToCopy(origin) };

  const [load, reload] = useLoad(
    () => api.getEpisodeById(episodeId),
    [episodeId],
  );

  function change(patch: Partial<ReaderSettings>) {
    setSettings(writeSettings(patch));
  }

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

  return (
    <div class="min-h-dvh bg-ground text-ink">
      <div
        class="fixed inset-x-0 top-0 z-30 h-0.5 bg-primary"
        style={{ width: `${progress}%` }}
        role="presentation"
      />

      <header class="sticky top-0 z-20 border-b border-rule bg-ground">
        <div class="mx-auto flex h-14 max-w-reading items-center gap-2 px-5 md:px-8">
          <a
            href={back.href}
            class="flex size-11 items-center justify-center text-ink-2"
          >
            <Icon of={ArrowLeft} size={20} label={back.label} />
          </a>

          <div class="relative ml-auto">
            <button
              type="button"
              class="min-h-11 px-3 font-reading text-ui text-ink-2"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              Aa
            </button>
            {panelOpen && (
              <div class="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-3 rounded border border-edge bg-panel p-3 shadow-lg">
                <Choice
                  legend="Type"
                  value={settings.readingFont}
                  options={READING_FONTS.map((font) => ({
                    value: font,
                    label: font === "serif" ? "Serif" : "Sans",
                  }))}
                  onChange={(readingFont) => change({ readingFont })}
                />
                <Choice
                  legend="Size"
                  value={settings.readingSize}
                  options={READING_SIZES.map((size) => ({
                    value: size,
                    label: size[0]?.toUpperCase() + size.slice(1),
                  }))}
                  onChange={(readingSize) => change({ readingSize })}
                />
                <Choice
                  legend="Theme"
                  value={settings.readingTheme}
                  options={READING_THEMES.map((theme) => ({
                    value: theme,
                    label: theme[0]?.toUpperCase() + theme.slice(1),
                  }))}
                  onChange={(readingTheme) => change({ readingTheme })}
                />
              </div>
            )}
          </div>

          {episode !== null && (
            <a
              class="flex min-h-11 items-center gap-1.5 px-2 text-ui text-primary"
              href={`https://youtu.be/${episode.episodeId}`}
            >
              Watch
              <Icon of={ExternalLink} size={16} />
            </a>
          )}

          {/* Only on a summary that still needs dealing with. A read one says so in the meta line
              instead, and its receipt is undone in History, where the row is (docs/design.md §4). */}
          {episode !== null && summary !== null && episode.read === false && (
            <button
              type="button"
              class="btn btn-sm min-h-11 border-edge bg-panel text-ui text-primary"
              disabled={finishing}
              onClick={() => done(episode)}
            >
              {finishing ? "…" : "Done"}
            </button>
          )}
        </div>
      </header>

      <main class="mx-auto max-w-reading px-5 pb-28 pt-8 md:px-8 md:pb-24">
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
              <a href={`/sources/${episode.channelId}`}>
                {episode.channelTitle}
              </a>
            </p>
            <h1 class="mt-2 font-reading text-reading-title-sm font-semibold text-ink md:text-reading-title">
              {episode.title}
            </h1>
            <p class="mt-3 flex flex-wrap gap-x-2 text-meta text-ink-3">
              {episode.read !== undefined && (
                <span>{readStateCopy(episode.read)} ·</span>
              )}
              <span>{longDate(episode.publishedAt)}</span>
              {runtimeCopy(episode.processing.durationSec) !== null && (
                <span>· {runtimeCopy(episode.processing.durationSec)}</span>
              )}
            </p>

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

                <ol class="mt-8">
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
                            class="inline-flex min-h-11 items-center text-primary md:justify-end"
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

                {summary.topicTags.length > 0 && (
                  <p class="mt-8 text-meta text-ink-3">
                    {summary.topicTags.join(" · ")}
                  </p>
                )}
              </>
            )}

            {episode.related.length > 0 && (
              <section class="mt-10 border-t border-rule pt-5">
                <h2 class="text-label uppercase text-ink-3">Related</h2>
                <ul class="mt-2">
                  {episode.related.map((related) => (
                    <li key={related.episodeId} class="mt-1">
                      <a
                        class="inline-flex min-h-11 items-center font-reading text-excerpt text-primary"
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
      </main>
    </div>
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
