import type { Channel } from "@media-digest/shared";

/**
 * What a signed-out visitor is shown, filtered in the web rather than the API
 * (`docs/specs/public-reading.md` §3, decisions 3, 4 and 7). The API answers an anonymous caller
 * with every status on purpose — a declined channel's page is still reachable by direct link — so
 * these are the *list's* rules, not the product's.
 */

/**
 * The catalog a visitor browses: **approved channels, with episodes or without, and paused ones
 * among them**. A requested channel has nothing to show (the first import happens on approval) and
 * a declined one would put the owner's rejections in front of strangers.
 *
 * `paused` is a boolean beside the status, not a status of its own: a paused channel is still
 * `approved`, its archive is still readable, and only scheduled discovery has stopped. Writing this
 * as `status === "approved" && !paused` would quietly empty a paused channel out of the catalog.
 */
export const publicChannels = (channels: readonly Channel[]): Channel[] =>
  channels.filter((channel) => channel.status === "approved");
