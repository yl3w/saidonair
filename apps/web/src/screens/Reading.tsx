import type { Episode } from "@media-digest/shared";
import { ArrowLeft, ExternalLink } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api } from "../api";
import { Choice } from "../components/Choice";
import { Icon } from "../components/Icon";
import { Retry } from "../components/Retry";
import {
  actionErrorCopy,
  momentCopy,
  readingMinutes,
  runtimeCopy,
} from "../lib/copy";
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
 * reading to the end all record nothing; Done records the receipt and moves to the next unread.
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

  const [load, reload] = useLoad(
    () => api.getEpisodeById(episodeId),
    [episodeId],
  );

  function change(patch: Partial<ReaderSettings>) {
    setSettings(writeSettings(patch));
  }

  /** Done: the receipt, then whatever is next. An empty queue lands back on it, not nowhere. */
  async function done(episode: Episode) {
    setFinishing(true);
    setError(null);
    try {
      await api.markRead(episode.channelId, episode.episodeId);
      const next = await api.getDigest({ unread: true, limit: 1 });
      const following = next.episodes[0];
      route(following ? `/read/${following.episodeId}` : "/queue");
    } catch (caught) {
      setError(actionErrorCopy(caught));
      setFinishing(false);
    }
  }

  const episode = load.status === "ready" ? load.data.episode : null;
  const summary = episode?.summary ?? null;

  return (
    <div
      data-reading-theme={settings.readingTheme}
      class="min-h-dvh bg-reading-ground text-reading-ink"
    >
      <div
        class="fixed inset-x-0 top-0 z-30 h-0.5 bg-reading-accent"
        style={{ width: `${progress}%` }}
        role="presentation"
      />

      <header class="sticky top-0 z-20 border-b border-reading-rule bg-reading-ground">
        <div class="mx-auto flex h-14 max-w-reading items-center gap-2 px-5 md:px-8">
          <a
            href="/queue"
            class="flex size-11 items-center justify-center text-reading-ink-2"
          >
            <Icon of={ArrowLeft} size={20} label="Back to the queue" />
          </a>

          <div class="relative ml-auto">
            <button
              type="button"
              class="min-h-11 px-3 font-serif text-ui text-reading-ink-2"
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
              class="flex min-h-11 items-center gap-1.5 px-2 text-ui text-reading-accent"
              href={`https://youtu.be/${episode.episodeId}`}
            >
              Watch
              <Icon of={ExternalLink} size={16} />
            </a>
          )}

          {episode !== null &&
            summary !== null &&
            episode.read !== undefined && (
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
          <article
            class={
              settings.readingFont === "serif" ? "font-serif" : "font-sans"
            }
          >
            <p class="text-label uppercase text-reading-ink-3">
              <a href={`/sources/${episode.channelId}`}>
                {episode.channelTitle}
              </a>
            </p>
            <h1 class="mt-2 font-serif text-reading-title-sm font-semibold text-reading-ink md:text-reading-title">
              {episode.title}
            </h1>
            <p class="mt-3 flex flex-wrap gap-x-2 text-meta text-reading-ink-3">
              <span>{longDate(episode.publishedAt)}</span>
              {runtimeCopy(episode.processing.durationSec) !== null && (
                <span>· {runtimeCopy(episode.processing.durationSec)}</span>
              )}
              <span>· {readingMinutes(summary)} min read</span>
            </p>

            {summary === null ? (
              <p
                class={`mt-6 border-t border-reading-rule pt-6 ${bodySize(settings)} text-reading-ink-2`}
              >
                This episode has no summary yet.
              </p>
            ) : summary.format === "raw_fallback" ? (
              <p
                class={`mt-6 whitespace-pre-wrap border-t border-reading-rule pt-6 ${bodySize(settings)} text-reading-ink`}
              >
                {summary.rawText}
              </p>
            ) : (
              <>
                <p
                  class={`mt-6 border-t border-reading-rule pt-6 ${ledeSize(settings)} text-reading-ink-2`}
                >
                  {summary.executiveSummary}
                </p>

                <ol class="mt-8">
                  {summary.takeaways.map((takeaway) => (
                    <li
                      key={takeaway.text}
                      class="mt-5 md:grid md:grid-cols-[4rem_1fr] md:gap-4"
                    >
                      <span class="block text-meta text-reading-ink-3 md:pt-1 md:text-right">
                        {takeaway.startSec === null ? (
                          "—"
                        ) : (
                          <a
                            class="inline-flex min-h-11 items-center text-reading-accent md:justify-end"
                            href={`https://youtu.be/${episode.episodeId}?t=${Math.floor(takeaway.startSec)}`}
                          >
                            {momentCopy(takeaway.startSec)}
                          </a>
                        )}
                      </span>
                      <span
                        class={`block ${bodySize(settings)} text-reading-ink`}
                      >
                        {takeaway.text}
                      </span>
                    </li>
                  ))}
                </ol>

                {summary.topicTags.length > 0 && (
                  <p class="mt-8 text-meta text-reading-ink-3">
                    {summary.topicTags.join(" · ")}
                  </p>
                )}
              </>
            )}

            {episode.related.length > 0 && (
              <section class="mt-10 border-t border-reading-rule pt-5">
                <h2 class="text-label uppercase text-reading-ink-3">Related</h2>
                <ul class="mt-2">
                  {episode.related.map((related) => (
                    <li key={related.episodeId} class="mt-1">
                      <a
                        class="inline-flex min-h-11 items-center font-serif text-excerpt text-reading-accent"
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

function ledeSize(settings: ReaderSettings): string {
  if (settings.readingSize === "small") return "text-body";
  if (settings.readingSize === "large") return "text-reading-title-sm";
  return "text-lede";
}

function bodySize(settings: ReaderSettings): string {
  if (settings.readingSize === "small") return "text-excerpt";
  if (settings.readingSize === "large") return "text-lede";
  return "text-body";
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
