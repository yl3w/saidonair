import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import { attentionCount } from "../components/CatalogHealth";
import { Choice } from "../components/Choice";
import { Page } from "../components/Page";
import {
  curateWaitingCopy,
  FONT_LABELS,
  SIZE_LABELS,
  THEME_LABELS,
} from "../lib/copy";
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
import { Guard, useReadySession, useSession } from "../session";

/**
 * Account (`docs/specs/design-phase.md` §4.7): which email is reading and the only Switch account in
 * the product, how this browser sets the reading column, and the counts toggle. Everything here is
 * either a fact about this browser or a fact about this reader — nothing on this screen changes
 * anything anyone else sees.
 *
 * **The chat rules field returned on 2026-09-16**, with the screen that gives it something to
 * shape. It was held out from 2026-09-15 because a control that accepts input and reports it saved,
 * while shaping answers from a feature that cannot answer anything, is worse than a missing one
 * (owner decision, `docs/PRD.md` §9). `GET`/`PUT /preferences` stayed registered throughout, so a
 * rule saved before the field was withdrawn comes back with it.
 */
export function Settings() {
  useDocumentTitle("Account");
  return (
    <Guard>
      <SettingsScreen />
    </Guard>
  );
}

function SettingsScreen() {
  const [rules, setRules] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  useLoad(async () => {
    const { preferences } = await api.getPreferences();
    setRules(preferences.systemRules);
    return preferences;
  }, []);

  /** Empty clears them, which is why a blank value is saved rather than skipped (PRD §7). */
  async function saveRules() {
    if (savingRules) return;
    setSavingRules(true);
    try {
      await api.putPreferences({ systemRules: rules });
    } finally {
      setSavingRules(false);
    }
  }

  const { email, role } = useReadySession();
  const { signOut } = useSession();
  const { route } = useLocation();
  const [settings, setSettings] = useState<ReaderSettings>(readSettings);
  const isOwner = role === "owner";
  const [catalog] = useLoad(() => api.getCatalog(), [], { enabled: isOwner });
  const waiting =
    catalog.status === "ready" ? attentionCount(catalog.data.catalog) : null;

  function change(patch: Partial<ReaderSettings>) {
    setSettings(writeSettings(patch));
  }

  return (
    <Page measure="reading">
      {/* No visible heading, as Queue, Sources and Chats have none: the frame names this screen —
          the reader's own email and monogram sit in the bar and mark it current (owner decision
          2026-09-17, amending docs/design.md §2.2, which had listed Account among the screens the
          frame does not name). It stays in the document for anyone navigating by headings. */}
      <h1 class="sr-only">Account</h1>

      <Section title="Reading as">
        <div class="flex flex-wrap items-center gap-3">
          <Avatar id={email} name={email.split("@")[0] ?? email} size={34} />
          <span class="text-ui text-ink">{email}</span>
          {isOwner && (
            <span class="badge badge-outline badge-warning badge-sm">
              Owner
            </span>
          )}
          <button
            type="button"
            class="btn btn-quiet ml-auto"
            onClick={() => {
              signOut();
              route("/");
            }}
          >
            Switch account
          </button>
        </div>
      </Section>

      <Section
        title="Reading"
        note="Applies to every page, and kept in this browser \u2014 another machine of yours can read differently."
      >
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
        <p class="mt-4 font-reading text-body text-ink-2">
          He spent the first twenty minutes on why the old measurement was
          wrong, and the rest on what replaces it.
        </p>
      </Section>

      <Section
        title="Chat rules"
        note="Applied to chat answers alone, never to a summary — those are shared, and one reader's preferences cannot shape what everyone else reads."
      >
        <textarea
          class="textarea w-full font-reading [--font-size:var(--text-excerpt)]"
          rows={4}
          maxLength={4000}
          placeholder="Answer briefly. Prefer the guest's own words."
          value={rules}
          disabled={savingRules}
          onInput={(event) => setRules(event.currentTarget.value)}
          onBlur={() => void saveRules()}
        />
        <p class="mt-2 text-meta text-ink-3">
          {savingRules
            ? "Saving…"
            : "Saved when you click away. Empty clears them."}
        </p>
      </Section>

      <Section title="Counts">
        <label class="flex min-h-11 cursor-pointer items-center gap-3 text-ui text-ink">
          <input
            type="checkbox"
            class="toggle toggle-sm"
            checked={settings.showCounts}
            onChange={(event) =>
              change({ showCounts: event.currentTarget.checked })
            }
          />
          {settings.showCounts
            ? "Counts are shown."
            : "Counts are hidden everywhere."}
        </label>
      </Section>

      {isOwner && (
        <Section title="Curate" class="lg:hidden">
          <p class="font-reading text-body text-ink-2">
            {curateWaitingCopy(waiting)}
          </p>
        </Section>
      )}
    </Page>
  );
}

function Section({
  title,
  note,
  class: className = "",
  children,
}: {
  title: string;
  note?: string;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <section class={`mt-8 border-t border-rule pt-5 ${className}`}>
      <h2 class="text-label uppercase text-ink-3">{title}</h2>
      {note !== undefined && (
        <p class="mt-1 font-reading text-excerpt text-ink-2">{note}</p>
      )}
      <div class="mt-3">{children}</div>
    </section>
  );
}
