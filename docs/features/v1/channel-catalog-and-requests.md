# Channel catalog and requests

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and actors

Readers discover channels, follow catalog entries, and request missing or
previously declined channels. Owners can combine addition with approval in the
web flow. A channel is a shared Registry record; adding it does not create a
private copy of its episodes or summaries.

## Browse and add flows

`/sources` requires a session. Following, Catalog, and Declined are addressable
sections using `?show=`. The screen loads follows and the complete channel list,
then applies title search, sorting, partitioning, and 25-row increments locally.
Sorting includes unread count, recent activity, name, and follow age where
applicable. This is client-side pagination, not a paginated channel API.

Adding a channel has a preview before commitment:

1. Paste a canonical channel ID or supported `/channel/UC…` URL. Handle and
   custom-channel URL resolution is not implemented.
2. `GET /channels/feed?channelId=...` verifies the channel RSS feed and reads the
   long-form feed. It reports the title, overlap with the channel's recent feed,
   newest long-form publication time, and any existing catalog record. This
   signed-in-only request writes nothing.
3. Confirm addition or follow the existing record. Zero long-form entries produce
   a warning, not a prohibition. A normal reader's new channel becomes requested
   and followed. The owner's new-channel flow adds, then separately approves it.

The owner add-and-approve sequence uses two requests. A failure of approval does
not roll back a successful addition/follow.

## API rules and state

| Operation | Current behavior |
|---|---|
| `GET /channels` | Requested and approved by default; `scope=all` includes declined. Public. |
| `GET /channels/:id` | Returns an existing channel in any status. Public. |
| `POST /channels` | Verifies a new ID, creates requested, follows caller; 201 for new, 200 for existing requested/approved. |
| `POST /channels/:id/request` | Declined → requested, preserves review fields, follows caller. |
| Add/follow a declined record | 409 with review information; use the request-again operation. |

Creation accepts `title` and `initialImportCount` from any authenticated caller,
although the web exposes those inputs to the owner. Import count defaults to 5.
The Registry create operation refuses existing IDs; the route handles a concurrent
creation by re-reading and following the existing record rather than overwriting it.

`/sources/:id` is a public detail route. Signed-in readers see all returned episode
states; visitors receive the web's public row filtering. Episodes sort by video
publication time. The browser requests the newest 200 and displays a limit notice
when appropriate; it has no year selector or older-page cursor.

## Implementation map

- [Sources](../../../apps/web/src/screens/Sources.tsx),
  [AddChannel](../../../apps/web/src/components/AddChannel.tsx), and
  [Source](../../../apps/web/src/screens/Source.tsx) implement the user flows.
- [Channel routes](../../../apps/api/src/routes/channels.ts) implement preview,
  creation, lookup, and re-request.
- [Channel store](../../../apps/api/src/do/registry/channels.ts) owns lifecycle fields
  in `channels`; [ID parsing](../../../apps/api/src/lib/youtube/ids.ts) and
  [RSS adapter](../../../apps/api/src/lib/youtube/rss.ts) handle accepted inputs/feed reads.
- [Channel projection](../../../apps/api/src/lib/channel-view.ts) builds public and
  authenticated response fields. See [Follows](follows-and-content-eligibility.md)
  and [Owner curation](owner-curation-and-catalog-health.md) for those operations.

## Tests and limitations

[Route tests](../../../apps/api/test/routes-channels.test.ts),
[channel-store tests](../../../apps/api/test/registry-channels.test.ts),
[ID tests](../../../apps/api/test/youtube-ids.test.ts), and
[RSS tests](../../../apps/api/test/youtube-rss.test.ts) cover validation, catalog
transitions, and feed handling. These do not verify the interactive add form in a browser.

The Source screen implements a capped newest-first list without year pagination.
An owner adding a channel does not receive special create-time approval from the
API: the web makes a second, owner-protected approval request. The ordinary reader
can also read summaries on a declined channel by direct link; decline removes
personalized eligibility rather than access to public content.
