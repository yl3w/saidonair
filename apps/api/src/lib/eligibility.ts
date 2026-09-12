import type { RegistryDO } from "../do/registry";
import type { CatalogChannel } from "../do/registry/types";
import type { UserDO } from "../do/user";
import { isApproved } from "./channel-view";

/**
 * The channels a caller may read from: active follows ∩ approved catalog. The digest, follows,
 * episodes, and later chat retrieval all use this one definition (docs/PRD.md §4.3).
 */
export async function eligibleChannels(
  registry: DurableObjectStub<RegistryDO>,
  user: DurableObjectStub<UserDO>,
): Promise<CatalogChannel[]> {
  const followed = await user.activeChannelIds();
  if (followed.length === 0) return [];
  const channels = await registry.listChannelsByIds(followed);
  return channels.filter(isApproved);
}
