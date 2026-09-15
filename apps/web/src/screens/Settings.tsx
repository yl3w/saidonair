import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import { attentionCount } from "../components/CatalogHealth";
import { Choice } from "../components/Choice";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import { actionErrorCopy, curateWaitingCopy } from "../lib/copy";
import {
  READING_FONTS,
  READING_SIZES,
  READING_THEMES,
  type ReaderSettings,
  readSettings,
  writeSettings,
} from "../lib/settings";
import { useLoad } from "../lib/use-load";
import { Guard, useReadySession, useSession } from "../session";

/**
 * Account (`docs/specs/design-phase.md` §4.7): which email is reading and the only Switch account in
 * the product, how this browser sets the reading column, the rules that reach chat answers, and the
 * counts toggle. Everything here is either a fact about this browser or a fact about this reader —
 * nothing on this screen changes anything anyone else sees.
 */
export function Settings() {
  return (
    <Guard>
      <SettingsScreen />
    </Guard>
  );
}

const SIZE_LABELS: Record<ReaderSettings["readingSize"], string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

function SettingsScreen() {
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
      <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
        Account
      </h1>

      <Section title="Reading as">
        <div class="flex flex-wrap items-center gap-3">
          <Avatar id={email} name={email.split("@")[0] ?? email} size={34} />
          <span class="text-ui text-ink">{email}</span>
          {isOwner && (
            <span class="badge badge-sm border-owner bg-transparent text-meta text-owner">
              Owner
            </span>
          )}
          <button
            type="button"
            class="btn btn-sm ml-auto min-h-11 border-edge bg-panel text-ui text-primary"
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
              label: font === "serif" ? "Serif" : "Sans",
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
              label: theme[0]?.toUpperCase() + theme.slice(1),
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
        note="Applied to chat answers alone, never to a summary — those are shared, and yours to read, not to shape."
      >
        <ChatRules />
      </Section>

      <Section title="Counts">
        <label class="flex min-h-11 items-center gap-3 text-ui text-ink">
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

/** `system_rules`, the one thing on this screen the API keeps. Saved on submit, never as you type. */
function ChatRules() {
  const [preferences, reload] = useLoad(() => api.getPreferences(), []);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (preferences.status === "loading") {
    return <div class="skeleton h-24 w-full" />;
  }
  if (preferences.status === "error") {
    return (
      <p class="text-ui text-consequence">
        Couldn't load your rules: {actionErrorCopy(preferences.error)}.{" "}
        <Retry onClick={reload} />
      </p>
    );
  }

  const saved = preferences.data.preferences.systemRules;
  const value = draft ?? saved;
  const dirty = value.trim() !== saved;

  async function save(event: Event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.putPreferences({ systemRules: value.trim() });
      setDraft(null);
      reload();
    } catch (caught) {
      setError(actionErrorCopy(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <textarea
        class="textarea min-h-24 w-full border-edge bg-panel text-ui text-ink"
        value={value}
        rows={4}
        placeholder="Answer in British English. Never speculate beyond the transcript."
        aria-label="Rules for chat answers"
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <div class="mt-2 flex items-center gap-3">
        <button
          type="submit"
          class="btn btn-sm min-h-11 border-edge bg-panel text-ui text-primary"
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save rules"}
        </button>
        <span class="text-meta text-ink-3">
          {dirty ? "Not saved yet." : "Saved."}
        </span>
      </div>
      {error !== null && <p class="mt-2 text-meta text-consequence">{error}</p>}
    </form>
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
