import type { Channel } from "@media-digest/shared";
import { useEffect } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import {
  actionErrorCopy,
  LANDING_CHANNELS_HEADING,
  LANDING_EMPTY_COPY,
  LANDING_PROMISE,
  summaryCountCopy,
} from "../lib/copy";
import { publicChannels } from "../lib/public-view";
import { relativeTime } from "../lib/time";
import { useDocumentTitle } from "../lib/title";
import { useLoad } from "../lib/use-load";
import { useSession } from "../session";

/**
 * The landing page (docs/specs/public-reading.md §4.1). What a stranger sees first: the name, the
 * promise, and then the catalog itself — the product arguing for itself rather than describing
 * itself, which is why the channels sit on the first screen and not behind a link.
 *
 * **Every channel, uncapped** (spec §3, decision 2a; owner, 2026-09-21). A cap and a "See all N
 * channels" link were proposed and deferred together: at today's size every channel fits, and the
 * right number wants a real catalog on screen. `/sources` — reachable from the nav above — is where
 * search, sort and paging live when the list outgrows this.
 *
 * There is no sign-in button in the body. The band above carries it, on every public page, and a
 * second one here would say the same thing twice.
 */
export function Landing() {
  // The front door's heading is the wordmark: the product's own name and no second one.
  useDocumentTitle(null);

  const { state } = useSession();
  const { route } = useLocation();

  // A reader has somewhere to be. This effect moved here from `SignIn` when `/` stopped being the
  // door (step 3 of docs/specs/public-reading-plan.md).
  const signedIn = state.status !== "none";
  useEffect(() => {
    if (signedIn) route("/queue", true);
  }, [signedIn, route]);

  const [load, reload] = useLoad(() => api.listChannels(), []);

  return (
    <Page measure="list">
      <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
        Said on Air
      </h1>
      <p class="mt-2 font-reading text-lede text-ink-2">{LANDING_PROMISE}</p>

      <h2 class="mt-10 border-b border-rule pb-2 text-label uppercase text-ink-3">
        {LANDING_CHANNELS_HEADING}
      </h2>

      {load.status === "loading" && (
        <>
          <div class="skeleton mt-5 h-6 w-64" />
          <div class="skeleton mt-4 h-6 w-48" />
          <div class="skeleton mt-4 h-6 w-56" />
        </>
      )}

      {load.status === "error" && (
        <p class="mt-5 text-ui text-consequence">
          Couldn't load the catalog: {actionErrorCopy(load.error)}.{" "}
          <Retry onClick={reload} />
        </p>
      )}

      {load.status === "ready" &&
        (() => {
          const channels = publicChannels(load.data.channels);
          if (channels.length === 0) {
            return (
              <p class="mt-5 font-reading text-body text-ink-2">
                {LANDING_EMPTY_COPY}
              </p>
            );
          }
          return channels.map((channel) => (
            <LandingRow key={channel.channelId} channel={channel} />
          ));
        })()}
    </Page>
  );
}

/**
 * One channel. A channel with nothing published yet is still listed — it says the archive is coming
 * (spec §3, decision 3) — and reads quieter than one you can go and read, which is the difference
 * the eye should catch before the words do.
 */
function LandingRow({ channel }: { channel: Channel }) {
  const published = channel.episodes.available > 0;
  return (
    <article class="flex items-center gap-3 border-b border-rule py-[18px]">
      <Avatar id={channel.channelId} name={channel.title} size={34} />
      <div class="min-w-0 flex-1">
        <h3
          class={`font-reading text-row-compact font-semibold ${
            published ? "text-ink" : "text-ink-3"
          }`}
        >
          <a href={`/sources/${channel.channelId}`}>{channel.title}</a>
        </h3>
        <p class="mt-0.5 flex flex-wrap gap-x-2 text-meta text-ink-3">
          <span>{summaryCountCopy(channel.episodes)}</span>
          {channel.lastIngestedAt !== null && (
            <span>· newest {relativeTime(channel.lastIngestedAt)}</span>
          )}
        </p>
      </div>
    </article>
  );
}
