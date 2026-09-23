# Reader preferences

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and ownership

Appearance is a browser preference. Chat instructions are a user preference.
These have different persistence and effects: choosing a font does not call the
API, while changing chat rules affects future model answers for that user.

## Appearance settings

The Account screen at `/account` requires a session and offers the following:

| Setting | Values | Default |
|---|---|---|
| Font | `serif`, `sans` | `serif` |
| Size | `small`, `medium`, `large` | `medium` |
| Theme | `light`, `sepia`, `dark` | `light` |
| Counts | shown/hidden | shown |

The summary reader's `Aa` control also exposes font, size, and theme, including
for signed-out visitors. Selections apply immediately; closing the panel is not
an explicit save or cancel. Font/size/theme are applied to data attributes on
`<html>`, so stylesheet tokens affect the whole application and native dialogs.

Settings are stored under `localStorage["media-digest:settings"]`, independent of
the session token. They are shared by accounts using that browser, not synced to
another device through the API. Invalid or blocked storage falls back to defaults
when read. A failed write still applies the returned selection to the current
page; persistence across reload is not guaranteed. There is no cross-tab reactive
preference subscription in the settings module.

`showCounts` is consumed by screens such as Queue and History. It is a rendering
choice, not a way to suppress API counts or stop every count query. Some count
labels, including Sources section counts and chat-row message counts, are rendered
without consulting it.

## Chat instructions

Account loads `GET /preferences` into a text area capped at 4,000 characters.
Leaving the field triggers `PUT /preferences` with `systemRules`; there is no
separate Save button. The field is disabled and shows saving text while the write
is pending. Whitespace is trimmed at request validation, and an empty value clears
the instructions. An absent stored row returns empty rules with `updatedAt: null`.

The User DO stores one `user_preferences` row with ID `default`, rules, and update
time. The chat answering path reads those rules for the next model prompt. They
do not rewrite existing replies, bypass retrieval eligibility, or change shared
episode summaries. Fixed no-follow/no-evidence answers do not need a personalized
model prompt.

Account also displays the current identity and Switch account. That session
operation belongs to [Identity and access](identity-and-access.md), not to
preference persistence. The owner sees a smaller-screen Curate notice backed by
the owner-only catalog read.

## Implementation map

- [Settings screen](../../../apps/web/src/screens/Settings.tsx) owns account controls,
  preference loading, and blur-triggered chat-rule saves.
- [Browser settings](../../../apps/web/src/lib/settings.ts) owns defaults, storage,
  and root attributes; [styles](../../../apps/web/src/styles.css) consumes them.
- [Reading screen](../../../apps/web/src/screens/Reading.tsx) reuses local settings.
- [Preference routes](../../../apps/api/src/routes/preferences.ts) and
  [shared schemas](../../../packages/shared/src/index.ts) validate the HTTP contract.
- [User preferences store](../../../apps/api/src/do/user/preferences.ts) persists
  rules; [chat prompt](../../../apps/api/src/prompts/chat.ts) incorporates them.

## Tests and limitations

[Preference route tests](../../../apps/api/test/routes-preferences.test.ts) cover
empty defaults, save/clear, validation, and per-user isolation.
[Storage tests](../../../apps/api/test/user-preferences.test.ts) cover persistence.
The inspected web test suite does not exercise the Account form's blur/save
interaction or local appearance selection in a DOM.

The Settings component discards the load status returned by its preference loader,
and its save handler has `finally` but no displayed save-error state. Consequently
the document does not promise verified save confirmation or a dedicated retry
control for chat rules. The helper text describes saving on blur; it is not an
acknowledgment of every successful write.

Appearance defaults and supported values above come from source. There is no
inferred OS-theme selection or account synchronization.
