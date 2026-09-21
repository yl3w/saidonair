import type { RegistryDO } from "../do/registry";
import type { RegistryUser } from "../do/registry/types";

/**
 * The caller's eligible channels: their active follows intersected with `approved`, paused or not
 * (docs/PRD.md §4.3). One definition, because it decides what a digest returns, which episodes
 * carry a read receipt, and which channels chat may retrieve from — a second copy would drift, and
 * drift here means answering from a channel the caller does not follow.
 *
 * **An anonymous caller is eligible for nothing.** That is what makes the public reads fall out
 * rather than being special-cased: `related` is filtered to this set, so it arrives empty, and no
 * read receipt is looked for because there is nobody to have one
 * (docs/specs/route-visibility.md §4.3).
 */
export async function eligibleChannelIds(
  registry: DurableObjectStub<RegistryDO>,
  identity: RegistryUser | undefined,
): Promise<Set<string>> {
  if (identity === undefined) return new Set();
  return new Set(
    (await registry.listEligibleChannels(identity.userId)).map(
      (channel) => channel.channelId,
    ),
  );
}
