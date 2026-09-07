import type { RegistryDO } from "../do/registry";
import type { CatalogChannel } from "../do/registry/types";
import type { UserDO } from "../do/user";
import { isAvailable } from "./channel-view";

/**
 * The channels a caller may read from: active follows ∩ available, non-deleted catalog. The digest,
 * follows, episodes, and later chat retrieval all use this one definition (AGENTS.md → AI usage).
 */
export async function eligibleChannels(
  registry: DurableObjectStub<RegistryDO>,
  user: DurableObjectStub<UserDO>,
): Promise<CatalogChannel[]> {
  const followed = await user.activeChannelIds();
  if (followed.length === 0) return [];
  const channels = await registry.listChannelsByIds(followed);
  return channels.filter(isAvailable);
}
