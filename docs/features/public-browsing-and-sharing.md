# Public browsing and sharing

Source snapshot: `d23e52087bdbc83d56440c48dde79a3405d223a1` (2026-09-23).
[Feature index and evidence policy](README.md).

## Purpose and scope

A visitor can browse channels and read a complete summary without signing in.
Public URLs also carry server-rendered content and metadata for shared links and
crawlers. Personalized actions belong to authenticated features.

## Current behavior

The public web routes are `/`, `/sources/:id`, and `/read/:episodeId`. The
authenticated catalog at `/sources` remains guarded. The landing page includes
approved channels, including paused channels and channels without summaries.
Requested and declined channels stay out of that list but remain reachable by
direct URL. On a public channel page, only available and pending episodes are
listed; failed and skipped rows are filtered out in the web layer.

Five API reads accept anonymous requests:

- `GET /channels`, including `?scope=all`.
- `GET /channels/:id`.
- `GET /channels/:id/episodes`.
- `GET /channels/:id/episodes/:episodeId`.
- `GET /episodes/:episodeId`.

The API is broader than the public listing: `scope=all` includes declined
channels, and direct reads are not limited to approved channels. Anonymous
representations omit channel `management`, episode `processing`, and personal
`read`; they return `following: false`, empty `related`, and public follower
counts. Any valid session adds management/processing facts; those fields are not
owner-only. Read receipts still require eligibility.

The public reader retains `Aa` appearance controls, video links, navigation, and
sign-in links. Follow, Done, and Ask are absent. Public access does not record a
read receipt or create a user-specific digest.

## Rendering and sharing flow

The web Worker matches public paths, reads anonymous data through its API service
binding, and renders the same application tree the browser uses. It embeds
escaped bootstrap JSON so the client can reuse the initial data. Personal
credentials are never forwarded during this render.

Successful pages emit cache headers with 60-second browser freshness, 300-second
shared freshness, and stale-while-revalidate. These are response directives, not
proof of a particular deployed cache hit rate. Missing/malformed identifiers
produce a rendered 404. An unavailable API falls back to an uncached client shell
with HTTP 200 so the client can show its error/retry behavior.

Page-specific title, description, canonical URL, Open Graph fields, and a Twitter
summary card are generated. No preview image is emitted. `/robots.txt` excludes
guarded routes; `/sitemap.xml` enumerates approved channels and their available
episodes using the request's origin.

## Implementation and data

- [Public filtering](../../apps/web/src/lib/public-view.ts) and
  [Landing](../../apps/web/src/screens/Landing.tsx) own catalog presentation.
- [Worker](../../apps/web/src/server/worker.tsx),
  [loader](../../apps/web/src/server/load.ts), and
  [bootstrap](../../apps/web/src/lib/bootstrap.tsx) own anonymous rendering.
- [Head metadata](../../apps/web/src/server/head.ts) and
  [crawl responses](../../apps/web/src/server/crawl.ts) own sharing/indexing.
- [Channel routes](../../apps/api/src/routes/channels.ts),
  [episode routes](../../apps/api/src/routes/episodes.ts), and
  [optional identity](../../apps/api/src/middleware/user.ts) own API visibility.

Public content remains in shared Registry storage. See
[Reading](summary-reading-experience.md) for summary presentation.

## Tests, limitations, and PRD differences

[Visibility tests](../../apps/api/test/visibility.test.ts) exercise all five
anonymous reads and the protected-route boundary. Web tests cover
[loading](../../apps/web/test/server/load.test.ts),
[rendering](../../apps/web/test/server/render.test.tsx),
[head metadata](../../apps/web/test/server/head.test.ts), and
[crawling](../../apps/web/test/server/crawl.test.ts).

The landing catalog is unpaginated. The sitemap requests at most 200 episodes per
channel, without a cursor or sitemap index. The channel server loader uses the
API's default episode limit (20), while the browser's channel load asks for 200;
do not describe the initial server HTML as the full channel archive. Sitemap
construction performs one catalog request plus one request per public channel.
There is no application rate limiter in the inspected request path.

[PRD §2 and §7](../../docs/PRD.md) still contain statements that public pages have
no controls and that channel/reading screens require a session. Current screens
are public and retain local appearance/navigation controls. Older claims that
decline prevents all reading must be read as personalized eligibility rules;
direct public summaries remain accessible.
