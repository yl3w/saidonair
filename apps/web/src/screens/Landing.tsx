import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api } from "../api";
import { ChannelRow } from "../components/ChannelRow";
import { FindChannel } from "../components/FindChannel";
import { Page } from "../components/Page";
import { Retry } from "../components/Retry";
import {
  actionErrorCopy,
  LANDING_CHANNELS_HEADING,
  LANDING_EMPTY_COPY,
  LANDING_PROMISE,
  NO_CHANNEL_BY_THAT_NAME,
} from "../lib/copy";
import { publicChannels } from "../lib/public-view";
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

  const [needle, setNeedle] = useState("");
  const [load, reload] = useLoad(() => api.listChannels(), []);

  return (
    <Page>
      <h1 class="font-reading text-screen-title font-semibold tracking-tight text-ink">
        Said on Air
      </h1>
      <p class="mt-2 font-reading text-lede text-ink-2">{LANDING_PROMISE}</p>

      <h2 class="mt-10 text-label uppercase text-ink-3">
        {LANDING_CHANNELS_HEADING}
      </h2>

      {/* Arranged exactly as the catalog arranges it — the same control, the same row, the same
          rule under it — so the two screens do not read as two products. Narrowing only: the sort
          and the paging stay on `/sources`, which is the screen for working through a long list
          rather than arriving at one. */}
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <FindChannel value={needle} onChange={setNeedle} />
      </div>

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
          const trimmed = needle.trim().toLowerCase();
          const channels = publicChannels(load.data.channels).filter(
            (channel) =>
              trimmed.length === 0 ||
              channel.title.toLowerCase().includes(trimmed),
          );
          if (channels.length === 0) {
            return (
              <p class="mt-5 font-reading text-body text-ink-2">
                {trimmed.length > 0
                  ? NO_CHANNEL_BY_THAT_NAME
                  : LANDING_EMPTY_COPY}
              </p>
            );
          }
          return (
            <div class="mt-4 border-t border-rule">
              {channels.map((channel) => (
                <ChannelRow
                  key={channel.channelId}
                  channel={channel}
                  signedIn={false}
                />
              ))}
            </div>
          );
        })()}
    </Page>
  );
}
