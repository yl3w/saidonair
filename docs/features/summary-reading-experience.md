# Summary reading experience

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and entry points

`/read/:episodeId` presents one shared episode summary. It opens from Queue,
History, a channel, a related-summary link, or a cold external link. The screen is
public; a signed-in eligible reader receives additional receipt and chat controls.

Opening a summary, scrolling, or reaching its end does not record reading activity
in the API. Read state changes only through an explicit receipt write.

## Current presentation and actions

The screen loads `GET /episodes/:episodeId`, using anonymous server bootstrap when
available. It shows the channel link, title, publication date, and runtime when
present in the response's processing data. A structured summary renders an
executive-summary opening, takeaways, topic tags, and any eligible related titles.
Takeaway timestamps link to `https://youtu.be/:episodeId?t=:seconds`, with seconds
rounded down; missing timestamps show a dash. A raw fallback renders preserved
plain text. An existing episode without a summary gets an explicit no-summary
message.

The sticky bar contains back navigation, `Aa`, the Episode link, and actions
selected from the returned episode:

| Action | Condition and result |
|---|---|
| `Aa` | Available to visitors and readers; changes browser-local font, size, and theme immediately. Desktop popover or smaller-screen dialog sheet. |
| Episode | Opens the original video URL whenever episode data exists. |
| Done | Summary exists and `read === false`; writes a receipt, then routes to the remembered origin/fallback. |
| Ask | Summary exists, `processing.vectorizedAt` is present, and `read` is defined; hands episode scope to `/chats/new` without creating a chat. |
| Sign in | Offered for signed-out use by the sign-in action component. |

Ask's literal UI condition uses the vectorized timestamp, not a client-side test
of an active-generation identifier. Server retrieval validates active generations.
Done is absent for already-read or ineligible episodes; Undo lives in History.
A receipt-write error remains on the screen and re-enables Done.

## Navigation and local state

Lists store a reading origin in tab-local session storage: pathname, source kind,
episode ID, optional day, and label. Reading captures it when mounted; navigating
to a related summary does not replace that origin. Done routes to the stored
pathname. The back arrow uses browser history where possible, with that destination
as fallback.

Without an origin, signed-in fallback is Queue; visitor fallback is the episode's
channel, or `/` before episode data is available. On return, the list tries to
scroll to the original row or its day heading and consumes the origin record.
This is anchor restoration, not saved pixel scroll or automatic restoration of
every previously loaded page/filter. If the target is not in the rendered list,
there is no automatic page walk to recover it.

Scroll progress is a local visual rule across the top of the page. It does not
create a receipt. Appearance controls update local preferences, described in
[Reader preferences](reader-preferences.md).

## Implementation and evidence

- [Reading](../../apps/web/src/screens/Reading.tsx) owns presentation and action conditions.
- [Episode route](../../apps/api/src/routes/episodes.ts) and
  [episode projection](../../apps/api/src/lib/episode-view.ts) supply shared content
  plus optional personalized/processing fields.
- [Reading origin](../../apps/web/src/lib/reading-origin.ts) and
  [back navigation](../../apps/web/src/lib/back.ts) own return behavior.
- [Ask handoff](../../apps/web/src/lib/ask-scope.ts),
  [Sheet](../../apps/web/src/components/Sheet.tsx), and
  [settings](../../apps/web/src/lib/settings.ts) implement local interactions.

[Episode/receipt route tests](../../apps/api/test/routes-channels.test.ts) and
[visibility tests](../../apps/api/test/visibility.test.ts) cover data/access rules.
[Server render tests](../../apps/web/test/server/render.test.tsx) verify that
summary text is rendered publicly. These tests do not exercise Done navigation,
scroll restoration, or popover interaction in a DOM/browser.

## PRD differences and limitations

[PRD §7](../../docs/PRD.md) includes older “screen is not public” wording and
“no controls” visitor wording. The current reader is public and offers `Aa`,
navigation, and external links. Anonymous responses omit `processing`, so runtime
derived from that block is not available to the public renderer. The promised
return-to-row experience is conditional on an anchor being present in the loaded
list. The executable Ask condition is documented above rather than rewritten as
the stronger product phrase “has an active vector generation.”
